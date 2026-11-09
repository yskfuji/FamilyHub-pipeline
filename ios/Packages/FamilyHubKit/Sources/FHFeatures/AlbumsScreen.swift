import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// アルバムの文言（Web の albumLabels.ts など）。
enum AlbumText {
  static func kind(_ item: AlbumItem) -> String { item.kind == .video ? "動画" : "写真" }

  /// 読み上げの名前。拡張子は読みにくいので外す。
  static func spoken(_ item: AlbumItem) -> String {
    let base = (item.originalName as NSString).deletingPathExtension
    return base.isEmpty ? item.originalName : base
  }

  /// 2026年9月20日 9:12（日本時間。Web の dateStyle long・timeStyle short）。
  static func date(_ value: Rfc3339) -> String {
    guard let date = Tokyo.parse(value) else { return value }
    let parts = Tokyo.components(of: date)
    return "\(parts.date.year)年\(parts.date.month)月\(parts.date.day)日 \(parts.hour):\(String(format: "%02d", parts.minute))"
  }

  static func taken(_ item: AlbumItem) -> String? {
    guard let takenAt = item.takenAt else { return nil }
    let estimated = item.takenAtSource.map { Copy.ja.captureTimeCopy.sourceNote[$0.rawValue] != nil } ?? false
    return "撮影 \(date(takenAt))\(estimated ? Copy.ja.captureTimeCopy.estimated : "")"
  }

  static func bgm(_ preset: BgmPreset) -> String {
    switch preset { case .bright: Copy.ja.bgmLabels.bright; case .gentle: Copy.ja.bgmLabels.gentle; default: Copy.ja.bgmLabels.calm }
  }
}

/// アルバムの画面（Web の src/features/albums/AlbumsPage.tsx）。一覧から押して中身へ進む。
/// 送信の待ち行列は一覧と中身で共有し、画面を行き来しても送り続ける。
struct AlbumsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var albums: [AlbumSummary]?
  @State private var error: GatewayError?
  @State private var path: Id?
  @State private var creating = false
  @State private var deleted: Album?
  @State private var uploads = AlbumUploadQueue()

  var body: some View {
    let colors = theme.colors
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("アルバム")
          Text("家族のアルバム").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("写真や動画をアルバムにまとめて、見せる相手を選んで残します。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        if model.can(.albumCreate) {
          Button { creating = true } label: { Label("アルバムを作る", systemImage: "plus") }.fhButton(.primary).accessibilityIdentifier("albums.create.open")
        }
        if uploads.activeCount > 0 {
          Callout(systemImage: "arrow.up.circle", title: "\(uploads.activeCount)件を送っています", detail: "アプリを閉じると、送信は止まります。", tone: .info)
        }
        if let deleted {
          Callout(systemImage: "trash", title: "「\(deleted.title)」を削除しました", detail: "7日以内は元に戻せます。", tone: .info) {
            Button(Copy.ja.ja.actions.restore) { Task { await restore(deleted) } }.fhButton(.secondary).accessibilityIdentifier("albums.restore")
          }
        }
        if let error {
          Callout(systemImage: "exclamationmark.triangle", title: error.message, tone: .plain) {
            Button("もう一度読み込む") { Task { await load() } }.fhButton(.secondary)
          }
        } else if let albums {
          if albums.isEmpty {
            EmptyStateView(title: "見られるアルバムはまだありません", message: model.can(.albumCreate) ? "運動会や旅行など、まとめたい写真ごとに作れます。" : "共有されると、ここに表示されます。", illustration: .emptyAlbums, compact: true) {
              if model.can(.albumCreate) { Button("アルバムを作る") { creating = true }.fhButton(.primary) }
            }
          } else {
            ForEach(albums) { album in AlbumCard(album: album) { path = album.id } }
          }
        } else {
          ProgressView("アルバムを読み込んでいます").frame(maxWidth: .infinity)
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: 900, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(colors.paper.color.ignoresSafeArea())
    .navigationDestination(item: $path) { id in
      AlbumDetailView(id: id, uploads: uploads) { album in
        deleted = album
        path = nil
        Task { await load() }
      }
    }
    .sheet(isPresented: $creating) { AlbumCreateSheet { path = $0.id; Task { await load() } } }
    .task { await load() }
    .onChange(of: path) { _, value in if value == nil { Task { await load() } } }
    .onChange(of: model.snapshot?.viewer.permissionRevision) { _, _ in Task { await load() } }
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.listAlbums() }) {
    case .success(let value): albums = value; error = nil
    case .failure(let failure): error = failure
    }
  }

  private func restore(_ album: Album) async {
    let id = album.id
    switch await model.mutate({ await $0.restoreAlbum(id: id) }) {
    case .success:
      deleted = nil
      model.announce("「\(album.title)」を元に戻しました")
      await load()
    case .failure(let failure): model.announce(failure.message)
    }
  }
}

/// 一覧のアルバム（表紙・名前・件数・公開範囲）。
struct AlbumCard: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let album: AlbumSummary
  let open: () -> Void
  @State private var cover: AlbumItem?

  var body: some View {
    let colors = theme.colors
    let names = model.snapshot?.memberships ?? []
    Button(action: open) {
      HStack(spacing: TokenSpace.space3) {
        Group {
          if let cover { MediaImage(item: cover, variant: .thumbnail) } else { ZStack { colors.line.color; Image(systemName: "photo").foregroundStyle(colors.inkSoft.color) } }
        }
        .frame(width: 96, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(album.title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).multilineTextAlignment(.leading)
          Text("\(album.itemCount)件").font(.footnote).foregroundStyle(colors.inkSoft.color)
          Label(Visibility.text(.album, album.visibility) { memberName(names, $0) }, systemImage: "lock").font(.footnote).foregroundStyle(colors.inkSoft.color).multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(TokenSpace.space3)
      .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
    .accessibilityHint("中身を開きます")
    .accessibilityIdentifier("albums.open.\(album.id)")
    .task(id: album.coverItemId) {
      // 表紙は、指定の項目か、縮小画像のある最初の項目。
      if case .success(let detail) = await model.gateway.getAlbum(id: album.id) { cover = AlbumView.cover(album.coverItemId, detail.items) }
    }
  }
}

/// アルバムの中身（Web の AlbumDetail.tsx）。
struct AlbumDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dynamicTypeSize) private var typeSize
  let id: Id
  let uploads: AlbumUploadQueue
  let onDeleted: (Album) -> Void

  @State private var detail: AlbumDetail?
  @State private var error: GatewayError?
  @State private var filter: AlbumFilter = .all
  @State private var sort: AlbumSort = .album
  @State private var organizing = false
  @State private var viewing: Id?
  @State private var slideshow = false
  @State private var adding = false
  @State private var editing = false
  @State private var deleting = false
  @State private var removedItem: AlbumItem?
  @State private var busy = false

  var body: some View {
    let colors = theme.colors
    Group {
      if let detail {
        content(detail)
      } else if let error {
        EmptyStateView(title: error.code == .notFound ? "アルバムが見つからないか、表示する権限がありません" : error.message,
                       message: error.code == .notFound ? "削除されたか、共有の範囲が変わった可能性があります。" : "接続を確かめてください。", illustration: .emptyAlbums) {
          Button("もう一度読み込む") { Task { await load() } }.fhButton(.secondary)
        }
        .padding(TokenSpace.space4)
      } else {
        ProgressView("写真と動画を読み込んでいます。").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(colors.paper.color.ignoresSafeArea())
    .navigationTitle(detail?.album.title ?? "アルバム")
    .inlineNavigationTitle()
    .task { await load() }
    .task(id: detail.map { AlbumView.hasProcessing($0.items) } ?? false) {
      // 確認中の項目があるうちは、1.5秒ごとに読み直す。
      while let detail, AlbumView.hasProcessing(detail.items), !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(1500))
        await load()
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .albumChanged)) { note in if note.object as? Id == id { Task { await load() } } }
  }

  private func load() async {
    switch await model.gateway.getAlbum(id: id) {
    case .success(let value): detail = value; error = nil
    case .failure(let failure): if detail == nil { error = failure }
    }
  }

  @ViewBuilder
  private func content(_ detail: AlbumDetail) -> some View {
    let colors = theme.colors
    let album = detail.album
    let viewer = model.snapshot?.viewer
    let names = model.snapshot?.memberships ?? []
    let canEdit = viewer.map { Policy.canMutateOwned($0, .albumUpdate, ownerMembershipId: album.creatorMembershipId) } ?? false
    let canUpload = canEdit || model.can(.albumCreate)
    let canDeleteAlbum = viewer.map { Policy.canDelete($0, .albumDelete, stakeholders: [album.creatorMembershipId]) } ?? false
    let ready = AlbumView.ready(detail.items)
    let counts = AlbumView.counts(detail.items)
    let shown = AlbumView.sort(AlbumView.grid(detail.items, filter), organizing ? .album : sort)
    let canDeleteItem = { (item: AlbumItem) in viewer.map { Policy.canDelete($0, .albumDelete, stakeholders: [album.creatorMembershipId, item.uploaderMembershipId]) } ?? false }
    let queued = uploads.entries(for: album.id)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Text(album.title).font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text([album.description, Visibility.text(.album, album.visibility) { memberName(names, $0) }].compactMap { $0 }.joined(separator: " · ")).font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          if canUpload { Button { adding = true } label: { Label("写真や動画を追加", systemImage: "plus") }.fhButton(.primary).accessibilityIdentifier("albums.detail.upload") }
          Button { slideshow = true } label: { Label("スライドショー", systemImage: "play.rectangle") }.fhButton(.secondary).disabled(ready.isEmpty).accessibilityIdentifier("albums.detail.slideshow")
          if (canEdit || ready.contains(where: canDeleteItem)) && !ready.isEmpty {
            Button(organizing ? "並べ替え・整理を終える" : "並べ替え・整理") { organizing.toggle() }.fhButton(.secondary)
              .accessibilityAddTraits(organizing ? .isSelected : [])
              .accessibilityIdentifier("albums.detail.organize")
          }
          HStack(spacing: TokenSpace.space2) {
            if canEdit { Button("編集") { editing = true }.fhButton(.secondary).accessibilityIdentifier("albums.detail.edit") }
            if canDeleteAlbum { Button("アルバムを削除") { deleting = true }.fhButton(.danger).accessibilityIdentifier("albums.detail.delete") }
          }
        }
        if !queued.isEmpty, !adding {
          let summary = AlbumUpload.summarize(queued.map(\.state))
          if summary.active > 0 {
            Callout(systemImage: "arrow.up.circle", title: "\(summary.active)件を送っています", tone: .info) {
              Button("状況を見る") { adding = true }.fhButton(.secondary)
            }
          }
        }
        if let removedItem {
          Callout(systemImage: "trash", title: "「\(removedItem.originalName)」を削除しました", detail: "7日以内は元に戻せます。", tone: .info) {
            Button(Copy.ja.ja.actions.restore) { Task { await restore(removedItem) } }.fhButton(.secondary).accessibilityIdentifier("albums.item.restore")
          }
        }
        Picker("表示する種類", selection: $filter) {
          ForEach(AlbumFilter.allCases, id: \.self) { Text("\($0.label) \(counts[$0] ?? 0)").tag($0) }
        }
        .pickerStyle(.segmented)
        if !organizing {
          Picker(Copy.ja.captureTimeCopy.sortLabel, selection: $sort) {
            ForEach(AlbumSort.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
          if sort == .taken { Text(Copy.ja.captureTimeCopy.sortNote).font(.footnote).foregroundStyle(colors.inkSoft.color) }
        }
        if shown.isEmpty {
          if filter == .all {
            EmptyStateView(title: "まだ写真や動画はありません", message: "追加すると、ここに並びます。", illustration: .emptyAlbums, compact: true) {
              if canUpload { Button("写真や動画を追加") { adding = true }.fhButton(.primary) }
            }
          } else {
            EmptyStateView(title: "\(filter.label)はありません", message: "ほかの種類を選んでください。", illustration: .emptyAlbums, compact: true)
          }
        } else if organizing {
          VStack(spacing: TokenSpace.space2) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
              organizeRow(item, index: index, shown: shown, album: album, canEdit: canEdit, canDelete: canDeleteItem(item), detail: detail)
            }
          }
        } else {
          grid(shown, cover: album.coverItemId)
        }
        let rejected = AlbumView.rejected(detail.items)
        if !rejected.isEmpty {
          Text("保存できなかったファイル").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          ForEach(rejected) { item in
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(item.originalName).foregroundStyle(colors.ink.color)
                Text(item.statusMessage ?? "").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
              }
              Spacer()
              Button("外す") { Task { await removeItem(item, announce: false) } }.fhButton(.secondary)
            }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .sheet(isPresented: $adding) { AlbumUploadSheet(albumId: album.id, uploads: uploads) }
    .sheet(isPresented: $editing) { AlbumEditSheet(album: album) { Task { await load() } } }
    .fullCover(item: Binding(get: { viewing.map { ViewerTarget(id: $0) } }, set: { viewing = $0?.id })) { target in
      AlbumViewer(items: AlbumView.ready(shown), startId: target.id, canDelete: canDeleteItem) { item in
        Task { await removeItem(item, announce: true) }
      }
    }
    .fullCover(isPresented: $slideshow) { SlideshowView(album: album, items: detail.items) }
    .confirmationDialog("アルバムを削除しますか", isPresented: $deleting, titleVisibility: .visible) {
      Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await deleteAlbum(album) } }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: { Text("「\(album.title)」と、中の写真や動画を削除します。7日以内なら元に戻せます。") }
  }

  private func columns() -> Int { typeSize.isAccessibilitySize ? 2 : sizeClass == .compact ? 3 : 5 }

  /// 写真を並べる。遅延の格子は文字の大きさの監査に合わないので、行に分けて並べる。
  private func grid(_ items: [AlbumItem], cover: Id?) -> some View {
    let colors = theme.colors
    let count = columns()
    let rows = stride(from: 0, to: items.count, by: count).map { Array(items[$0..<min($0 + count, items.count)]) }
    return VStack(spacing: TokenSpace.space2) {
      ForEach(rows, id: \.first!.id) { row in
        HStack(spacing: TokenSpace.space2) {
          ForEach(row) { item in
            Button { if item.status == .ready { viewing = item.id } } label: {
              ZStack(alignment: .bottomLeading) {
                MediaImage(item: item, variant: .thumbnail)
                  .aspectRatio(1, contentMode: .fill)
                  .frame(maxWidth: .infinity)
                  .clipShape(RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
                VStack(alignment: .leading, spacing: 2) {
                  if item.kind == .video { Image(systemName: "play.circle.fill").foregroundStyle(.white).shadow(radius: 2) }
                  if item.id == cover { StatusBadge("表紙") }
                  if item.status == .processing { StatusBadge("確認しています…", tone: .attention) }
                  if item.locationKept { StatusBadge("撮影場所を残しています", systemImage: "mappin") }
                }
                .padding(4)
              }
            }
            .buttonStyle(.plain)
            .disabled(item.status != .ready)
            .accessibilityLabel("\(AlbumText.kind(item))「\(AlbumText.spoken(item))」を開く")
            .accessibilityIdentifier("albums.item.open.\(item.id)")
          }
          ForEach(row.count..<count, id: \.self) { _ in colors.paper.color.frame(maxWidth: .infinity).accessibilityHidden(true) }
        }
      }
    }
  }

  @ViewBuilder
  private func organizeRow(_ item: AlbumItem, index: Int, shown: [AlbumItem], album: Album, canEdit: Bool, canDelete: Bool, detail: AlbumDetail) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      HStack(spacing: TokenSpace.space3) {
        MediaImage(item: item, variant: .thumbnail).frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: TokenRadius.radiusSm)).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(item.originalName).foregroundStyle(colors.ink.color)
          Text([AlbumText.kind(item), item.status == .processing ? "確認しています…" : nil, item.id == album.coverItemId ? "表紙" : nil].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
      }
      .accessibilityElement(children: .combine)
      HStack(spacing: TokenSpace.space2) {
        if canEdit {
          Button("前へ") { Task { await move(item, step: -1, shown: shown, detail: detail) } }.fhButton(.secondary).disabled(index == 0 || busy).accessibilityLabel("「\(AlbumText.spoken(item))」を前へ")
          Button("後ろへ") { Task { await move(item, step: 1, shown: shown, detail: detail) } }.fhButton(.secondary).disabled(index == shown.count - 1 || busy).accessibilityLabel("「\(AlbumText.spoken(item))」を後ろへ")
          Button("表紙にする") { Task { await setCover(item, album: album) } }.fhButton(.secondary)
            .disabled(item.status != .ready || !item.hasThumbnail || item.id == album.coverItemId || busy)
            .accessibilityLabel("「\(AlbumText.spoken(item))」を表紙にする")
        }
        if canDelete { Button("削除") { Task { await removeItem(item, announce: true) } }.fhButton(.danger).accessibilityLabel("「\(AlbumText.spoken(item))」を削除") }
      }
    }
    .padding(TokenSpace.space3)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
  }

  private func move(_ item: AlbumItem, step: Int, shown: [AlbumItem], detail: AlbumDetail) async {
    let order = AlbumView.move(detail.items.map(\.id), visible: shown.map(\.id), id: item.id, step: step)
    // すぐに並べ替えて見せ、送った結果で確かめる。
    var next = detail
    next.items = order.compactMap { id in detail.items.first { $0.id == id } }
    self.detail = next
    busy = true
    defer { busy = false }
    let albumId = detail.album.id, version = detail.album.version
    switch await model.mutate({ await $0.reorderItems(albumId: albumId, itemIds: order, expectedVersion: version) }) {
    case .success(let album): self.detail?.album = album
    case .failure(let failure): model.announce(failure.message); await load()
    }
  }

  private func setCover(_ item: AlbumItem, album: Album) async {
    let input = { var input = AlbumUpdateInput(); input.coverItemId = .set(item.id); return input }()
    let id = album.id, version = album.version
    switch await model.mutate({ await $0.updateAlbum(id: id, input: input, expectedVersion: version) }) {
    case .success: model.announce("「\(item.originalName)」を表紙にしました"); await load()
    case .failure(let failure): model.announce(failure.message)
    }
  }

  private func removeItem(_ item: AlbumItem, announce: Bool) async {
    let albumId = item.albumId, itemId = item.id
    switch await model.mutate({ await $0.deleteItem(albumId: albumId, itemId: itemId) }) {
    case .success:
      if announce { removedItem = item; model.announce("「\(item.originalName)」を削除しました") }
      await load()
    case .failure(let failure): model.announce(failure.message)
    }
  }

  private func restore(_ item: AlbumItem) async {
    let albumId = item.albumId, itemId = item.id
    switch await model.mutate({ await $0.restoreItem(albumId: albumId, itemId: itemId) }) {
    case .success: removedItem = nil; model.announce("「\(item.originalName)」を元に戻しました"); await load()
    case .failure(let failure): model.announce(failure.message)
    }
  }

  private func deleteAlbum(_ album: Album) async {
    let id = album.id, version = album.version
    switch await model.mutate({ await $0.deleteAlbum(id: id, expectedVersion: version) }) {
    case .success: onDeleted(album)
    case .failure(let failure): model.announce(failure.message)
    }
  }
}

struct ViewerTarget: Identifiable { let id: Id }
