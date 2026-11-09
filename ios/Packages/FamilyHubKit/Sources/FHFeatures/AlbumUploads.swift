import SwiftUI
import PhotosUI
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import FHModel
import FHDomain
import FHDesign
import FHGateway

/// アルバムに送るファイルを用意する。
/// - 写真の HEIC は、撮影日時と位置などの情報を残したまま JPEG に変える（サーバーは HEIC を受け付けない。位置を残すかはサーバーが決める）。
/// - 動画は、撮影日時の情報を残したまま H.264 の MP4 にする（どの端末でも再生できるように）。縮小画像も作る。
enum AlbumMediaPrep {
  struct Prepared: Sendable {
    var source: UploadSource
    var thumbnail: Data?
    var problem: String?
  }

  static let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fh-album-staging", isDirectory: true)

  static func stage(_ data: Data, name: String) -> URL? {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("\(UUID().uuidString)-\(AttachmentFiles.safeName(name))")
    return (try? data.write(to: url)) == nil ? nil : url
  }

  /// JPEG と PNG はそのまま。ほかの画像は、情報を残したまま JPEG にする。
  static func photo(_ data: Data, name: String) -> Prepared? {
    let base = (name as NSString).deletingPathExtension
    if data.starts(with: [0xFF, 0xD8, 0xFF]), let url = stage(data, name: "\(base).jpg") { return Prepared(source: UploadSource(name: "\(base).jpg", type: "image/jpeg", size: data.count, url: url)) }
    if data.starts(with: [0x89, 0x50, 0x4E, 0x47]), let url = stage(data, name: "\(base).png") { return Prepared(source: UploadSource(name: "\(base).png", type: "image/png", size: data.count, url: url)) }
    guard let input = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImageFromSource(destination, input, 0, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination), let url = stage(output as Data, name: "\(base).jpg") else { return nil }
    return Prepared(source: UploadSource(name: "\(base).jpg", type: "image/jpeg", size: output.length, url: url))
  }

  /// 動画を MP4 にし、縮小画像を作る。
  static func video(_ input: URL, name: String) async -> Prepared? {
    let base = (name as NSString).deletingPathExtension
    let asset = AVURLAsset(url: input)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let output = folder.appendingPathComponent("\(UUID().uuidString)-\(AttachmentFiles.safeName(base)).mp4")
    defer { try? FileManager.default.removeItem(at: input) }
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1920x1080) else { return nil }
    session.shouldOptimizeForNetworkUse = true
    // 撮影日時（creationdate）を残す。位置はサーバーが利用者の選びに合わせて残すか外す。
    session.metadata = (try? await asset.load(.metadata)) ?? []
    do { try await session.export(to: output, as: .mp4) } catch { return nil }
    let size = (try? FileManager.default.attributesOfItem(atPath: output.path)[.size] as? Int) ?? 0
    return Prepared(source: UploadSource(name: "\(base).mp4", type: "video/mp4", size: size, url: output), thumbnail: await thumbnail(AVURLAsset(url: output)))
  }

  /// 動画の縮小画像。1秒か長さの1割の早い方の場面を、長い辺 640 の JPEG にする（Web の videoThumbnail.ts と同じ）。
  static func thumbnail(_ asset: AVURLAsset) async -> Data? {
    let duration = (try? await asset.load(.duration)).map(CMTimeGetSeconds) ?? 0
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 640, height: 640)
    guard let image = try? await generator.image(at: CMTime(seconds: min(1, duration / 10), preferredTimescale: 600)).image else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? output as Data : nil
  }

  static func load(_ items: [PhotosPickerItem]) async -> [Prepared] {
    var result: [Prepared] = []
    for (index, item) in items.enumerated() {
      let name = items.count == 1 ? "写真" : "写真\(index + 1)"
      if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
        if let movie = try? await item.loadTransferable(type: PickedMovie.self), let prepared = await video(movie.url, name: name.replacingOccurrences(of: "写真", with: "動画")) { result.append(prepared) }
      } else if let data = try? await item.loadTransferable(type: Data.self), let prepared = photo(data, name: name) {
        result.append(prepared)
      }
    }
    return result
  }

  static func load(_ urls: [URL]) async -> [Prepared] {
    var result: [Prepared] = []
    for url in urls {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      let type = AlbumUpload.type(name: url.lastPathComponent, type: "")
      if type.hasPrefix("video/") {
        let copy = folder.appendingPathComponent("\(UUID().uuidString).\(url.pathExtension)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if (try? FileManager.default.copyItem(at: url, to: copy)) != nil, let prepared = await video(copy, name: url.lastPathComponent) { result.append(prepared) }
      } else if let data = try? Data(contentsOf: url) {
        if let problem = AlbumUpload.problem(name: url.lastPathComponent, type: type, size: data.count), !problem.hasPrefix("HEIC"), let staged = stage(data, name: url.lastPathComponent) {
          result.append(Prepared(source: UploadSource(name: url.lastPathComponent, type: type, size: data.count, url: staged), problem: problem))
        } else if let prepared = photo(data, name: url.lastPathComponent) {
          result.append(prepared)
        }
      }
    }
    return result
  }
}

/// アルバムへの送信の待ち行列（Web の uploadQueue.ts）。
/// - 同時に3件まで。受け取った側の確認が終わるまでも数に入る。
/// - 混み合っている（RATE_LIMITED）ときは2秒待って、40回まで送り直す。
/// - 送り終えたら、アルバムを1秒ごとに読み直し、確認の結果（追加・同じファイル・追加できない）を待つ。15分で諦める。
@Observable @MainActor
final class AlbumUploadQueue {
  struct Entry: Identifiable {
    let key = UUID().uuidString
    let albumId: Id
    let prepared: AlbumMediaPrep.Prepared
    var keepLocation: Bool
    var state: UploadState
    var sent = 0
    var itemId: Id?
    var message: String?
    var retryable = false
    var processingSince: Date?
    let ticket = UploadTicket()
    var id: String { key }
    var name: String { prepared.source.name }
  }

  private(set) var entries: [Entry] = []
  @ObservationIgnored private var running: [String: Task<Void, Never>] = [:]
  @ObservationIgnored private var watching: Task<Void, Never>?

  func entries(for albumId: Id) -> [Entry] { entries.filter { $0.albumId == albumId } }
  var activeCount: Int { AlbumUpload.summarize(entries.map(\.state)).active }

  func stage(_ prepared: [AlbumMediaPrep.Prepared], albumId: Id, keepLocation: Bool) {
    for item in prepared {
      let problem = item.problem ?? AlbumUpload.problem(name: item.source.name, type: item.source.type, size: item.source.size)
      entries.append(Entry(albumId: albumId, prepared: item, keepLocation: keepLocation, state: problem == nil ? .staged : .rejected, message: problem))
    }
  }

  func move(_ key: String, step: Int) {
    guard let index = entries.firstIndex(where: { $0.key == key }) else { return }
    let order = AlbumUpload.moveStaged(states: entries.map(\.state), albums: entries.map(\.albumId), index: index, step: step)
    entries = order.map { entries[$0] }
  }

  func start(_ albumId: Id, keepLocation: Bool, model: AppModel) {
    for index in entries.indices where entries[index].albumId == albumId && entries[index].state == .staged {
      entries[index].state = .waiting
      entries[index].keepLocation = keepLocation
    }
    pump(model)
  }

  func retry(_ key: String, model: AppModel) {
    guard let index = entries.firstIndex(where: { $0.key == key }), entries[index].state == .failed, entries[index].retryable else { return }
    entries[index].state = .waiting
    entries[index].message = nil
    pump(model)
  }

  func remove(_ key: String, model: AppModel) {
    guard let entry = entries.first(where: { $0.key == key }), entry.state != .sending else { return }
    if entry.state == .failed { Task { _ = await model.gateway.cancelUpload(ticket: entry.ticket) } }
    entries.removeAll { $0.key == key }
  }

  /// 送信を止める。送っている途中の分は送る前に戻す。
  func cancel(_ albumId: Id) {
    for (key, task) in running { if entries.first(where: { $0.key == key })?.albumId == albumId { task.cancel() } }
    for index in entries.indices where entries[index].albumId == albumId && (entries[index].state == .waiting || entries[index].state == .sending) {
      entries[index].state = .staged
      entries[index].sent = 0
    }
  }

  func clearFinished(_ albumId: Id) {
    entries.removeAll { $0.albumId == albumId && [.done, .duplicate].contains($0.state) }
  }

  private func update(_ key: String, _ change: (inout Entry) -> Void) {
    guard let index = entries.firstIndex(where: { $0.key == key }) else { return }
    change(&entries[index])
  }

  private func pump(_ model: AppModel) {
    for index in AlbumUpload.nextToSend(entries.map(\.state)) {
      let entry = entries[index]
      entries[index].state = .sending
      running[entry.key] = Task { await send(entry, model: model) }
    }
  }

  private func send(_ entry: Entry, model: AppModel) async {
    defer { running[entry.key] = nil }
    let gateway = model.gateway
    let key = entry.key
    var attempts = 0
    while true {
      let result = await model.run {
        await gateway.uploadItem(albumId: entry.albumId, source: entry.prepared.source, keepLocation: entry.keepLocation, thumbnail: entry.prepared.thumbnail, ticket: entry.ticket) { sent, _ in
          Task { @MainActor [weak self] in self?.update(key) { $0.sent = sent } }
        }
      }
      if Task.isCancelled { return }
      switch result {
      case .success(let itemId):
        update(key) { $0.state = .processing; $0.itemId = itemId; $0.sent = entry.prepared.source.size; $0.processingSince = Date() }
        watch(model)
        pump(model)
        return
      case .failure(let error) where error.code == .rateLimited && attempts < 40:
        attempts += 1
        try? await Task.sleep(for: .seconds(2))
      case .failure(let error):
        update(key) { $0.state = .failed; $0.message = error.message; $0.retryable = error.retryable }
        pump(model)
        return
      }
    }
  }

  /// 確認中の分のアルバムを1秒ごとに読み直す。
  private func watch(_ model: AppModel) {
    guard watching == nil else { return }
    watching = Task {
      defer { watching = nil }
      while entries.contains(where: { $0.state == .processing }) {
        try? await Task.sleep(for: .seconds(1))
        if Task.isCancelled { return }
        for albumId in Set(entries.filter { $0.state == .processing }.map(\.albumId)) {
          guard case .success(let detail) = await model.gateway.getAlbum(id: albumId) else { continue }
          for entry in entries where entry.state == .processing && entry.albumId == albumId {
            let item = detail.items.first { $0.id == entry.itemId }
            update(entry.key) { current in
              switch item?.status {
              case .ready?: current.state = .done
              case .rejected? where item.map(AlbumView.isDuplicate) == true: current.state = .duplicate
              case .rejected?: current.state = .rejected; current.message = item?.statusMessage ?? "このファイルは保存できませんでした。"
              case nil: current.state = .failed; current.retryable = true; current.message = "受け取った記録が見つかりません。もう一度送ってください。"
              default:
                if let since = current.processingSince, Date().timeIntervalSince(since) > 15 * 60 {
                  current.state = .failed; current.retryable = false; current.message = "確認に時間がかかっています。しばらくしてからアルバムを開き直してください。"
                }
              }
            }
          }
          NotificationCenter.default.post(name: .albumChanged, object: albumId)
        }
        pump(model)
      }
    }
  }
}

extension Notification.Name {
  /// アルバムの中身が変わった（送信が終わった）ので、開いている画面は読み直す。
  static let albumChanged = Notification.Name("fh.albumChanged")
}
