import Foundation
import FHModel
import FHCopy

// 支出と収入の入力・精算額。元: src/domain/expenseForm.ts、settlementForm.ts、assistant.ts の receiptToDraft。

public enum SplitMode: String, CaseIterable, Sendable, Codable {
  case equal, payer, custom
  public var label: String {
    let labels = Copy.ja.ja.splitMode.self
    return switch self { case .equal: labels.equal; case .payer: labels.payer; case .custom: labels.custom }
  }
}

/// 人ごとの負担の入力（並びを保つ。Web のオブジェクトの項目の順と同じ）。JSON ではオブジェクトにする。
public struct CustomAmounts: Sendable, Hashable, Codable {
  public struct Entry: Sendable, Hashable { public var membershipId: Id; public var text: String }
  public var entries: [Entry]

  public init(_ entries: [Entry] = []) { self.entries = entries }

  public subscript(_ id: Id) -> String? {
    get { entries.first { $0.membershipId == id }?.text }
    set {
      if let index = entries.firstIndex(where: { $0.membershipId == id }) {
        if let newValue { entries[index].text = newValue } else { entries.remove(at: index) }
      } else if let newValue { entries.append(Entry(membershipId: id, text: newValue)) }
    }
  }

  public var isEmpty: Bool { entries.isEmpty }
  public var ids: [Id] { entries.map(\.membershipId) }

  /// 並びを揃える（JSON から読んだときは並びが分からないため）。
  public func ordered(_ order: [Id]) -> CustomAmounts {
    CustomAmounts(entries.sorted { (order.firstIndex(of: $0.membershipId) ?? .max) < (order.firstIndex(of: $1.membershipId) ?? .max) })
  }

  struct Key: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Key.self)
    entries = try container.allKeys.map { Entry(membershipId: $0.stringValue, text: try container.decode(String.self, forKey: $0)) }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Key.self)
    for entry in entries { try container.encode(entry.text, forKey: Key(stringValue: entry.membershipId)) }
  }
}

public struct ExpenseDraft: Sendable, Hashable, Codable {
  public var kind: ExpenseKind
  public var title: String
  /// 入力のままの文字。送るときに円の整数へ直す。
  public var amount: String
  public var date: String
  public var category: ExpenseCategory
  public var payerId: Id
  public var splitMode: SplitMode
  public var customAmounts: CustomAmounts
  public var note: String
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  public var place: PlaceRef?

  public init(kind: ExpenseKind, title: String, amount: String, date: String, category: ExpenseCategory, payerId: Id, splitMode: SplitMode, customAmounts: CustomAmounts, note: String, audience: VisibilityAudience, selectedIds: [Id], place: PlaceRef?) {
    self.kind = kind; self.title = title; self.amount = amount; self.date = date; self.category = category; self.payerId = payerId
    self.splitMode = splitMode; self.customAmounts = customAmounts; self.note = note; self.audience = audience; self.selectedIds = selectedIds; self.place = place
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(kind, forKey: .kind)
    try container.encode(title, forKey: .title)
    try container.encode(amount, forKey: .amount)
    try container.encode(date, forKey: .date)
    try container.encode(category, forKey: .category)
    try container.encode(payerId, forKey: .payerId)
    try container.encode(splitMode, forKey: .splitMode)
    try container.encode(customAmounts, forKey: .customAmounts)
    try container.encode(note, forKey: .note)
    try container.encode(audience, forKey: .audience)
    try container.encode(selectedIds, forKey: .selectedIds)
    try container.encode(place, forKey: .place)
  }
}

public struct KindChange: Codable, Sendable, Hashable {
  public var changes: Bool
  public var clearsShares: Bool
  public var requiresShares: Bool
  public var category: ExpenseKind
  public var blockedBySettlement: Bool
}

public enum ExpenseForm {
  public static let titleLimit = 120
  public static let noteLimit = 500

  static let stripPattern = JSRegex("[,\\s¥円]")
  static let amountPattern = JSRegex("^[\\d,\\s¥￥円]*$")

  /// 入力された文字を円の整数として読む。全角の数字や桁区切りも受け付ける。読めなければ nil。
  public static func parseYen(_ text: String) -> Int? {
    let digits = stripPattern.replaceAll(text.nfkc, with: "")
    guard !digits.isEmpty, digits.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }) else { return nil }
    guard let value = Int(digits), value <= 9_007_199_254_740_991 else { return nil }
    return value
  }

  /// 金額の欄に表示する文字。数字・桁区切り・円の記号・空白だけなら、数字だけにして3桁ごとに「,」で区切る。ほかの文字を含むときはそのまま。
  public static func formatAmountInput(_ text: String) -> String {
    let normalized = text.nfkc
    guard amountPattern.test(normalized) else { return text }
    var digits = String(normalized.unicodeScalars.filter { ("0"..."9").contains($0) }.map(Character.init))
    while digits.count > 1, digits.hasPrefix("0") { digits.removeFirst() }
    var result = ""
    for (index, character) in digits.enumerated() {
      if index > 0, (digits.count - index) % 3 == 0 { result.append(",") }
      result.append(character)
    }
    return result
  }

  /// 区切りを付け直したあと、カーソルを同じ数字の後ろに置くための位置（UTF-16）。
  public static func caretAfterDigits(_ formatted: String, digitsBefore: Int) -> Int {
    if digitsBefore <= 0 { return 0 }
    var seen = 0
    for (index, unit) in formatted.utf16.enumerated() {
      if (48...57).contains(unit) { seen += 1 }
      if seen == digitsBefore { return index + 1 }
    }
    return formatted.utf16.count
  }

  public static func activeAdults(_ memberships: [HouseholdMembership]) -> [HouseholdMembership] {
    memberships.filter { $0.status == .active && ($0.role == .owner || $0.role == .adult) }
  }

  /// 支払った人に選べる人。今の支払った人は、変えずに保存できるように残す。
  public static func payerChoices(_ memberships: [HouseholdMembership], keep: Id?) -> [HouseholdMembership] {
    let adults = activeAdults(memberships)
    return memberships.filter { member in adults.contains(member) || member.id == keep }
  }

  public static func defaultCategory(_ kind: ExpenseKind) -> ExpenseCategory { kind == .income ? "income_other" : "other" }

  public static func newDraft(date: String, viewer: Id, adultIds: [Id], audience: VisibilityAudience, kind: ExpenseKind = .expense) -> ExpenseDraft {
    ExpenseDraft(kind: kind, title: "", amount: "", date: date, category: defaultCategory(kind), payerId: adultIds.contains(viewer) ? viewer : adultIds.first ?? viewer,
                 splitMode: .equal, customAmounts: CustomAmounts(), note: "", audience: audience, selectedIds: [], place: nil)
  }

  static func splitMode(of expense: Expense, adultIds: [Id]) -> SplitMode {
    let ids = expense.shares.map(\.membershipId)
    if ids.count == 1, ids[0] == expense.payerMembershipId { return .payer }
    let amounts = expense.shares.map(\.amountJpy)
    let even = (amounts.max() ?? 0) - (amounts.min() ?? 0) <= 1 && !amounts.isEmpty
    return even && ids.count == adultIds.count && ids.allSatisfy(adultIds.contains) ? .equal : .custom
  }

  public static func draft(from expense: Expense, adultIds: [Id]) -> ExpenseDraft {
    ExpenseDraft(kind: expense.kind, title: expense.title, amount: String(expense.amountJpy), date: expense.incurredOn, category: expense.category, payerId: expense.payerMembershipId,
                 splitMode: expense.kind == .income ? .equal : splitMode(of: expense, adultIds: adultIds),
                 customAmounts: CustomAmounts(expense.shares.map { .init(membershipId: $0.membershipId, text: String($0.amountJpy)) }),
                 note: expense.note ?? "", audience: expense.visibility.audience, selectedIds: expense.visibility.selectedMembershipIds, place: expense.place)
  }

  /// 入力の内容から決まる負担。0円の人は負担のない人として外す。
  public static func plannedShares(_ draft: ExpenseDraft, adultIds: [Id]) -> [ShareAmount] {
    let amount = parseYen(draft.amount) ?? 0
    if draft.splitMode == .custom {
      return draft.customAmounts.entries.map { ShareAmount(membershipId: $0.membershipId, amountJpy: parseYen($0.text) ?? 0) }.filter { $0.amountJpy > 0 }
    }
    if draft.splitMode == .payer || adultIds.isEmpty { return [ShareAmount(membershipId: draft.payerId, amountJpy: amount)] }
    return Budget.splitShares(amount, payer: draft.payerId, ids: adultIds).map { ShareAmount(membershipId: $0.membershipId, amountJpy: $0.amountJpy) }
  }

  /// 「金額を指定」に切り替えたときの最初の値。入力がなければ、等分の額を入れておく。
  public static func seedCustomAmounts(_ draft: ExpenseDraft, adultIds: [Id]) -> CustomAmounts {
    if draft.customAmounts.entries.contains(where: { !Account.jsTrim($0.text).isEmpty }) { return draft.customAmounts }
    if (parseYen(draft.amount) ?? 0) == 0 { return draft.customAmounts }
    var equal = draft
    equal.splitMode = .equal
    return CustomAmounts(plannedShares(equal, adultIds: adultIds).map { .init(membershipId: $0.membershipId, text: String($0.amountJpy)) })
  }

  /// 金額から負担の合計を引いた額。正なら足りず、負なら多い。金額が読めなければ nil。
  public static func customSplitGap(_ draft: ExpenseDraft) -> Int? {
    guard let amount = parseYen(draft.amount) else { return nil }
    var custom = draft
    custom.splitMode = .custom
    return amount - plannedShares(custom, adultIds: []).reduce(0) { $0 + $1.amountJpy }
  }

  public static func titleLabel(_ kind: ExpenseKind) -> String { kind == .income ? "収入名" : "支出名" }

  /// 入力の確認。問題があれば文言を返す。splitLocked のときは、変えられない金額と負担を見ない。
  public static func problem(_ draft: ExpenseDraft, splitLocked: Bool) -> String? {
    if Account.jsTrim(draft.title).isEmpty { return "\(titleLabel(draft.kind))を入力してください。" }
    if !CalendarDate.isDateKey(draft.date) { return "日付を確認してください。" }
    if let shared = Visibility.problem(draft.audience, draft.selectedIds) { return shared }
    if splitLocked { return nil }
    if (parseYen(draft.amount) ?? 0) == 0 { return "金額は1円以上の整数で入力してください。" }
    if draft.kind == .income || draft.splitMode != .custom { return nil }
    if draft.customAmounts.entries.contains(where: { !Account.jsTrim($0.text).isEmpty && parseYen($0.text) == nil }) { return "負担の額は0円以上の整数で入力してください。" }
    return customSplitGap(draft) == 0 ? nil : "負担の合計を金額と合わせてください。"
  }

  static func shareInput(_ draft: ExpenseDraft, adultIds: [Id]) -> (ids: [Id]?, amounts: [ShareAmount]?) {
    if draft.splitMode == .custom { return (nil, plannedShares(draft, adultIds: adultIds)) }
    return (draft.splitMode == .payer || adultIds.isEmpty ? [draft.payerId] : adultIds, nil)
  }

  public static func createInput(_ draft: ExpenseDraft, adultIds: [Id]) -> ExpenseInput {
    let income = draft.kind == .income
    let shares = income ? (ids: nil, amounts: nil) : shareInput(draft, adultIds: adultIds)
    let note = Account.jsTrim(draft.note)
    return ExpenseInput(kind: draft.kind, title: Account.jsTrim(draft.title), amountJpy: parseYen(draft.amount) ?? 0, incurredOn: draft.date, payerMembershipId: draft.payerId,
                        category: draft.category, visibility: VisibilityInput(audience: draft.audience, selectedMembershipIds: draft.selectedIds),
                        shareMembershipIds: shares.ids, shareAmounts: shares.amounts, note: note.isEmpty ? nil : note, place: income ? nil : draft.place)
  }

  static func sameShares(_ planned: [ShareAmount], _ original: Expense) -> Bool {
    planned.count == original.shares.count && planned.allSatisfy { share in original.shares.contains { $0.membershipId == share.membershipId && $0.amountJpy == share.amountJpy } }
  }

  /// 変更の入力。空にした項目は null で外す。公開範囲と場所は、変えたときだけ送る。種類は変えたときだけ送る（費目はいつも送る）。
  public static func updateInput(_ draft: ExpenseDraft, original: Expense, adultIds: [Id], splitLocked: Bool) -> ExpenseUpdateInput {
    var input = ExpenseUpdateInput()
    if draft.kind != original.kind { input.kind = draft.kind }
    input.title = Account.jsTrim(draft.title)
    input.incurredOn = draft.date
    input.category = draft.category
    let note = Account.jsTrim(draft.note)
    input.note = note.isEmpty ? .clear : .set(note)
    input.visibility = Visibility.change(draft.audience, draft.selectedIds, original: original.visibility)
    if draft.place != original.place { input.place = Patch.orClear(draft.place) }
    guard !splitLocked else { return input }
    let amount = parseYen(draft.amount) ?? original.amountJpy
    let samePayment = amount == original.amountJpy && draft.payerId == original.payerMembershipId
    if draft.kind == .income {
      if !samePayment { input.amountJpy = amount; input.payerMembershipId = draft.payerId }
      return input
    }
    if samePayment && sameShares(plannedShares(draft, adultIds: adultIds), original) { return input }
    input.amountJpy = amount
    input.payerMembershipId = draft.payerId
    let shares = shareInput(draft, adultIds: adultIds)
    input.shareMembershipIds = shares.ids
    input.shareAmounts = shares.amounts
    return input
  }

  /// 編集の画面で種類を切り替えたときの下書き。費目が合わなければ既定に戻し、支出にするときは負担を等分から始める。
  public static func withKind(_ draft: ExpenseDraft, _ kind: ExpenseKind) -> ExpenseDraft {
    if draft.kind == kind { return draft }
    var next = draft
    next.kind = kind
    next.category = draft.category.isIncome == (kind == .income) ? draft.category : defaultCategory(kind)
    if kind == .expense { next.splitMode = .equal; next.customAmounts = CustomAmounts() }
    return next
  }

  /// 記録済みの種類を変えるときに起きること。
  public static func kindChangeEffects(_ original: Expense, _ kind: ExpenseKind) -> KindChange {
    let changes = original.kind != kind
    let toIncome = changes && kind == .income
    return KindChange(changes: changes, clearsShares: toIncome && !original.shares.isEmpty, requiresShares: changes && kind == .expense, category: kind,
                      blockedBySettlement: toIncome && Budget.hasActiveSettlement(original))
  }

  /// 関わる人のうち、公開範囲の外になる人。
  public static func peopleOutside(_ draft: ExpenseDraft, adultIds: [Id], memberships: [HouseholdMembership], creatorId: Id) -> [HouseholdMembership] {
    let related = draft.kind == .income ? [draft.payerId] : [draft.payerId] + plannedShares(draft, adultIds: adultIds).map(\.membershipId)
    return Visibility.peopleOutside(related, audience: draft.audience, selectedIds: draft.selectedIds, memberships: memberships, creatorId: creatorId)
  }

  /// 読み取った領収書を、新しい下書きに入れる。入れた値の分だけ変える。
  public static func apply(_ receipt: ReceiptProposal, to draft: ExpenseDraft) -> ExpenseDraft {
    var next = draft
    next.kind = .expense
    next.category = receipt.category
    if let merchant = receipt.merchant, !merchant.isEmpty { next.title = merchant }
    if let amount = receipt.amountJpy, amount != 0 { next.amount = String(amount) }
    if let date = receipt.date, !date.isEmpty { next.date = date }
    return next
  }
}

public enum SettlementForm {
  /// 精算額の確認。残りの額を超える金額は受け付けない。
  public static func amountProblem(_ text: String, remaining: Int) -> String? {
    guard let amount = ExpenseForm.parseYen(text), amount > 0 else { return "精算額は1円以上の整数で入力してください。" }
    return amount > remaining ? "精算額は残りの\(Format.yen(remaining))以下にしてください。" : nil
  }

  public struct Preset: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable { case full, half }
    public var kind: Kind
    public var amountJpy: Int
  }

  /// すぐに選べる額。1円の残りは半分にできない。
  public static func presets(_ remaining: Int) -> [Preset] {
    let half = remaining / 2
    return [Preset(kind: .full, amountJpy: remaining)] + (half > 0 ? [Preset(kind: .half, amountJpy: half)] : [])
  }
}
