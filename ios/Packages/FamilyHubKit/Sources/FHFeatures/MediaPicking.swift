import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers
import CoreTransferable
import FHModel
import FHDomain
import FHGateway
import FHDesign
#if canImport(UIKit)
import UIKit
#endif

/// 添付に選んだファイル。送っても受け付けられないものは、理由を付けて一覧に残す（Web と同じ）。
struct PickedFile: Identifiable, Hashable, Sendable {
  let id = UUID()
  var file: UploadFile
  var problem: String?

  init(_ file: UploadFile) {
    self.file = file
    problem = MemoAttachments.problem(name: file.name, type: file.type, size: file.size)
  }
}

/// 写真の動画を受け取る（ファイルのまま。大きいので記憶に読み込まない）。
struct PickedMovie: Transferable {
  let url: URL
  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(importedContentType: .movie) { received in
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)")
      try FileManager.default.copyItem(at: received.file, to: copy)
      return PickedMovie(url: copy)
    }
  }
}

enum MediaPicking {
  /// 写真を送れる形にする。JPEG と PNG はそのまま、それ以外（HEIC など）は JPEG に変える（サーバーは HEIC を受け付けない）。
  static func photo(_ data: Data, name: String) -> UploadFile? {
    if data.starts(with: [0xFF, 0xD8, 0xFF]) { return UploadFile(name: "\(name).jpg", type: "image/jpeg", data: data) }
    if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return UploadFile(name: "\(name).png", type: "image/png", data: data) }
    #if canImport(UIKit)
    if let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) { return UploadFile(name: "\(name).jpg", type: "image/jpeg", data: jpeg) }
    #endif
    return nil
  }

  /// 動画を H.264 の MP4 にする（写真の動画は QuickTime の HEVC が多く、アプリの中で見られない端末がある）。
  static func mp4(_ source: URL, name: String) async throws -> UploadFile {
    defer { try? FileManager.default.removeItem(at: source) }
    if source.pathExtension.lowercased() == "mp4", let data = try? Data(contentsOf: source) {
      return UploadFile(name: "\(name).mp4", type: "video/mp4", data: data)
    }
    let output = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mp4")
    defer { try? FileManager.default.removeItem(at: output) }
    guard let session = AVAssetExportSession(asset: AVURLAsset(url: source), presetName: AVAssetExportPreset1920x1080) else { throw CocoaError(.fileReadCorruptFile) }
    session.shouldOptimizeForNetworkUse = true
    try await session.export(to: output, as: .mp4)
    return UploadFile(name: "\(name).mp4", type: "video/mp4", data: try Data(contentsOf: output))
  }

  /// 写真の一覧から選んだもの。読み込めなかったものは理由を返す。
  static func load(_ items: [PhotosPickerItem]) async -> (files: [PickedFile], failed: Int) {
    var files: [PickedFile] = [], failed = 0
    for (index, item) in items.enumerated() {
      let name = items.count == 1 ? "写真" : "写真\(index + 1)"
      if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
        if let movie = try? await item.loadTransferable(type: PickedMovie.self), let file = try? await mp4(movie.url, name: name.replacingOccurrences(of: "写真", with: "動画")) {
          files.append(PickedFile(file))
        } else { failed += 1 }
      } else if let data = try? await item.loadTransferable(type: Data.self), let file = photo(data, name: name) {
        files.append(PickedFile(file))
      } else { failed += 1 }
    }
    return (files, failed)
  }

  /// ファイルの一覧から選んだもの。種類は拡張子で決める。
  static func load(_ urls: [URL]) -> (files: [PickedFile], failed: Int) {
    var files: [PickedFile] = [], failed = 0
    for url in urls {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      guard let data = try? Data(contentsOf: url) else { failed += 1; continue }
      files.append(PickedFile(UploadFile(name: url.lastPathComponent, type: MemoAttachments.type(name: url.lastPathComponent, type: ""), data: data)))
    }
    return (files, failed)
  }

  static let fileTypes: [UTType] = [.pdf, .jpeg, .png, .mpeg4Movie]
}

/// 写真またはファイルから添付を選ぶ2つのボタン。
struct AttachmentPickButtons: View {
  @Environment(\.theme) private var theme
  var photoLabel = "写真から選ぶ"
  var fileLabel = "ファイルから選ぶ"
  let onPicked: ([PickedFile]) -> Void
  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var loading = false
  @State private var failure = ""

  var body: some View {
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      PhotosPicker(selection: $photos, maxSelectionCount: 10, matching: .any(of: [.images, .videos])) { Label(photoLabel, systemImage: "photo.on.rectangle") }
        .disabled(loading)
      Button { importing = true } label: { Label(fileLabel, systemImage: "folder") }.disabled(loading)
      if loading { HStack { ProgressView(); Text("読み込んでいます…") } }
      if !failure.isEmpty { Text(failure).foregroundStyle(theme.colors.danger.color) }
    }
    .onChange(of: photos) { _, items in
      guard !items.isEmpty else { return }
      loading = true
      Task {
        let result = await MediaPicking.load(items)
        loading = false
        photos = []
        report(result)
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: MediaPicking.fileTypes, allowsMultipleSelection: true) { result in
      guard case .success(let urls) = result else { return }
      report(MediaPicking.load(urls))
    }
  }

  private func report(_ result: (files: [PickedFile], failed: Int)) {
    failure = result.failed > 0 ? "\(result.failed)件のファイルを読み込めませんでした。別の形式で保存し直してください。" : ""
    if !result.files.isEmpty { onPicked(result.files) }
  }
}
