import SwiftUI
import PhotosUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// アルバムの入力（Web の AlbumForm.tsx）。
struct AlbumFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let initial: AlbumDraft
  let busy: Bool
  let error: String
  @Binding var draft: AlbumDraft
  @Binding var problem: String

  var body: some View {
    let colors = theme.colors
    let people = (model.snapshot?.memberships ?? []).filter { $0.status == .active || draft.selectedIds.contains($0.id) }
    Form {
      if !(problem.isEmpty && error.isEmpty) {
        Section { Text(problem.isEmpty ? error : problem).foregroundStyle(colors.danger.color) }
      }
      Section {
        TextField("アルバム名", text: limited($draft.title, AlbumForm.titleLimit)).accessibilityIdentifier("albums.form.title")
        TextField("説明（任意）", text: limited($draft.description, AlbumForm.descriptionLimit), axis: .vertical).lineLimit(2...6)
      }
      VisibilitySection(kind: .album, audience: $draft.audience, selectedIds: $draft.selectedIds, initialAudience: initial.audience, people: people)
      Section {
        Picker("スライドショーの曲", selection: $draft.bgmPreset) {
          Text("指定しない").tag("")
          ForEach([BgmPreset.calm, .bright, .gentle], id: \.self) { Text(AlbumText.bgm($0)).tag($0.rawValue) }
        }
      } footer: { Text("再生ボタンを押すまで音は鳴りません。") }
    }
    .disabled(busy)
    .onChange(of: problem) { _, message in if !message.isEmpty { announce(message) } }
    .onChange(of: error) { _, message in if !message.isEmpty { announce(message) } }
  }
}

struct AlbumCreateSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let onCreated: (Album) -> Void
  @State private var draft = AlbumForm.newDraft(audience: .household)
  @State private var initial = AlbumForm.newDraft(audience: .household)
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false
  @State private var ready = false
  @State private var key = UUID().uuidString.lowercased()

  var body: some View {
    NavigationStack {
      AlbumFormView(initial: initial, busy: busy, error: error, draft: $draft, problem: $problem)
        .navigationTitle("アルバムを作る")
        .inlineNavigationTitle()
        .navigationSubtitle("写真や動画は、作ったあとに追加します。")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) { Button(busy ? "作成中…" : "作成する") { Task { await submit() } }.disabled(busy).accessibilityIdentifier("albums.form.submit") }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
    .onAppear {
      guard !ready, let snapshot = model.snapshot else { return }
      ready = true
      let fresh = AlbumForm.newDraft(audience: Visibility.defaultAudience(snapshot.viewer.role, .album, preferred: model.privacy?.defaultAudience))
      initial = fresh
      draft = fresh
    }
  }

  private func submit() async {
    guard !busy else { return }
    if let found = AlbumForm.problem(draft) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = AlbumForm.createInput(draft), key = key
    switch await model.mutate({ await $0.createAlbum(input, idempotencyKey: key) }) {
    case .success(let album): model.announce("アルバムを作成しました"); onCreated(album); dismiss()
    case .failure(let failure): error = failure.message
    }
  }
}

struct AlbumEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let album: Album
  let onSaved: () -> Void
  @State private var draft: AlbumDraft
  @State private var initial: AlbumDraft
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false

  init(album: Album, onSaved: @escaping () -> Void) {
    self.album = album
    self.onSaved = onSaved
    let start = AlbumForm.draft(from: album)
    _draft = State(initialValue: start)
    _initial = State(initialValue: start)
  }

  var body: some View {
    NavigationStack {
      AlbumFormView(initial: initial, busy: busy, error: error, draft: $draft, problem: $problem)
        .navigationTitle("アルバムを編集")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "保存する") { Task { await submit() } }.disabled(busy).accessibilityIdentifier("albums.form.submit") }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
  }

  private func submit() async {
    guard !busy else { return }
    if let found = AlbumForm.problem(draft) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = AlbumForm.updateInput(draft, original: album), id = album.id, version = album.version
    switch await model.mutate({ await $0.updateAlbum(id: id, input: input, expectedVersion: version) }) {
    case .success: model.announce("アルバムを保存しました"); onSaved(); dismiss()
    case .failure(let failure): error = failure.message
    }
  }
}

/// 写真や動画を追加する（Web の AlbumUpload.tsx）。選んだものを並べ、「n件を送る」で送り始める。
struct AlbumUploadSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  @AppStorage("fh.keepPhotoLocation") private var keepLocation = false
  let albumId: Id
  let uploads: AlbumUploadQueue
  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var preparing = false

  var body: some View {
    let colors = theme.colors
    let entries = uploads.entries(for: albumId)
    let summary = AlbumUpload.summarize(entries.map(\.state))
    NavigationStack {
      Form {
        Section {
          PhotosPicker(selection: $photos, maxSelectionCount: 50, matching: .any(of: [.images, .videos])) { Label("写真や動画を選ぶ", systemImage: "photo.on.rectangle") }
            .disabled(preparing)
            .accessibilityIdentifier("albums.upload.choose")
          Button { importing = true } label: { Label("ファイルから選ぶ", systemImage: "folder") }.disabled(preparing)
          if preparing { HStack { ProgressView(); Text("送る形に整えています…") } }
          Toggle("撮影場所を残す", isOn: $keepLocation).accessibilityIdentifier("albums.upload.keep-location")
        } footer: {
          Text("JPEG・PNG・MP4・MOV を選べます。写真は100MB、動画は4GBまでです。写真の HEIC は JPEG に、動画は MP4 に変えて送ります。\n撮影場所を残すと、その情報がファイルに残り、このアルバムを見られる人が読み取れます（オフなら取り除いて保存します）。")
        }
        if !entries.isEmpty {
          Section {
            Text("\(summary.finished) / \(summary.total)件 完了\(summary.failed > 0 ? " \(summary.failed)件 追加できませんでした" : "")").font(.footnote).foregroundStyle(colors.inkSoft.color)
            ForEach(entries) { entry in row(entry) }
            if summary.finished > 0 { Button("完了した分を一覧から消す") { uploads.clearFinished(albumId) } }
          }
        }
      }
      .navigationTitle("写真や動画を追加")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.close) { dismiss() } }
        ToolbarItemGroup(placement: .confirmationAction) {
          if summary.active > 0 { Button("送信を中止") { uploads.cancel(albumId) }.accessibilityIdentifier("albums.upload.cancel") }
          else if summary.staged > 0 { Button("\(summary.staged)件を送る") { uploads.start(albumId, keepLocation: keepLocation, model: model) }.accessibilityIdentifier("albums.upload.start") }
        }
      }
      .onChange(of: photos) { _, items in
        guard !items.isEmpty else { return }
        preparing = true
        Task {
          let prepared = await AlbumMediaPrep.load(items)
          uploads.stage(prepared, albumId: albumId, keepLocation: keepLocation)
          photos = []
          preparing = false
        }
      }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .mpeg4Movie, .quickTimeMovie, .heic], allowsMultipleSelection: true) { result in
        guard case .success(let urls) = result else { return }
        preparing = true
        Task {
          uploads.stage(await AlbumMediaPrep.load(urls), albumId: albumId, keepLocation: keepLocation)
          preparing = false
        }
      }
    }
  }

  @ViewBuilder
  private func row(_ entry: AlbumUploadQueue.Entry) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      HStack {
        Image(systemName: entry.prepared.source.type.hasPrefix("video/") ? "film" : "photo").foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.name).foregroundStyle(colors.ink.color)
          Text([MemoAttachments.formatSize(entry.prepared.source.size), entry.message].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        Spacer()
        StatusBadge(entry.state.label, tone: [.failed, .rejected].contains(entry.state) ? .danger : entry.state == .done ? .success : .neutral)
      }
      .accessibilityElement(children: .combine)
      if entry.state == .sending {
        ProgressView(value: Double(AlbumUpload.percent(sent: entry.sent, total: entry.prepared.source.size)), total: 100).accessibilityLabel("\(entry.name)の送信")
      }
      HStack(spacing: TokenSpace.space2) {
        if entry.state == .staged {
          Button("前へ") { uploads.move(entry.key, step: -1) }.buttonStyle(.borderless)
          Button("後ろへ") { uploads.move(entry.key, step: 1) }.buttonStyle(.borderless)
        }
        if entry.state == .failed, entry.retryable { Button(Copy.ja.ja.actions.retry) { uploads.retry(entry.key, model: model) }.buttonStyle(.borderless) }
        if entry.state != .sending { Button("外す") { uploads.remove(entry.key, model: model) }.buttonStyle(.borderless) }
      }
    }
  }
}
