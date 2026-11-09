import Foundation
import FHModel
import FHCopy

// 設定（段階 S7）の規則。元: src/domain/householdLimits.ts、src/authz/policy.ts、src/domain/auditView.ts、
// src/content/auditLabels.ts、src/content/help.ts、src/domain/schemas.ts（色のリスト・家族の名前）、
// src/features/settings/*.tsx の画面の中の決まり。

/// 家族グループの人数と名前の変更の決まり。
public enum HouseholdLimits {
  /// 1つの家族グループで利用できる人数。
  public static let maxMembers = 8
  /// 家族グループの名前を変えられる回数（24時間あたり）。
  public static let maxNameChangesPerDay = 3

  /// 直近24時間の名前の変更。
  public static func recentNameChanges(_ changes: [Rfc3339]?, now: Rfc3339) -> [Rfc3339] {
    let current = TodayDigest.milliseconds(now)
    return (changes ?? []).filter { current - TodayDigest.milliseconds($0) < 86_400_000 }
  }

  public static func nameChangesLeft(_ changes: [Rfc3339]?, now: Rfc3339) -> Int {
    max(0, maxNameChangesPerDay - recentNameChanges(changes, now: now).count)
  }

  public static func activeMemberCount(_ memberships: [HouseholdMembership]) -> Int {
    memberships.filter { $0.status == .active }.count
  }

  /// 利用中の管理者。最後の1人は退出できない。
  public static func activeOwners(_ memberships: [HouseholdMembership]) -> [HouseholdMembership] {
    memberships.filter { $0.role == .owner && $0.status == .active }
  }

  public enum LeaveState: String, Sendable, Codable { case member, coOwner = "co-owner", soleOwner = "sole-owner" }

  /// 退出の画面に出すもの。管理者でなければ member、ほかにも利用中の管理者がいれば co-owner、自分だけなら sole-owner。
  public static func leaveState(_ memberships: [HouseholdMembership], viewer: Id) -> LeaveState {
    guard memberships.first(where: { $0.id == viewer })?.role == .owner else { return .member }
    return activeOwners(memberships).contains { $0.id != viewer } ? .coOwner : .soleOwner
  }

  /// 家族グループの名前の確かめ（householdProfileSchema）。
  public static func nameProblem(_ name: String) -> String? {
    let trimmed = Account.jsTrim(name)
    if trimmed.isEmpty { return "家族グループの名前を入力してください。" }
    if trimmed.unicodeScalars.count > 40 { return "40文字以内で入力してください。" }
    return nil
  }

  /// 退出の文（ja.ts の leaveCopy.coOwner・confirmOwner）。
  public static func coOwnerText(_ others: String) -> String {
    "ほかに管理者（\(others)さん）がいるので、退出できます。退出すると、この家族の情報は表示できなくなり、メンバーの管理は\(others)さんが続けます。作った記録は残ります。"
  }

  public static func confirmOwnerText(_ name: String, _ others: String) -> String {
    "「\(name)」の情報は表示できなくなります。管理者の役割は外れ、\(others)さんが管理者として残ります。元に戻すには、新しい招待コードで参加し直し、管理者を渡してもらう必要があります。"
  }

  /// ほかの利用中の管理者の名前（「碧さん、蓮」のように「さん、」でつなぐ）。
  public static func otherOwners(_ memberships: [HouseholdMembership], viewer: Id) -> String {
    activeOwners(memberships).filter { $0.id != viewer }.map(\.displayName).joined(separator: "さん、")
  }
}

/// 役割ごとの能力（src/authz/policy.ts）。権限の画面で「標準」と、個別に変えられる項目を出す。
public enum RoleCapabilities {
  public static let all: [Capability] = [
    "household.members.read", "household.members.manage", "household.invites.manage",
    "event.read", "event.create", "event.update", "event.delete",
    "task.read", "task.create", "task.update", "task.delete", "task.transition",
    "memo.read", "memo.create", "memo.update", "memo.delete", "memo.attach",
    "expense.read", "expense.create", "expense.update", "expense.delete", "expense.settle",
    "album.read", "album.create", "album.update", "album.delete",
    "link.manage", "assistant.use",
    "place.read",
    "insight.read", "resource.read", "settings.own", "notification.manage",
    "audit.read",
  ]

  /// 管理者だけが持てる能力。大人の上限に入れない。
  static func ownerOnly(_ item: Capability) -> Bool {
    (item.rawValue.hasPrefix("household.") && item != .membersRead) || item.rawValue == "audit.read"
  }

  public static func ceiling(_ role: MembershipRole) -> [Capability] {
    switch role {
    case .owner: return all
    case .adult: return all.filter { !ownerOnly($0) }
    case .child:
      return [
        "event.read", "event.create", "event.update", "event.delete",
        "task.read", "task.create", "task.update", "task.delete", "task.transition",
        "memo.read", "memo.create", "memo.update", "memo.delete", "memo.attach",
        "album.read", "album.create", "album.update", "album.delete",
        "resource.read", "settings.own", "notification.manage",
      ]
    case .guest: return ["event.read", "task.read", "memo.read", "album.read", "resource.read", "settings.own", "notification.manage"]
    default: return []
    }
  }

  /// 役割の標準（今は上限と同じ）。
  public static func defaults(_ role: MembershipRole) -> [Capability] { ceiling(role) }

  /// 個別設定を当てたあとの能力。
  public static func capabilities(_ role: MembershipRole, overrides: [PermissionOverride]) -> [Capability] {
    let ceiling = Set(ceiling(role))
    var result = Set(defaults(role))
    for item in overrides where ceiling.contains(item.capability) {
      if item.effect == "deny" { result.remove(item.capability) } else { result.insert(item.capability) }
    }
    return all.filter { result.contains($0) }
  }

  /// 権限の画面に並べる項目（名前のある能力だけ）。
  public static func editable(_ role: MembershipRole) -> [Capability] {
    ceiling(role).filter { Copy.ja.ja.capability[$0.rawValue] != nil }
  }

  /// 個別設定を1つ変える（Web の changeOverride と同じ: その項目を外してから、標準以外なら末尾に足す）。
  public static func change(_ overrides: [PermissionOverride], membershipId: Id, capability: Capability, effect: String) -> [PermissionOverride] {
    overrides.filter { $0.capability != capability } + (effect == "default" ? [] : [PermissionOverride(membershipId: membershipId, capability: capability, effect: effect)])
  }

  public static let inviteRoles: [MembershipRole] = [.adult, .child, .guest]
}

/// 「変更の記録」の見せ方。
public enum AuditView {
  public static let pageSize = 20
  public static let groups: [AuditGroup] = ["account", "household", "members", "events", "tasks", "memos", "expenses", "albums", "links", "notifications", "assistant", "operator"]

  public enum Period: String, Sendable, CaseIterable, Codable { case all, today, week, month }

  public struct Filters: Sendable, Hashable, Codable {
    public enum View: String, Sendable, Codable { case household, mine }
    public var view: View
    public var membershipId: Id?
    public var group: AuditGroup?
    public var period: Period
    public init(view: View = .household, membershipId: Id? = nil, group: AuditGroup? = nil, period: Period = .all) {
      self.view = view; self.membershipId = membershipId; self.group = group; self.period = period
    }
  }

  /// 期間を日付の範囲にする。today は家族の時間帯での今日。両端を含む。
  public static func range(_ period: Period, today: String) -> (from: IsoDate, to: IsoDate)? {
    let days: Int
    switch period {
    case .all: return nil
    case .today: days = 1
    case .week: days = 7
    case .month: days = 30
    }
    guard let from = CalendarDate.addDays(today, -(days - 1)) else { return nil }
    return (from, today)
  }

  public static func query(_ filters: Filters, asOf: Rfc3339, cursor: String? = nil) -> AuditQuery {
    let range = CalendarDate.dateKey(fromRfc3339: asOf).flatMap { range(filters.period, today: $0) }
    return AuditQuery(cursor: cursor?.isEmpty == false ? cursor : nil, limit: pageSize, membershipId: filters.membershipId, group: filters.group, from: range?.from, to: range?.to)
  }

  public struct Day<Item: Sendable & Hashable>: Sendable, Hashable { public var day: String; public var items: [Item] }

  /// 新しい順の記録を、日付（記録の時刻を書いた時差での日付）ごとにまとめる。順は変えない。
  public static func groupByDay<Item: Sendable & Hashable>(_ items: [Item], at: (Item) -> String) -> [Day<Item>] {
    var days: [Day<Item>] = []
    for item in items {
      let day = String(at(item).prefix(10))
      if days.last?.day == day { days[days.count - 1].items.append(item) } else { days.append(Day(day: day, items: [item])) }
    }
    return days
  }

  /// 見られる対象の画面（Web の道）。伏せた対象と、開く画面のない対象は nil。
  public static func destination(_ target: AuditTarget?) -> String? {
    guard let target, !target.hidden, let id = target.id, !id.isEmpty else { return nil }
    let escaped = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.!~*'()"))) ?? id
    switch target.kind.rawValue {
    case "event": return "/calendar/\(escaped)"
    case "task": return "/tasks/\(escaped)"
    case "memo": return "/notes/\(escaped)"
    case "expense": return "/budget/\(escaped)"
    case "settlementBatch": return "/budget?view=settlements"
    case "album": return "/albums/\(escaped)"
    case "member", "invite", "colorLabel": return "/settings/household"
    default: return nil
    }
  }

  /// 操作の名前。名前のない操作は一般的な言い方にする。
  public static func actionLabel(_ action: String) -> String { Copy.auditLabels.auditActionLabels[action] ?? "そのほかの操作" }

  /// 変えた項目の名前を並べる。同じ名前は1つにする。名前のない項目は「そのほかの項目」。
  public static func fieldsText(_ fields: [String]) -> String {
    var seen: [String] = []
    for field in fields {
      let label = Copy.auditLabels.auditFieldLabels.table[field] ?? "そのほかの項目"
      if !seen.contains(label) { seen.append(label) }
    }
    return seen.joined(separator: "・")
  }

  public static func groupLabel(_ group: AuditGroup) -> String { Copy.auditLabels.auditGroupLabels.table[group.rawValue] ?? Copy.auditLabels.auditGroupLabels.other }
  public static func targetLabel(_ kind: AuditTargetKind) -> String { Copy.auditLabels.auditTargetLabels.table[kind.rawValue] ?? "" }

  public static func actorText(_ actor: AuditActor) -> String {
    switch actor.kind {
    case "member": "\(actor.displayName ?? "")さん"
    case "operator": Copy.auditLabels.auditCopy.`operator`
    default: Copy.auditLabels.auditCopy.former
    }
  }

  public static func periodLabel(_ period: Period) -> String {
    let labels = Copy.auditLabels.auditCopy.periods.self
    return switch period { case .all: labels.all; case .today: labels.today; case .week: labels.week; case .month: labels.month }
  }
}

/// ヘルプ（src/content/help.ts）。
public struct HelpItem: Codable, Sendable, Hashable, Identifiable {
  public struct Related: Codable, Sendable, Hashable { public var href: String; public var label: String }
  public var id: String
  public var category: String
  public var question: String
  public var answer: [String]
  public var keywords: [String]
  public var related: Related?
}

public struct HelpCategory: Codable, Sendable, Hashable, Identifiable {
  public var id: String
  public var label: String
}

public enum Help {
  public static let categories: [HelpCategory] = load("help.helpCategories") ?? []
  public static let items: [HelpItem] = load("help.helpItems") ?? []

  static func load<Value: Decodable>(_ name: String) -> Value? {
    guard let url = Bundle.copyResources.url(forResource: name, withExtension: "json", subdirectory: "Copy"), let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Value.self, from: data)
  }

  static func normalize(_ text: String) -> String { Account.jsTrim(text.precomposedStringWithCompatibilityMapping).lowercased() }

  /// 語と分類で絞る。語は、質問、答え、キーワードのどれかに含まれるもの。
  public static func filter(_ items: [HelpItem], query: String, category: String?) -> [HelpItem] {
    let needle = normalize(query)
    return items.filter { item in
      (category == nil || item.category == category) && (needle.isEmpty || normalize(([item.question] + item.answer + item.keywords).joined(separator: "\n")).contains(needle))
    }
  }
}

/// 規約の草案（src/content/legal.ts）。
public struct LegalDocument: Codable, Sendable, Hashable, Identifiable {
  public struct Section: Codable, Sendable, Hashable {
    public var heading: String
    public var paragraphs: [String]
    public var items: [String]?
  }
  public var id: String
  public var title: String
  public var intro: String
  public var sections: [Section]
}

public enum Legal {
  public static let documents: [LegalDocument] = Help.load("legal.legalDocuments") ?? []
  public static let notice: String = Help.load("legal.legalNotice") ?? ""

  /// 公開前に運営者が書き入れる部分（【…】）を分ける。奇数番目が空欄の印。
  public static func parts(_ text: String) -> [(text: String, placeholder: Bool)] {
    var result: [(String, Bool)] = []
    var rest = Substring(text)
    while let open = rest.firstIndex(of: "【"), let close = rest[open...].firstIndex(of: "】") {
      result.append((String(rest[..<open]), false))
      result.append((String(rest[open...close]), true))
      rest = rest[rest.index(after: close)...]
    }
    result.append((String(rest), false))
    return result.filter { !$0.0.isEmpty }
  }
}

/// 色のリスト（ColorLists.tsx・colorLabelInputSchema）。
public enum ColorLabels {
  public static let palette: [(color: String, label: String)] = [
    ("#c0392b", "赤"), ("#c2571a", "橙"), ("#a9791b", "黄土"), ("#6f7552", "オリーブ"), ("#2e7d4f", "緑"), ("#1f7a7a", "青緑"),
    ("#315c80", "藍"), ("#2f6db5", "青"), ("#5b5bb5", "紫"), ("#8a6680", "藤"), ("#b0487a", "桃"), ("#6b6358", "茶"),
  ]
  /// 新しく作るときの色（藍）。
  public static let defaultColor = "#315c80"

  /// 今の色が選択肢にないときも、変えずに保存できるように先頭に残す。
  public static func choices(current: String) -> [(color: String, label: String)] {
    palette.contains { $0.color == current } ? palette : [(current, "今の色")] + palette
  }

  /// 入力の確かめ。通れば名前の前後の空白を除いた入力を返す。
  public static func input(name: String, color: String) -> Result<ColorLabelInput, ValidationMessage> {
    let trimmed = Account.jsTrim(name)
    if trimmed.isEmpty { return .failure(ValidationMessage("リストの名前を入力してください。")) }
    if trimmed.unicodeScalars.count > 40 { return .failure(ValidationMessage("40文字以内で入力してください。")) }
    if color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) == nil { return .failure(ValidationMessage("色を確認してください。")) }
    return .success(ColorLabelInput(name: trimmed, color: color))
  }
}

/// 最近削除（RecentlyDeleted.tsx）。
public enum Trash {
  public static func kindLabel(_ kind: TrashKind) -> String {
    switch kind {
    case .event: "予定"
    case .occurrence: "繰り返しの1回"
    case .task: "タスク"
    case .memo: "メモ"
    case .expense: "家計"
    case .album: "アルバム"
    case .photo: "写真や動画"
    default: "記録"
    }
  }

  public static func key(_ item: TrashItem) -> String { "\(item.kind.rawValue).\(item.id).\(item.occurrenceDate ?? "all")" }
}

/// アカウントのアイコン（AccountSection.tsx の avatarPresets）。
public enum AvatarPresets {
  public static let all: [(preset: String, glyph: String)] = [("leaf", "葉"), ("sun", "陽"), ("wave", "波"), ("mountain", "山"), ("star", "星"), ("flower", "花")]
  public static func glyph(_ preset: String) -> String? { all.first { $0.preset == preset }?.glyph }
}

/// 関連リンクを開けるか（safeHttpsUrlSchema）。https だけを開く。
public enum ResourceLinks {
  public static func safeURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.scheme?.lowercased() == "https", let host = url.host(), !host.isEmpty else { return nil }
    return url
  }
}

/// 設定のタブ（Web の settingsTabs.ts）。表示に要る能力を持つ人にだけ出す。
public struct SettingsTab: Codable, Sendable, Hashable, Identifiable {
  public var href: String
  public var label: String
  public var capability: Capability
  public var description: String
  public var id: String { key }
  /// 道の最後（household・security など）。
  public var key: String { String(href.split(separator: "/").last ?? "") }

  public static let all: [SettingsTab] = Help.load("settingsTabs.settingsTabs") ?? []
  public static func named(_ key: String) -> SettingsTab? { all.first { $0.key == key } }
}
