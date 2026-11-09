import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway
#if canImport(UIKit)
import UIKit
#endif

/// URL・チラシから読み取る（Web の EventReadDialog.tsx）。候補を選ぶと予定の入力を開くだけで、保存は利用者が行う。
struct EventReaderSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let sample: Bool
  let onPick: (EventCandidate, String) -> Void

  enum Source: String, CaseIterable { case url, image
    var label: String { self == .url ? "ページのURL" : "チラシの画像" }
  }

  @State private var source = Source.url
  @State private var url = ""
  @State private var photo: PhotosPickerItem?
  @State private var file: UploadFile?
  @State private var importing = false
  @State private var error = ""
  @State private var job: AssistantJob?
  @State private var reading: Task<Void, Never>?

  private var busy: Bool { reading != nil }
  private var ready: Bool { source == .url ? !url.jsTrimmedForForm.isEmpty : file != nil }

  var body: some View {
    let colors = theme.colors
    let copy = Copy.ja.ja.reading.self
    NavigationStack {
      Form {
        Section {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text(sample ? copy.sampleTitle : copy.title).font(.callout.weight(.bold))
              Text((sample ? copy.sampleBody : copy.body) + copy.keep).font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
          } icon: { Image(systemName: "eye") }
        }
        Section {
          Picker("読み取るもの", selection: $source) { ForEach(Source.allCases, id: \.self) { Text($0.label).tag($0) } }
            .pickerStyle(.segmented)
            .onChange(of: source) { _, _ in error = "" }
          if source == .url {
            TextField("ページのURL", text: limited($url, 2048), prompt: Text("https://"))
              .textContentType(.URL)
              .urlKeyboard()
              .autocorrectionDisabled()
            Text("公開されている https のページを読み取れます。").font(.footnote).foregroundStyle(colors.inkSoft.color)
          } else {
            let pickLabel = file == nil ? "写真から選ぶ" : "別の写真を選ぶ"
            PhotosPicker(selection: $photo, matching: .images) { Label(pickLabel, systemImage: "photo") }
            Button { importing = true } label: { Label("ファイルから選ぶ", systemImage: "folder") }
            if let file { LabeledContent("選んだ画像", value: "\(file.name)（\(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))）") }
            Text("JPEG と PNG を読み取れます（10MBまで）。写真の HEIC は JPEG に変えて送ります。").font(.footnote).foregroundStyle(colors.inkSoft.color)
          }
        }
        if busy { Section { HStack { ProgressView(); Text("読み取っています。しばらくお待ちください。") } } }
        if !error.isEmpty { Section { Text(error).foregroundStyle(colors.danger.color) } }
        if let events = job?.events {
          Section("予定の候補（\(events.count)件）") {
            ForEach(Array(events.enumerated()), id: \.offset) { _, candidate in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(candidate.title).font(.body.weight(.bold))
                  Text([CalendarText.day(candidate.date), timeText(candidate), candidate.location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " "))
                    .font(.footnote).foregroundStyle(colors.inkSoft.color)
                }
                Spacer()
                Button("入力して開く") { onPick(candidate, job?.sample == true ? copy.reviewSample : copy.review) }
                  .fhButton(.secondary)
                  .accessibilityLabel("「\(candidate.title)」を入力して開く")
              }
            }
          }
        }
      }
      .navigationTitle("URL・チラシから読み取る")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(job == nil ? Copy.ja.ja.actions.cancel : Copy.ja.ja.actions.close) { reading?.cancel(); dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "読み取り中…" : job == nil ? "読み取る" : "もう一度読み取る") { start() }.disabled(!ready || busy)
        }
      }
      .onChange(of: photo) { _, item in Task { await load(item) } }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png]) { result in
        guard case .success(let picked) = result else { return }
        let access = picked.startAccessingSecurityScopedResource()
        defer { if access { picked.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: picked) else { error = "画像を読み込めませんでした。"; return }
        file = UploadFile(name: picked.lastPathComponent, type: picked.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg", data: data)
        error = ""
      }
      .onDisappear { reading?.cancel() }
    }
  }

  private func timeText(_ candidate: EventCandidate) -> String {
    guard let start = candidate.startTime else { return "終日" }
    return "\(start)\(candidate.endTime.map { "〜\($0)" } ?? "")"
  }

  /// 写真を読み込む。JPEG と PNG はそのまま、それ以外（HEIC など）は JPEG に変える。
  private func load(_ item: PhotosPickerItem?) async {
    guard let item, let data = try? await item.loadTransferable(type: Data.self) else { return }
    error = ""
    if data.starts(with: [0xFF, 0xD8, 0xFF]) { file = UploadFile(name: "photo.jpg", type: "image/jpeg", data: data); return }
    if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { file = UploadFile(name: "photo.png", type: "image/png", data: data); return }
    #if canImport(UIKit)
    if let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) {
      file = UploadFile(name: "photo.jpg", type: "image/jpeg", data: jpeg)
      return
    }
    #endif
    error = "この写真は読み取れません。JPEG か PNG の画像を選んでください。"
  }

  private func start() {
    guard ready, !busy else { return }
    let problem = source == .url ? Reading.urlProblem(url) : file.flatMap { Reading.imageProblem(name: $0.name, type: $0.type, size: $0.size) }
    if let problem { error = problem; return }
    error = ""; job = nil
    let gateway = model.gateway
    let chosen = source, address = url.jsTrimmedForForm, image = file
    reading = Task {
      defer { reading = nil }
      let started = await model.run { chosen == .url ? await gateway.readEventUrl(address) : await gateway.readEventImage(image!) }
      guard case .success(var current) = started else { if case .failure(let failure) = started { error = failure.message }; return }
      let deadline = ContinuousClock.now + Reading.waitLimit
      while ContinuousClock.now < deadline {
        try? await Task.sleep(for: Reading.pollInterval)
        if Task.isCancelled { return }
        switch await gateway.getAssistantJob(id: current.id) {
        case .failure(let failure): error = failure.message; return
        case .success(let next):
          current = next
          if next.status == .done { job = next; return }
          if next.status == .failed { error = next.message ?? Reading.waitedTooLong; return }
        }
      }
      error = Reading.waitedTooLong
    }
  }
}

extension View {
  @ViewBuilder func urlKeyboard() -> some View {
    #if os(iOS)
    keyboardType(.URL).textInputAutocapitalization(.never)
    #else
    self
    #endif
  }
}
