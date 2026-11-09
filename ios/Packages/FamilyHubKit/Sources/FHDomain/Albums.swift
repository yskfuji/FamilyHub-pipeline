import Foundation
import FHModel
import FHCopy

// アルバムの一覧・送信・入力・曲。元: src/domain/albumView.ts、albumUpload.ts、albumForm.ts、mediaLimits.ts、
// src/features/albums/bgm.ts の barNotes。

public enum AlbumFilter: String, CaseIterable, Sendable, Codable {
  case all, photos, videos
  public static func parse(_ value: String?) -> AlbumFilter { value == "photos" ? .photos : value == "videos" ? .videos : .all }
  public var label: String { switch self { case .all: "すべて"; case .photos: "写真"; case .videos: "動画" } }
}

public enum AlbumSort: String, CaseIterable, Sendable, Codable {
  case album, taken
  public static func parse(_ value: String?) -> AlbumSort { value == "taken" ? .taken : .album }
  public var label: String { self == .album ? "アルバムの順" : "撮影日順" }
}

public enum AlbumView {
  /// 同じファイルが送られたときの文言。失敗ではないので、ほかの拒否と分けて扱う。
  public static let duplicateMessage = "同じ写真がすでにあります。"
  public static let swipeDistance = 48.0

  public static func isDuplicate(_ item: AlbumItem) -> Bool { item.status == .rejected && item.statusMessage == duplicateMessage }
  public static func rejected(_ items: [AlbumItem]) -> [AlbumItem] { items.filter { $0.status == .rejected && !isDuplicate($0) } }
  public static func ready(_ items: [AlbumItem]) -> [AlbumItem] { items.filter { $0.status == .ready } }
  public static func hasProcessing(_ items: [AlbumItem]) -> Bool { items.contains { $0.status == .processing } }

  static func matches(_ item: AlbumItem, _ filter: AlbumFilter) -> Bool { filter == .all || (filter == .videos) == (item.kind == .video) }

  /// 一覧に並べる項目。送っている途中の分は、送った人の待ち行列に出る。
  public static func grid(_ items: [AlbumItem], _ filter: AlbumFilter) -> [AlbumItem] {
    items.filter { ($0.status == .ready || $0.status == .processing) && matches($0, filter) }
  }

  public static func counts(_ items: [AlbumItem]) -> [AlbumFilter: Int] {
    Dictionary(uniqueKeysWithValues: AlbumFilter.allCases.map { ($0, grid(items, $0).count) })
  }

  /// 表示している項目の中で1つ前か後へ動かした、全体の並び。
  public static func move(_ order: [Id], visible: [Id], id: Id, step: Int) -> [Id] {
    guard let index = visible.firstIndex(of: id), visible.indices.contains(index + step) else { return order }
    let neighbor = visible[index + step]
    return order.map { $0 == id ? neighbor : $0 == neighbor ? id : $0 }
  }

  /// 表紙にする項目。指定が消えていたら、縮小画像のある最初の項目。
  public static func cover(_ coverItemId: Id?, _ items: [AlbumItem]) -> AlbumItem? {
    let usable = ready(items).filter(\.hasThumbnail)
    return usable.first { $0.id == coverItemId } ?? usable.first
  }

  /// 前後への移動。端まで行ったら反対の端へ戻る。
  /// 画面は1つずつしか動かさない。Web と同じ式にする（剰余は JS と同じく、負の数は負のまま）。
  public static func step(_ index: Int, length: Int, by step: Int) -> Int { length > 0 ? (index + step + length) % length : 0 }

  /// 横の払いの向き。前へ戻るなら -1、次へ進むなら 1、縦の動きや短い動きなら 0。
  public static func swipe(_ dx: Double, _ dy: Double) -> Int {
    if abs(dx) < swipeDistance || abs(dx) <= abs(dy) { return 0 }
    return dx < 0 ? 1 : -1
  }

  /// 動画を外すと何も残らないアルバムでは、動画のまま流す。
  public static func slideshow(_ items: [AlbumItem], includeVideos: Bool) -> (items: [AlbumItem], keptVideos: Bool) {
    let all = ready(items)
    if includeVideos { return (all, false) }
    let photos = all.filter { $0.kind == .photo }
    return photos.isEmpty ? (all, !all.isEmpty) : (photos, false)
  }

  /// 項目を消したあとに開く項目。次がなければ前。
  public static func neighbor(afterRemoving id: Id, in items: [AlbumItem]) -> AlbumItem? {
    // 見つからないときは Web と同じく先頭（items[-1 + 1]）。
    guard let index = items.firstIndex(where: { $0.id == id }) else { return items.first }
    if items.indices.contains(index + 1) { return items[index + 1] }
    return items.indices.contains(index - 1) ? items[index - 1] : nil
  }

  /// 撮影日順では古い順にし、撮影日時の分からない項目は最後。同じ日時と分からない項目どうしは、アルバムの順を保つ。
  public static func sort(_ items: [AlbumItem], _ sort: AlbumSort) -> [AlbumItem] {
    guard sort == .taken else { return items }
    let keyed = items.enumerated().map { (item: $0.element, index: $0.offset, at: $0.element.takenAt.flatMap(Tokyo.parse)?.timeIntervalSince1970) }
    return keyed.sorted { a, b in
      if (a.at != nil) != (b.at != nil) { return a.at != nil }
      if let x = a.at, let y = b.at, x != y { return x < y }
      return a.index < b.index
    }.map(\.item)
  }
}

public enum UploadState: String, Sendable, Codable { case staged, waiting, sending, processing, done, duplicate, rejected, failed
  public var label: String {
    switch self {
    case .staged: "送る前"
    case .waiting: "順番を待っています"
    case .sending: "送っています…"
    case .processing: "確認しています…"
    case .done: "追加しました"
    case .duplicate: "同じファイルがあるため追加していません"
    case .rejected: "追加できません"
    case .failed: "送れませんでした"
    }
  }
}

public enum AlbumUpload {
  public static let maxSimultaneous = 3
  public static let photoBytes = 100 * 1024 * 1024
  public static let videoBytes = 4 * 1024 * 1024 * 1024
  public static let quotaBytes = 20 * 1024 * 1024 * 1024
  public static let chunkBytes = 8 * 1024 * 1024
  public static let heicMessage = "HEIC の写真は受け付けていません。JPEG で保存し直してください。"
  static let accepted: Set<String> = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"]
  static let typeByExtension = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "mp4": "video/mp4", "mov": "video/quicktime"]
  static let heicType = JSRegex("hei[cf]", ignoreCase: true)
  static let heicName = JSRegex("\\.hei[cf]$", ignoreCase: true)

  public static func type(name: String, type: String) -> String {
    if !type.isEmpty { return type }
    let ext = name.split(separator: ".", omittingEmptySubsequences: false).last.map { String($0).jsLowercased } ?? ""
    return typeByExtension[ext] ?? ""
  }

  /// 送っても受け付けられないファイルの理由。問題がなければ nil。
  public static func problem(name: String, type: String, size: Int) -> String? {
    let kind = self.type(name: name, type: type)
    if heicType.test(kind) || heicName.test(name) { return heicMessage }
    if !accepted.contains(kind) { return "JPEG・PNG・MP4・MOV のファイルを選んでください。" }
    if size <= 0 { return "中身のないファイルは追加できません。" }
    if kind.hasPrefix("video/") { return size > videoBytes ? "動画は4GBまでです。" : nil }
    return size > photoBytes ? "写真は100MBまでです。" : nil
  }

  public struct Summary: Codable, Sendable, Hashable {
    public var staged: Int
    public var finished: Int
    public var duplicates: Int
    public var failed: Int
    public var active: Int
    public var total: Int
  }

  public static func summarize(_ states: [UploadState]) -> Summary {
    let count = { (set: [UploadState]) in states.filter(set.contains).count }
    let staged = count([.staged])
    return Summary(staged: staged, finished: count([.done, .duplicate]), duplicates: count([.duplicate]), failed: count([.failed, .rejected]), active: count([.waiting, .sending, .processing]), total: states.count - staged)
  }

  /// 次に送る位置。受け取った側の処理が終わるまでは、上限の数に入る。
  public static func nextToSend(_ states: [UploadState], limit: Int = maxSimultaneous) -> [Int] {
    let active = states.filter { $0 == .sending || $0 == .processing }.count
    return Array(states.indices.filter { states[$0] == .waiting }.prefix(max(0, limit - active)))
  }

  /// 送る前のファイルを、同じアルバムの中で1つ前か後へ動かす（位置の並びを返す）。
  public static func moveStaged(states: [UploadState], albums: [Id], index: Int, step: Int) -> [Int] {
    let identity = Array(states.indices)
    guard states.indices.contains(index), states[index] == .staged else { return identity }
    let staged = states.indices.filter { states[$0] == .staged && albums[$0] == albums[index] }
    guard let position = staged.firstIndex(of: index), staged.indices.contains(position + step) else { return identity }
    let neighbor = staged[position + step]
    return identity.map { $0 == index ? neighbor : $0 == neighbor ? index : $0 }
  }

  /// 進み具合。受け取り後の処理の間は 100% のまま。
  public static func percent(sent: Int, total: Int) -> Int {
    total > 0 ? min(100, Int(floor(Double(sent) / Double(total) * 100 + 0.5))) : 0
  }
}

public struct AlbumDraft: Sendable, Hashable, Codable {
  public var title: String
  public var description: String
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  /// 空なら指定なし。
  public var bgmPreset: String
  public init(title: String, description: String, audience: VisibilityAudience, selectedIds: [Id], bgmPreset: String) {
    self.title = title; self.description = description; self.audience = audience; self.selectedIds = selectedIds; self.bgmPreset = bgmPreset
  }
}

public enum AlbumForm {
  public static let titleLimit = 120
  public static let descriptionLimit = 2000

  public static func newDraft(audience: VisibilityAudience) -> AlbumDraft { AlbumDraft(title: "", description: "", audience: audience, selectedIds: [], bgmPreset: "") }

  public static func draft(from album: Album) -> AlbumDraft {
    AlbumDraft(title: album.title, description: album.description ?? "", audience: album.visibility.audience, selectedIds: album.visibility.selectedMembershipIds, bgmPreset: album.bgmPreset?.rawValue ?? "")
  }

  public static func problem(_ draft: AlbumDraft) -> String? {
    if Account.jsTrim(draft.title).isEmpty { return "アルバム名を入力してください。" }
    return Visibility.problem(draft.audience, draft.selectedIds)
  }

  public static func createInput(_ draft: AlbumDraft) -> AlbumInput {
    let description = Account.jsTrim(draft.description)
    return AlbumInput(title: Account.jsTrim(draft.title), description: description.isEmpty ? nil : description, bgmPreset: draft.bgmPreset.isEmpty ? nil : BgmPreset(rawValue: draft.bgmPreset),
                      visibility: VisibilityInput(audience: draft.audience, selectedMembershipIds: draft.selectedIds))
  }

  /// 変更の入力。説明と曲は空にすると外す。公開範囲は変えたときだけ送る。
  public static func updateInput(_ draft: AlbumDraft, original: Album) -> AlbumUpdateInput {
    var input = AlbumUpdateInput()
    input.title = Account.jsTrim(draft.title)
    let description = Account.jsTrim(draft.description)
    input.description = description.isEmpty ? .clear : .set(description)
    input.bgmPreset = draft.bgmPreset.isEmpty ? .clear : .set(BgmPreset(rawValue: draft.bgmPreset))
    input.visibility = Visibility.change(draft.audience, draft.selectedIds, original: original.visibility)
    return input
  }
}

/// スライドショーの曲（音源は持たず、和音からその場で合成する）。元: src/features/albums/bgm.ts。
public enum BgmSound {
  public enum Wave: String, Sendable, Codable { case sine, triangle }

  public struct Preset: Sendable {
    public var bpm: Double
    public var chords: [[Int]]
    public var pattern: [Int]
    public var pad: Wave
    public var pluck: Wave
    public var padLevel: Double
    public var pluckLevel: Double
    public var cutoffHz: Double
  }

  public struct Note: Sendable, Hashable, Codable {
    public var frequency: Double
    public var beat: Double
    public var beats: Double
    public var level: Double
    public var wave: Wave
  }

  public static let beatsPerBar = 4.0

  public static func preset(_ preset: BgmPreset) -> Preset {
    switch preset {
    case .bright: Preset(bpm: 104, chords: [[50, 57, 66, 74], [45, 57, 64, 73], [47, 54, 62, 71], [43, 55, 62, 71]], pattern: [1, 3, 2, 3, 1, 3, 2, 3], pad: .triangle, pluck: .triangle, padLevel: 0.07, pluckLevel: 0.14, cutoffHz: 2600)
    case .gentle: Preset(bpm: 76, chords: [[41, 57, 65, 72], [38, 57, 62, 69], [46, 58, 65, 74], [48, 55, 64, 72]], pattern: [1, 2, 3, 2, 3, 2], pad: .sine, pluck: .triangle, padLevel: 0.09, pluckLevel: 0.11, cutoffHz: 1500)
    default: Preset(bpm: 58, chords: [[48, 55, 64, 72], [43, 55, 62, 71], [45, 52, 60, 69], [41, 53, 60, 69]], pattern: [1, 2, 3, 2], pad: .sine, pluck: .sine, padLevel: 0.11, pluckLevel: 0.12, cutoffHz: 900)
    }
  }

  public static func hz(_ note: Int) -> Double { 440 * pow(2, Double(note - 69) / 12) }

  /// 1小節に鳴らす音。
  public static func barNotes(_ name: BgmPreset, bar: Int) -> [Note] {
    let sound = preset(name)
    let chord = sound.chords[bar % sound.chords.count]
    let pad = chord.prefix(3).map { Note(frequency: hz($0), beat: 0, beats: beatsPerBar, level: sound.padLevel, wave: sound.pad) }
    let step = beatsPerBar / Double(sound.pattern.count)
    let plucks = sound.pattern.enumerated().map { Note(frequency: hz(chord[$0.element]), beat: Double($0.offset) * step, beats: step * 1.6, level: sound.pluckLevel, wave: sound.pluck) }
    return pad + plucks
  }

  public static func barSeconds(_ name: BgmPreset) -> Double { beatsPerBar * 60 / preset(name).bpm }
}
