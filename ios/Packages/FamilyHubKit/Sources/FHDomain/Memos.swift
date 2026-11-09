import Foundation
import FHModel
import FHCopy

// メモの入力・一覧・添付。元: src/domain/memoForm.ts、memoList.ts、memoAttachments.ts、
// src/features/notes/attachmentKinds.ts、pdfOptions.ts の safeLinkUrl、NotesPage.tsx の検索。

public struct MemoDraft: Sendable, Hashable, Codable {
  public var title: String
  public var body: String
  /// 読点またはカンマで区切ったタグ。
  public var tags: String
  /// YYYY-MM-DD。空なら指定なし。
  public var memoDate: String
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  public var place: PlaceRef?

  public init(title: String, body: String, tags: String, memoDate: String, audience: VisibilityAudience, selectedIds: [Id], place: PlaceRef?) {
    self.title = title; self.body = body; self.tags = tags; self.memoDate = memoDate; self.audience = audience; self.selectedIds = selectedIds; self.place = place
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(title, forKey: .title)
    try container.encode(body, forKey: .body)
    try container.encode(tags, forKey: .tags)
    try container.encode(memoDate, forKey: .memoDate)
    try container.encode(audience, forKey: .audience)
    try container.encode(selectedIds, forKey: .selectedIds)
    try container.encode(place, forKey: .place)
  }
}

public enum MemoForm {
  public static let maxTags = 10
  public static let titleLimit = 120
  public static let bodyLimit = 5000
  public static let ocrLimit = 8000

  /// 読点またはカンマで区切る。前後の空白は外し、空のものは捨てる。
  public static func parseTags(_ text: String) -> [String] {
    text.split(omittingEmptySubsequences: false) { $0 == "," || $0 == "、" }.map { Account.jsTrim(String($0)) }.filter { !$0.isEmpty }
  }

  public static func newDraft(date: String, audience: VisibilityAudience) -> MemoDraft {
    MemoDraft(title: "", body: "", tags: "", memoDate: date, audience: audience, selectedIds: [], place: nil)
  }

  public static func draft(from memo: Memo) -> MemoDraft {
    MemoDraft(title: memo.title, body: memo.body, tags: memo.tags.joined(separator: "、"), memoDate: memo.memoDate ?? "",
              audience: memo.visibility.audience, selectedIds: memo.visibility.selectedMembershipIds, place: memo.place)
  }

  public static func problem(_ draft: MemoDraft) -> String? {
    if Account.jsTrim(draft.title).isEmpty { return "タイトルを入力してください。" }
    if Account.jsTrim(draft.body).isEmpty { return "本文を入力してください。" }
    if parseTags(draft.tags).count > maxTags { return "タグは\(maxTags)件までです。" }
    return Visibility.problem(draft.audience, draft.selectedIds)
  }

  public static func createInput(_ draft: MemoDraft) -> MemoInput {
    MemoInput(title: Account.jsTrim(draft.title), body: Account.jsTrim(draft.body), tags: parseTags(draft.tags), place: draft.place,
              memoDate: draft.memoDate.isEmpty ? nil : draft.memoDate,
              visibility: VisibilityInput(audience: draft.audience, selectedMembershipIds: draft.selectedIds))
  }

  /// 変更の入力。日付は空にすると外す。場所と公開範囲は変えたときだけ送る。
  public static func updateInput(_ draft: MemoDraft, original: Memo) -> MemoUpdateInput {
    var input = MemoUpdateInput()
    input.title = Account.jsTrim(draft.title)
    input.body = Account.jsTrim(draft.body)
    input.tags = parseTags(draft.tags)
    input.memoDate = draft.memoDate.isEmpty ? .clear : .set(draft.memoDate)
    if draft.place != original.place { input.place = Patch.orClear(draft.place) }
    input.visibility = Visibility.change(draft.audience, draft.selectedIds, original: original.visibility)
    return input
  }

  /// 文字認識の結果の変更。空白だけなら外す。それ以外は入れたまま（前後の空白も）残す。
  public static func ocrInput(_ text: String) -> MemoUpdateInput {
    var input = MemoUpdateInput()
    input.ocrText = Account.jsTrim(text).isEmpty ? .clear : .set(text)
    return input
  }
}

/// メモの一覧の並び順。Web の URL の sort の値と同じ。
public enum MemoSort: String, CaseIterable, Sendable, Codable {
  case newest, oldest
  public static func parse(_ value: String?) -> MemoSort { value == "oldest" ? .oldest : .newest }
  public var label: String { self == .newest ? Copy.ja.ja.memoSort.newest : Copy.ja.ja.memoSort.oldest }
}

public enum MemoList {
  /// メモの日付。指定がなければ最後に変更した日（日本時間）。
  public static func dateKey(_ memo: Memo) -> String { memo.memoDate ?? CalendarDate.dateKey(fromRfc3339: memo.updatedAt) ?? "" }

  /// 日付で並べる。同じ日は変更した時刻、さらに ID の順にして、読み直しても動かない。
  public static func sort(_ memos: [Memo], _ sort: MemoSort) -> [Memo] {
    let direction = sort == .newest ? -1 : 1
    return memos.stableSorted { a, b in
      var order = jsLocaleCompare(dateKey(a), dateKey(b))
      if order == 0 { order = jsLocaleCompare(a.updatedAt, b.updatedAt) }
      if order == 0 { order = jsLocaleCompare(a.id, b.id) }
      return order * direction < 0
    }
  }

  /// 検索。タイトル・本文・文字認識の結果・タグ・場所の名前を、小文字にして部分一致で探す。
  public static func matches(_ memo: Memo, query: String) -> Bool {
    let needle = Account.jsTrim(query).jsLowercased
    let haystack = ([memo.title, memo.body, memo.ocrText ?? ""] + memo.tags + [memo.place?.name ?? ""]).joined(separator: " ").jsLowercased
    return haystack.jsIncludes(needle)
  }
}

/// アプリの中でどう開くか。API が inline で配るのと同じ種類だけを表示し、ほかは「保存して開く」にする。
public enum AttachmentViewerKind: String, Sendable, Codable { case image, video, pdf, other
  public init(mimeType: String) {
    self = switch mimeType {
    case "image/jpeg", "image/png": .image
    case "video/mp4": .video
    case "application/pdf": .pdf
    default: .other
    }
  }
}

public enum MemoAttachments {
  public static let documentMaxBytes = 10_000_000
  public static let videoMaxBytes = 120_000_000
  public static let limitsText = "PDF・JPEG・PNGは10MBまで、MP4は120MBまで添付できます。保存できるのは家族全体で1GBまでです。"

  static let typeByExtension = ["pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "mp4": "video/mp4"]
  static let allowedTypes = Set(typeByExtension.values)

  /// 種類がわからないときは拡張子で判断する。
  public static func type(name: String, type: String) -> String {
    if !type.isEmpty { return type }
    let ext = name.split(separator: ".", omittingEmptySubsequences: false).last.map { String($0).jsLowercased } ?? ""
    return typeByExtension[ext] ?? ""
  }

  /// 送っても受け付けられないファイルの理由。問題がなければ nil。
  public static func problem(name: String, type: String, size: Int) -> String? {
    let kind = self.type(name: name, type: type)
    if !allowedTypes.contains(kind) { return "添付できるのはPDF・JPEG・PNG・MP4です。" }
    if kind == "video/mp4" { return size > videoMaxBytes ? "動画は120MB以内にしてください。" : nil }
    return size > documentMaxBytes ? "PDFと画像は10MB以内にしてください。" : nil
  }

  /// 842 KB、1.3 MB。
  public static func formatSize(_ bytes: Int) -> String {
    if bytes < 1_000_000 { return "\(max(1, jsRound(Double(bytes) / 1000))) KB" }
    return "\(jsToFixed1(Double(bytes) / 1_000_000)) MB"
  }

  /// PDF の中のリンクで開いてよいのは http と https だけ。返すのは URL の正規の形（WHATWG の href に合わせ、スキームと名前を小文字にし、既定のポートを外し、空の道を / にする）。
  public static func safeLinkURL(_ value: String) -> String? {
    // WHATWG と同じく、前後の空白は外して読む。
    let text = Account.jsTrim(value)
    guard let parts = WebURL.parse(text), parts.scheme == "https" || parts.scheme == "http",
          var components = URLComponents(string: text), let host = components.host, !host.isEmpty else { return nil }
    components.scheme = parts.scheme
    components.host = host.lowercased()
    if components.port == (parts.scheme == "https" ? 443 : 80) { components.port = nil }
    if components.path.isEmpty { components.path = "/" }
    return components.string
  }

  /// 状態の名前（ja.attachmentStatus）。
  public static func statusLabel(_ status: AttachmentStatus) -> String {
    let labels = Copy.ja.ja.attachmentStatus.self
    return switch status {
    case .selected: labels.selected
    case .validating: labels.validating
    case .quarantined: labels.quarantined
    case .clean: labels.clean
    case .rejected: labels.rejected
    default: status.rawValue
    }
  }
}

/// Math.round（.5 は大きい方へ）。
func jsRound(_ value: Double) -> Int { Int(floor(value + 0.5)) }

/// Number.prototype.toFixed(1)。2進の値そのものを10進に広げ、ちょうど半分なら大きい方へ丸める（printf は偶数へ丸めるので使わない）。
func jsToFixed1(_ value: Double) -> String {
  let exact = String(format: "%.40f", abs(value))
  let parts = exact.split(separator: ".")
  let whole = String(parts[0]), fraction = Array(parts.count > 1 ? parts[1] : "0")
  let rest = fraction.dropFirst()
  let up = rest.first.map { $0 > "5" || ($0 == "5") } ?? false
  var tenths = (Int(whole) ?? 0) * 10 + Int(String(fraction[0]))!
  if up { tenths += 1 }
  return "\(value < 0 && tenths > 0 ? "-" : "")\(tenths / 10).\(tenths % 10)"
}
