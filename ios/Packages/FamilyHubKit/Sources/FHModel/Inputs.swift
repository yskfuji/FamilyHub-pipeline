import Foundation

// 変更の入力の型。元: src/domain/schemas.ts（zod の形）。送るときの JSON の形を Web と同じにする。

/// 部分の変更の1項目。keep は送らない、clear は null を送って外す、set は値を送る。
public enum Patch<Value: Codable & Sendable & Hashable>: Sendable, Hashable {
  case keep
  case clear
  case set(Value)

  /// 空なら外す（Web の `value || null`）。
  public static func orClear(_ value: Value?) -> Patch { value.map(Patch.set) ?? .clear }
}

extension KeyedEncodingContainer {
  mutating func encode<Value>(_ patch: Patch<Value>, forKey key: Key) throws {
    switch patch {
    case .keep: break
    case .clear: try encodeNil(forKey: key)
    case .set(let value): try encode(value, forKey: key)
    }
  }
}

/// 公開範囲の入力。選んだ人は audience が selected のときだけ送る。
public struct VisibilityInput: Codable, Sendable, Hashable {
  public var audience: VisibilityAudience
  public var selectedMembershipIds: [Id]
  public init(audience: VisibilityAudience, selectedMembershipIds: [Id]) {
    self.audience = audience
    self.selectedMembershipIds = audience == .selected ? selectedMembershipIds : []
  }
}

/// 予定の追加（eventInputSchema）。
public struct EventInput: Codable, Sendable, Hashable {
  public var title: String
  public var startsAt: Rfc3339
  public var endsAt: Rfc3339
  public var timezone: String
  public var participantMembershipIds: [Id]
  public var recurrence: RecurrenceRule?
  public var location: String?
  public var note: String?
  public var weatherSensitive: Bool?
  public var allDay: Bool?
  public var colorLabelId: Id?
  public var reminderMinutesBefore: Int?
  public var visibility: VisibilityInput?

  public init(title: String, startsAt: Rfc3339, endsAt: Rfc3339, timezone: String = "Asia/Tokyo", participantMembershipIds: [Id], recurrence: RecurrenceRule? = nil, location: String? = nil, note: String? = nil, weatherSensitive: Bool? = nil, allDay: Bool? = nil, colorLabelId: Id? = nil, reminderMinutesBefore: Int? = nil, visibility: VisibilityInput? = nil) {
    self.title = title; self.startsAt = startsAt; self.endsAt = endsAt; self.timezone = timezone
    self.participantMembershipIds = participantMembershipIds; self.recurrence = recurrence; self.location = location; self.note = note
    self.weatherSensitive = weatherSensitive; self.allDay = allDay; self.colorLabelId = colorLabelId
    self.reminderMinutesBefore = reminderMinutesBefore; self.visibility = visibility
  }
}

/// 予定の変更（eventUpdateSchema）。null（clear）は項目を外すことを表す。
public struct EventUpdateInput: Encodable, Sendable, Hashable {
  public var title: String?
  public var startsAt: Rfc3339?
  public var endsAt: Rfc3339?
  public var allDay: Bool?
  public var participantMembershipIds: [Id]?
  public var location: Patch<String> = .keep
  public var note: Patch<String> = .keep
  public var weatherSensitive: Bool?
  public var colorLabelId: Patch<Id> = .keep
  public var reminderMinutesBefore: Patch<Int> = .keep
  public var visibility: VisibilityInput?
  public var recurrence: Patch<RecurrenceRule> = .keep

  public init() {}

  private enum Keys: String, CodingKey {
    case title, startsAt, endsAt, allDay, participantMembershipIds, location, note, weatherSensitive, colorLabelId, reminderMinutesBefore, visibility, recurrence
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encodeIfPresent(title, forKey: .title)
    try container.encodeIfPresent(startsAt, forKey: .startsAt)
    try container.encodeIfPresent(endsAt, forKey: .endsAt)
    try container.encodeIfPresent(allDay, forKey: .allDay)
    try container.encodeIfPresent(participantMembershipIds, forKey: .participantMembershipIds)
    try container.encode(location, forKey: .location)
    try container.encode(note, forKey: .note)
    try container.encodeIfPresent(weatherSensitive, forKey: .weatherSensitive)
    try container.encode(colorLabelId, forKey: .colorLabelId)
    try container.encode(reminderMinutesBefore, forKey: .reminderMinutesBefore)
    try container.encodeIfPresent(visibility, forKey: .visibility)
    try container.encode(recurrence, forKey: .recurrence)
  }
}

/// タスクの追加（todoInputSchema）。空の項目は送らない。
public struct TodoInput: Codable, Sendable, Hashable {
  public var title: String
  public var dueAt: Rfc3339?
  public var dueStartAt: Rfc3339?
  public var assigneeMembershipId: Id
  public var reviewerMembershipId: Id?
  public var note: String?
  public var priority: TodoPriority?
  public var colorLabelId: Id?
  public var recurrence: RecurrenceRule?
  public var visibility: VisibilityInput?

  public init(title: String, dueAt: Rfc3339? = nil, dueStartAt: Rfc3339? = nil, assigneeMembershipId: Id, reviewerMembershipId: Id? = nil, note: String? = nil, priority: TodoPriority? = nil, colorLabelId: Id? = nil, recurrence: RecurrenceRule? = nil, visibility: VisibilityInput? = nil) {
    self.title = title; self.dueAt = dueAt; self.dueStartAt = dueStartAt; self.assigneeMembershipId = assigneeMembershipId
    self.reviewerMembershipId = reviewerMembershipId; self.note = note; self.priority = priority; self.colorLabelId = colorLabelId
    self.recurrence = recurrence; self.visibility = visibility
  }
}

/// タスクの変更（todoUpdateSchema）。null（clear）は項目を外すことを表す。
public struct TodoUpdateInput: Encodable, Sendable, Hashable {
  public var title: String?
  public var assigneeMembershipId: Id?
  public var reviewerMembershipId: Patch<Id> = .keep
  public var dueAt: Patch<Rfc3339> = .keep
  public var dueStartAt: Patch<Rfc3339> = .keep
  public var note: Patch<String> = .keep
  public var priority: Patch<TodoPriority> = .keep
  public var colorLabelId: Patch<Id> = .keep
  public var visibility: VisibilityInput?
  public var recurrence: Patch<RecurrenceRule> = .keep

  public init() {}

  private enum Keys: String, CodingKey {
    case title, assigneeMembershipId, reviewerMembershipId, dueAt, dueStartAt, note, priority, colorLabelId, visibility, recurrence
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encodeIfPresent(title, forKey: .title)
    try container.encodeIfPresent(assigneeMembershipId, forKey: .assigneeMembershipId)
    try container.encode(reviewerMembershipId, forKey: .reviewerMembershipId)
    try container.encode(dueAt, forKey: .dueAt)
    try container.encode(dueStartAt, forKey: .dueStartAt)
    try container.encode(note, forKey: .note)
    try container.encode(priority, forKey: .priority)
    try container.encode(colorLabelId, forKey: .colorLabelId)
    try container.encodeIfPresent(visibility, forKey: .visibility)
    try container.encode(recurrence, forKey: .recurrence)
  }
}

/// メモの追加（memoInputSchema）。メモの公開範囲に「参加者」はない。
public struct MemoInput: Codable, Sendable, Hashable {
  public var title: String
  public var body: String
  public var tags: [String]
  public var place: PlaceRef?
  public var memoDate: IsoDate?
  public var ocrText: String?
  public var visibility: VisibilityInput?

  public init(title: String, body: String, tags: [String], place: PlaceRef? = nil, memoDate: IsoDate? = nil, ocrText: String? = nil, visibility: VisibilityInput? = nil) {
    self.title = title; self.body = body; self.tags = tags; self.place = place; self.memoDate = memoDate; self.ocrText = ocrText; self.visibility = visibility
  }
}

/// メモの変更（Partial<MemoInput>）。日付・場所・文字認識の結果は null で外せる。
public struct MemoUpdateInput: Encodable, Sendable, Hashable {
  public var title: String?
  public var body: String?
  public var tags: [String]?
  public var memoDate: Patch<IsoDate> = .keep
  public var place: Patch<PlaceRef> = .keep
  public var ocrText: Patch<String> = .keep
  public var visibility: VisibilityInput?

  public init() {}

  private enum Keys: String, CodingKey { case title, body, tags, memoDate, place, ocrText, visibility }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encodeIfPresent(title, forKey: .title)
    try container.encodeIfPresent(body, forKey: .body)
    try container.encodeIfPresent(tags, forKey: .tags)
    try container.encode(memoDate, forKey: .memoDate)
    try container.encode(place, forKey: .place)
    try container.encode(ocrText, forKey: .ocrText)
    try container.encodeIfPresent(visibility, forKey: .visibility)
  }
}

/// 添付を開くための短い期限のリンク（5分）。url はサーバーでは相対の道、見本では fh-sample://。
public struct AttachmentLink: Codable, Sendable, Hashable {
  public var url: String
  public var expiresAt: Rfc3339
  public init(url: String, expiresAt: Rfc3339) { self.url = url; self.expiresAt = expiresAt }
}

/// inline はアプリの中で見るため、attachment は保存のため（?download=1）。
public enum AttachmentDisposition: String, Sendable, Hashable { case inline, attachment }

/// 負担の額の指定。
public struct ShareAmount: Codable, Sendable, Hashable {
  public var membershipId: Id
  public var amountJpy: Int
  public init(membershipId: Id, amountJpy: Int) { self.membershipId = membershipId; self.amountJpy = amountJpy }
}

/// 支出・収入の追加（expenseInputSchema）。負担は人の指定（等分・支払った人だけ）か額の指定のどちらか。
public struct ExpenseInput: Codable, Sendable, Hashable {
  public var kind: ExpenseKind
  public var title: String
  public var amountJpy: Int
  public var incurredOn: IsoDate
  public var payerMembershipId: Id
  public var category: ExpenseCategory
  public var visibility: VisibilityInput?
  public var shareMembershipIds: [Id]?
  public var shareAmounts: [ShareAmount]?
  public var note: String?
  public var place: PlaceRef?

  public init(kind: ExpenseKind, title: String, amountJpy: Int, incurredOn: IsoDate, payerMembershipId: Id, category: ExpenseCategory, visibility: VisibilityInput? = nil, shareMembershipIds: [Id]? = nil, shareAmounts: [ShareAmount]? = nil, note: String? = nil, place: PlaceRef? = nil) {
    self.kind = kind; self.title = title; self.amountJpy = amountJpy; self.incurredOn = incurredOn; self.payerMembershipId = payerMembershipId; self.category = category
    self.visibility = visibility; self.shareMembershipIds = shareMembershipIds; self.shareAmounts = shareAmounts; self.note = note; self.place = place
  }
}

/// 支出・収入の変更（expenseUpdateSchema）。メモと場所は null で外せる。
public struct ExpenseUpdateInput: Encodable, Sendable, Hashable {
  public var kind: ExpenseKind?
  public var title: String?
  public var incurredOn: IsoDate?
  public var category: ExpenseCategory?
  public var note: Patch<String> = .keep
  public var visibility: VisibilityInput?
  public var place: Patch<PlaceRef> = .keep
  public var amountJpy: Int?
  public var payerMembershipId: Id?
  public var shareMembershipIds: [Id]?
  public var shareAmounts: [ShareAmount]?

  public init() {}

  private enum Keys: String, CodingKey { case kind, title, incurredOn, category, note, visibility, place, amountJpy, payerMembershipId, shareMembershipIds, shareAmounts }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encodeIfPresent(kind, forKey: .kind)
    try container.encodeIfPresent(title, forKey: .title)
    try container.encodeIfPresent(incurredOn, forKey: .incurredOn)
    try container.encodeIfPresent(category, forKey: .category)
    try container.encode(note, forKey: .note)
    try container.encodeIfPresent(visibility, forKey: .visibility)
    try container.encode(place, forKey: .place)
    try container.encodeIfPresent(amountJpy, forKey: .amountJpy)
    try container.encodeIfPresent(payerMembershipId, forKey: .payerMembershipId)
    try container.encodeIfPresent(shareMembershipIds, forKey: .shareMembershipIds)
    try container.encodeIfPresent(shareAmounts, forKey: .shareAmounts)
  }
}

/// まとめた精算（settleAllInputSchema）。画面に示した負担と受け渡しをそのまま送り、サーバーが今の残りと照らす。
public struct SettleAllInput: Codable, Sendable, Hashable {
  public struct Share: Codable, Sendable, Hashable {
    public var expenseId: Id
    public var membershipId: Id
    public var remainingJpy: Int
    public init(expenseId: Id, membershipId: Id, remainingJpy: Int) { self.expenseId = expenseId; self.membershipId = membershipId; self.remainingJpy = remainingJpy }
  }
  public var shares: [Share]
  public var transfers: [SettlementTransfer]
  public init(shares: [Share], transfers: [SettlementTransfer]) { self.shares = shares; self.transfers = transfers }
}
