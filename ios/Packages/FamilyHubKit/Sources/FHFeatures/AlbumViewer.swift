import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 写真や動画を1つずつ見る（Web の MediaViewer.tsx）。左右に払うか、前後のボタンで移る。端まで行くと反対の端へ戻る。
struct AlbumViewer: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let items: [AlbumItem]
  let startId: Id
  let canDelete: (AlbumItem) -> Bool
  let onDelete: (AlbumItem) -> Void
  @State private var index = 0
  @State private var info = false
  @State private var shared: SharedFile?
  @State private var saving = false

  var body: some View {
    let item = items.indices.contains(index) ? items[index] : nil
    NavigationStack {
      ZStack {
        Color.black.ignoresSafeArea()
        if let item {
          Group {
            if item.kind == .video { MediaVideo(item: item).id(item.id) }
            else { MediaImage(item: item, variant: .file, contentMode: .fit).id(item.id).accessibilityLabel("写真「\(AlbumText.spoken(item))」") }
          }
          .gesture(DragGesture(minimumDistance: 20).onEnded { value in
            let step = AlbumView.swipe(value.translation.width, value.translation.height)
            if step != 0 { index = AlbumView.step(index, length: items.count, by: step) }
          })
        }
      }
      .safeAreaInset(edge: .bottom) {
        if let item, items.count > 1 || info {
          VStack(spacing: TokenSpace.space2) {
            if info { details(item) }
            if items.count > 1 {
              HStack {
                Button { index = AlbumView.step(index, length: items.count, by: -1) } label: { Label("前の項目", systemImage: "chevron.left") }.fhButton(.secondary)
                Spacer()
                Button { index = AlbumView.step(index, length: items.count, by: 1) } label: { Label("次の項目", systemImage: "chevron.right") }.fhButton(.secondary)
              }
            }
          }
          .padding(TokenSpace.space3)
        }
      }
      .navigationTitle(item.map { "\(index + 1) / \(items.count)  \($0.originalName)" } ?? "")
      .inlineNavigationTitle()
      .navigationSubtitle(item.flatMap(AlbumText.taken) ?? "")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.close) { dismiss() }.accessibilityIdentifier("albums.viewer.close") }
        ToolbarItemGroup(placement: .primaryAction) {
          Button { info.toggle() } label: { Image(systemName: "info.circle") }.accessibilityLabel("詳しい情報").accessibilityAddTraits(info ? .isSelected : [])
          if let item {
            Button { Task { await save(item) } } label: { Image(systemName: "square.and.arrow.down") }.disabled(saving).accessibilityLabel("\(AlbumText.kind(item))「\(AlbumText.spoken(item))」を端末に保存")
            if canDelete(item) {
              Button(role: .destructive) { remove(item) } label: { Image(systemName: "trash") }.accessibilityLabel("\(AlbumText.kind(item))「\(AlbumText.spoken(item))」を削除")
            }
          }
        }
      }
      .sheet(item: $shared) { file in ShareSheet(url: file.url) }
    }
    .onAppear { index = items.firstIndex { $0.id == startId } ?? 0 }
  }

  @ViewBuilder
  private func details(_ item: AlbumItem) -> some View {
    let names = model.snapshot?.memberships ?? []
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      DetailItem(title: "名前", value: item.originalName)
      DetailItem(title: "大きさ", value: MemoAttachments.formatSize(item.byteSize) + ((item.width != nil && item.height != nil) ? " · \(item.width!)×\(item.height!)" : ""))
      if let takenAt = item.takenAt {
        DetailItem(title: Copy.ja.captureTimeCopy.heading, value: AlbumText.date(takenAt) + (item.takenAtSource.flatMap { Copy.ja.captureTimeCopy.sourceNote[$0.rawValue] }.map { "\n\($0)" } ?? ""))
      } else {
        DetailItem(title: Copy.ja.captureTimeCopy.added, value: AlbumText.date(item.createdAt))
      }
      DetailItem(title: "追加した人", value: memberName(names, item.uploaderMembershipId))
      DetailItem(title: "撮影場所", value: item.locationKept ? "撮影場所を残しています" : "撮影場所は取り除いて保存しています")
    }
    .padding(TokenSpace.space3)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
  }

  private func save(_ item: AlbumItem) async {
    saving = true
    defer { saving = false }
    let source = model.gateway.mediaSource(albumId: item.albumId, itemId: item.id, variant: .file)
    if case .sampleArt = source { model.announce("見本の写真は保存できません。"); return }
    if let url = await MediaCache.shared.file(source, name: item.originalName, gateway: model.gateway) { shared = SharedFile(url: url) }
    else { model.announce("ファイルを開けませんでした。閉じてから、もう一度開いてください。") }
  }

  /// 消したら次の項目へ。最後なら前の項目へ。何も残らなければ閉じる。
  private func remove(_ item: AlbumItem) {
    let next = AlbumView.neighbor(afterRemoving: item.id, in: items)
    onDelete(item)
    if next == nil || items.count <= 1 { dismiss(); return }
    if index >= items.count - 1 { index = max(0, index - 1) }
  }
}

/// スライドショー（Web の Slideshow.tsx）。写真は5秒ずつ、動画は終わるまで流す。曲は再生を押すまで鳴らさない。
struct SlideshowView: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.fhReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  let album: Album
  let items: [AlbumItem]
  @State private var index = 0
  @State private var lap = 0
  @State private var paused = false
  @State private var includeVideos = true
  @State private var music = false
  @State private var preset: BgmPreset = .calm
  @State private var volume = 0.5
  @State private var zoomed = false
  @State private var note = ""
  @State private var player = BgmPlayer()

  static let slideSeconds = 5.0

  var body: some View {
    let list = AlbumView.slideshow(items, includeVideos: includeVideos)
    let current = list.items.indices.contains(index) ? list.items[index] : nil
    NavigationStack {
      ZStack {
        Color.black.ignoresSafeArea()
        if let current {
          if current.kind == .video {
            MediaVideo(item: current, autoplay: !paused, muted: music) { advance(list.items.count) }.id("\(current.id)-\(lap)")
          } else {
            MediaImage(item: current, variant: .file, contentMode: .fit)
              .scaleEffect(reduceMotion ? 1 : (zoomed ? (index.isMultiple(of: 2) ? 1.07 : 1) : (index.isMultiple(of: 2) ? 1 : 1.07)))
              .animation(reduceMotion ? nil : .easeInOut(duration: 6), value: zoomed)
              .id("\(current.id)-\(lap)")
              .accessibilityLabel("写真「\(AlbumText.spoken(current))」")
              .onAppear { zoomed = false; DispatchQueue.main.async { zoomed = true } }
          }
        }
      }
      .safeAreaInset(edge: .bottom) {
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          if list.keptVideos { Text("写真がないので、動画を流しています。").font(.footnote).foregroundStyle(.white) }
          if !note.isEmpty { Text(note).font(.footnote).foregroundStyle(.white) }
          HStack(spacing: TokenSpace.space2) {
            Button { step(-1, count: list.items.count) } label: { Image(systemName: "backward.fill") }.fhButton(.secondary).accessibilityLabel("前へ")
            Button { paused.toggle() } label: { Image(systemName: paused ? "play.fill" : "pause.fill") }.fhButton(.primary).accessibilityLabel(paused ? "再生" : "一時停止")
            Button { step(1, count: list.items.count) } label: { Image(systemName: "forward.fill") }.fhButton(.secondary).accessibilityLabel("次へ")
            Spacer()
            Button(music ? "曲を止める" : "曲を流す") { toggleMusic() }.fhButton(.secondary).accessibilityIdentifier("albums.slideshow.bgm.toggle")
          }
          Toggle("動画も流す", isOn: $includeVideos).foregroundStyle(.white)
          Picker("曲", selection: $preset) {
            ForEach([BgmPreset.calm, .bright, .gentle], id: \.self) { Text(AlbumText.bgm($0)).tag($0) }
          }
          .pickerStyle(.segmented)
          HStack {
            Text("音量").foregroundStyle(.white)
            Slider(value: $volume, in: 0...1, step: 0.05).accessibilityLabel("音量")
          }
        }
        .padding(TokenSpace.space3)
        .background(.black.opacity(0.6))
      }
      .navigationTitle("\(min(index + 1, max(1, list.items.count)))/\(list.items.count) \(album.title)")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.close) { player.stop(); dismiss() } } }
    }
    .accessibilityLabel("スライドショー：\(album.title)")
    .onAppear { preset = album.bgmPreset ?? .calm }
    .task(id: "\(index)-\(lap)-\(paused)-\(includeVideos)") {
      // 写真は5秒で次へ。動画は終わったときに次へ進む。
      guard !paused, let current, current.kind == .photo else { return }
      try? await Task.sleep(for: .seconds(Self.slideSeconds))
      if !Task.isCancelled { advance(list.items.count) }
    }
    .onChange(of: preset) { _, next in if music { player.play(next) } }
    .onChange(of: volume) { _, value in player.setVolume(value) }
    .onChange(of: includeVideos) { _, _ in index = 0; lap += 1 }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active, music || !paused {
        paused = true
        if music { player.stop(); music = false }
        note = "アプリを離れたので止めました。再生で続きから流します。"
      }
    }
    .onDisappear { player.stop() }
  }

  private func advance(_ count: Int) { step(1, count: count) }

  private func step(_ direction: Int, count: Int) {
    index = AlbumView.step(index, length: count, by: direction)
    lap += 1
  }

  private func toggleMusic() {
    if music { player.stop(); music = false; return }
    player.setVolume(volume)
    if player.play(preset) { music = true; note = "" } else { note = "この環境では曲を再生できません。" }
  }
}
