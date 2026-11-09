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
