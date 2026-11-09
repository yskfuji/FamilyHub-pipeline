import Foundation
import FHModel

// 予定の入力の下書きと、送る形への変換。元: src/domain/eventForm.ts。
// 日時は日本時間の YYYY-MM-DDTHH:mm（Web の datetime-local と同じ形）で持つ。

/// keep は、この画面で作れない規則をそのまま残すこと。
public enum RecurrenceChoice: String, CaseIterable, Sendable, Codable {
  case none, daily, weekly, monthly, monthEnd = "month-end", everyNDays = "every-n-days", keep

  public var label: String {
    switch self {
    case .none: "繰り返さない"
    case .daily: "毎日"
    case .weekly: "毎週"
    case .monthly: "毎月"
    case .monthEnd: "毎月の末日"
    case .everyNDays: "日数を指定"
    case .keep: "今の設定のまま"
    }
  }
}

/// 繰り返しの選択（予定とタスクで共通）。
public struct RecurrenceDraft: Sendable, Hashable, Codable {
  public var recurrence: RecurrenceChoice
  public var intervalDays: Int
  /// YYYY-MM-DD。なければ空。
  public var until: String
  public init(recurrence: RecurrenceChoice = .none, intervalDays: Int = 2, until: String = "") {
    self.recurrence = recurrence; self.intervalDays = intervalDays; self.until = until
  }
}

public struct EventDraft: Sendable, Hashable, Codable {
  public var title: String
  public var allDay: Bool
  /// 日本時間の YYYY-MM-DDTHH:mm。終日のときは日付の部分だけを使う。
  public var start: String
  public var end: String
  public var location: String
  public var note: String
  public var participantIds: [Id]
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  public var recurrence: RecurrenceChoice
  public var intervalDays: Int
  public var until: String
  public var colorLabelId: String
  public var reminderMinutes: Int?
  public var weatherSensitive: Bool

  public var rule: RecurrenceDraft {
    get { RecurrenceDraft(recurrence: recurrence, intervalDays: intervalDays, until: until) }
    set { recurrence = newValue.recurrence; intervalDays = newValue.intervalDays; until = newValue.until }
  }

  // JSON の null を省かずに書く（試験で TS の下書きと照らすため）。
  private enum Keys: String, CodingKey { case title, allDay, start, end, location, note, participantIds, audience, selectedIds, recurrence, intervalDays, until, colorLabelId, reminderMinutes, weatherSensitive }
  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    title = try c.decode(String.self, forKey: .title); allDay = try c.decode(Bool.self, forKey: .allDay)
    start = try c.decode(String.self, forKey: .start); end = try c.decode(String.self, forKey: .end)
    location = try c.decode(String.self, forKey: .location); note = try c.decode(String.self, forKey: .note)
    participantIds = try c.decode([Id].self, forKey: .participantIds); audience = try c.decode(VisibilityAudience.self, forKey: .audience)
    selectedIds = try c.decode([Id].self, forKey: .selectedIds); recurrence = try c.decode(RecurrenceChoice.self, forKey: .recurrence)
    intervalDays = try c.decode(Int.self, forKey: .intervalDays); until = try c.decode(String.self, forKey: .until)
    colorLabelId = try c.decode(String.self, forKey: .colorLabelId); reminderMinutes = try c.decodeIfPresent(Int.self, forKey: .reminderMinutes)
    weatherSensitive = try c.decode(Bool.self, forKey: .weatherSensitive)
  }
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    try c.encode(title, forKey: .title); try c.encode(allDay, forKey: .allDay); try c.encode(start, forKey: .start); try c.encode(end, forKey: .end)
    try c.encode(location, forKey: .location); try c.encode(note, forKey: .note); try c.encode(participantIds, forKey: .participantIds)
    try c.encode(audience, forKey: .audience); try c.encode(selectedIds, forKey: .selectedIds); try c.encode(recurrence, forKey: .recurrence)
    try c.encode(intervalDays, forKey: .intervalDays); try c.encode(until, forKey: .until); try c.encode(colorLabelId, forKey: .colorLabelId)
    try c.encode(reminderMinutes, forKey: .reminderMinutes); try c.encode(weatherSensitive, forKey: .weatherSensitive)
  }

  public init(title: String, allDay: Bool, start: String, end: String, location: String, note: String, participantIds: [Id], audience: VisibilityAudience, selectedIds: [Id], recurrence: RecurrenceChoice, intervalDays: Int, until: String, colorLabelId: String, reminderMinutes: Int?, weatherSensitive: Bool) {
    self.title = title; self.allDay = allDay; self.start = start; self.end = end; self.location = location; self.note = note
    self.participantIds = participantIds; self.audience = audience; self.selectedIds = selectedIds; self.recurrence = recurrence
    self.intervalDays = intervalDays; self.until = until; self.colorLabelId = colorLabelId; self.reminderMinutes = reminderMinutes; self.weatherSensitive = weatherSensitive
  }
}

/// 日本時間の YYYY-MM-DDTHH:mm の読み書き。JS の Date.parse(`${local}:00+09:00`) と同じものを受け付ける
/// （日は31まで受け、その月にない日は次の月へ繰り越す。24:00 は次の日の0時）。
public enum LocalTime {
  public static let timezone = "Asia/Tokyo"

  /// 1970年からのミリ秒。読めなければ nil。
  public static func milliseconds(_ local: String) -> Double? {
    let pattern = #"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$"#
    guard local.range(of: pattern, options: .regularExpression) != nil else { return nil }
    let numbers = local.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int($0) }
    guard numbers.count == 5 else { return nil }
    let (year, month, day, hour, minute) = (numbers[0], numbers[1], numbers[2], numbers[3], numbers[4])
    guard (1...12).contains(month), (1...31).contains(day), minute <= 59, hour < 24 || (hour == 24 && minute == 0) else { return nil }
    let days = CivilDate(year: year, month: month, day: day).daysSinceEpoch
    return (Double(days) * 86_400 + Double(hour * 3600 + minute * 60 - Tokyo.offsetSeconds)) * 1000
  }

  public static func isValid(_ local: String) -> Bool { milliseconds(local) != nil }

  /// 時刻を、日時の入力欄に入れる日本時間の形にする。
  public static func local(fromInstant iso: String) -> String {
    guard let date = Tokyo.parse(iso) else { return String(iso.prefix(16)) }
    return String(CalendarDate.toJstRfc3339(date).prefix(16))
  }

  public static func local(fromMilliseconds value: Double) -> String {
    String(CalendarDate.toJstRfc3339(Date(timeIntervalSince1970: value / 1000)).prefix(16))
  }

  public static func instant(_ local: String) -> String { "\(local):00+09:00" }

  public static func adding(minutes: Double, to local: String) -> String {
    guard let base = milliseconds(local) else { return local }
    return self.local(fromMilliseconds: base + minutes * 60_000)
  }

  static func minutesBetween(_ from: String, _ to: String) -> Double? {
    guard let a = milliseconds(from), let b = milliseconds(to) else { return nil }
    return (b - a) / 60_000
  }

  /// Date と YYYY-MM-DDTHH:mm の間（日付の入力の部品で使う）。
  public static func date(_ local: String) -> Date? { milliseconds(local).map { Date(timeIntervalSince1970: $0 / 1000) } }
  public static func local(from date: Date) -> String { String(CalendarDate.toJstRfc3339(date).prefix(16)) }
}

/// 予定の追加を開くときの、前もって入れておく日時。
public struct EventPrefill: Sendable, Hashable {
  public var date: String
  public var time: String?
  public var allDay: Bool?
  public init(date: String, time: String? = nil, allDay: Bool? = nil) { self.date = date; self.time = time; self.allDay = allDay }
}

public enum EventForm {
  public static let reminderChoices = [10, 30, 60, 1440]
  public static let titleLimit = 120
  public static let locationLimit = 200
  public static let noteLimit = 2000

  public static func newDraft(_ prefill: EventPrefill, viewer: Id, audience: VisibilityAudience) -> EventDraft {
    let start = "\(prefill.date)T\(prefill.time ?? "18:00")"
    let lastMinute = "\(prefill.date)T23:59"
    let later = LocalTime.adding(minutes: 60, to: start)
    return EventDraft(title: "", allDay: prefill.allDay ?? false, start: start, end: later > lastMinute ? lastMinute : later, location: "", note: "",
                      participantIds: [viewer], audience: audience, selectedIds: [], recurrence: .none, intervalDays: 2, until: "",
                      colorLabelId: "", reminderMinutes: nil, weatherSensitive: false)
  }

  static func withoutUntil(_ rrule: String) -> String {
    rrule.split(separator: ";", omittingEmptySubsequences: false).filter { !$0.hasPrefix("UNTIL=") }.joined(separator: ";")
  }

  /// 規則をこの画面の選択肢に直す。開始日に合わない規則や回数の指定は keep にして、書き換えない。
  public static func choice(of rule: RecurrenceRule?, start: String) -> RecurrenceDraft {
    guard let rule else { return RecurrenceDraft() }
    let keep = RecurrenceDraft(recurrence: .keep)
    guard let parsed = Recurrence.parse(rule.rrule), parsed.count == nil else { return keep }
    let until = parsed.until ?? ""
    let weekday = CivilDate(key: start)?.weekday ?? 0
    switch parsed.freq {
    case .daily:
      return parsed.interval == 1 ? RecurrenceDraft(recurrence: .daily, until: until) : RecurrenceDraft(recurrence: .everyNDays, intervalDays: parsed.interval, until: until)
    case .weekly:
      guard parsed.interval == 1 else { return keep }
      return parsed.byDay.isEmpty || parsed.byDay == [weekday] ? RecurrenceDraft(recurrence: .weekly, until: until) : keep
    case .monthly:
      guard parsed.interval == 1 else { return keep }
      if parsed.byMonthDay.isEmpty { return RecurrenceDraft(recurrence: .monthly, until: until) }
      return withoutUntil(rule.rrule) == Recurrence.lastDayOfMonthRule ? RecurrenceDraft(recurrence: .monthEnd, until: until) : keep
    }
  }

  /// 選択肢を RRULE にする。繰り返さないときと keep のときは nil。
  public static func rrule(_ draft: RecurrenceDraft) -> String? {
    let base: String
    switch draft.recurrence {
    case .none, .keep: return nil
    case .daily: base = "FREQ=DAILY"
    case .weekly: base = "FREQ=WEEKLY"
    case .monthly: base = "FREQ=MONTHLY"
    case .monthEnd: base = Recurrence.lastDayOfMonthRule
    case .everyNDays: base = "FREQ=DAILY;INTERVAL=\(draft.intervalDays)"
    }
    return draft.until.isEmpty ? base : Recurrence.withUntil(base, draft.until)
  }

  public static func draft(from event: CalendarEvent) -> EventDraft {
    let rule = choice(of: event.recurrence, start: CalendarLayout.dateKey(event.startsAt))
    return EventDraft(title: event.title, allDay: event.allDay == true, start: LocalTime.local(fromInstant: event.startsAt), end: LocalTime.local(fromInstant: event.endsAt),
                      location: event.location ?? "", note: event.note ?? "", participantIds: event.participantMembershipIds,
                      audience: event.visibility.audience, selectedIds: event.visibility.selectedMembershipIds,
                      recurrence: rule.recurrence, intervalDays: rule.intervalDays, until: rule.until,
                      colorLabelId: event.colorLabelId ?? "", reminderMinutes: event.reminderMinutesBefore, weatherSensitive: event.weatherSensitive == true)
  }

  /// 開始を動かすときは、長さを保って終了も動かす。
  public static func withStart(_ draft: EventDraft, _ start: String) -> EventDraft {
    var next = draft
    next.start = start
    guard LocalTime.isValid(start), LocalTime.isValid(draft.start), LocalTime.isValid(draft.end), let moved = LocalTime.minutesBetween(draft.start, start) else { return next }
    next.end = LocalTime.adding(minutes: moved, to: draft.end)
    return next
  }

  public static func times(allDay: Bool, start: String, end: String) -> (startsAt: String, endsAt: String) {
    if allDay { return ("\(start.prefix(10))T00:00:00+09:00", "\(end.prefix(10))T23:59:00+09:00") }
    return (LocalTime.instant(start), LocalTime.instant(end))
  }

  public static func times(_ draft: EventDraft) -> (startsAt: String, endsAt: String) { times(allDay: draft.allDay, start: draft.start, end: draft.end) }

  /// 繰り返しの入力の確認。start は最初の回の日付、noun は「予定」のような記録の名前。
  public static func recurrenceProblem(_ rule: RecurrenceDraft, start: String, noun: String) -> String? {
    if rule.recurrence == .everyNDays, !(1...366).contains(rule.intervalDays) { return "繰り返す間隔は1日から366日のあいだで入力してください。" }
    if let rrule = rrule(rule),
       Recurrence.occurrenceDates(start: start, recurrence: RecurrenceRule(rrule: rrule), from: start, to: CalendarLayout.add(start, 800)).isEmpty {
      return "繰り返しの終了日までに\(noun)が入りません。終了日を確認してください。"
    }
    return nil
  }

  static func trimmed(_ text: String) -> String { Account.jsTrim(text) }

  /// 入力の確認。問題があれば文言を返す。recurrenceEditable が false のときは繰り返しを見ない。
  public static func problem(_ draft: EventDraft, recurrenceEditable: Bool) -> String? {
    if trimmed(draft.title).isEmpty { return "予定名を入力してください。" }
    if !LocalTime.isValid(String(draft.start.prefix(16))) || !LocalTime.isValid(String(draft.end.prefix(16))) { return "開始と終了の日時を入力してください。" }
    let span = times(draft)
    if (Tokyo.parse(span.endsAt) ?? .distantPast) <= (Tokyo.parse(span.startsAt) ?? .distantPast) { return "終了日時は開始日時より後にしてください。" }
    if draft.participantIds.isEmpty { return "参加者を1人以上選んでください。" }
    if let visibility = Visibility.problem(draft.audience, draft.selectedIds) { return visibility }
    return recurrenceEditable ? recurrenceProblem(draft.rule, start: String(draft.start.prefix(10)), noun: "予定") : nil
  }

  public static func createInput(_ draft: EventDraft) -> EventInput {
    let span = times(draft)
    let location = trimmed(draft.location), note = trimmed(draft.note)
    return EventInput(
      title: trimmed(draft.title), startsAt: span.startsAt, endsAt: span.endsAt, participantMembershipIds: draft.participantIds,
      recurrence: rrule(draft.rule).map { RecurrenceRule(rrule: $0) },
      location: location.isEmpty ? nil : location, note: note.isEmpty ? nil : note,
      weatherSensitive: draft.weatherSensitive ? true : nil, allDay: draft.allDay ? true : nil,
      colorLabelId: draft.colorLabelId.isEmpty ? nil : draft.colorLabelId, reminderMinutesBefore: draft.reminderMinutes,
      visibility: VisibilityInput(audience: draft.audience, selectedMembershipIds: draft.selectedIds))
  }

  /// 「すべて」の編集で、下書きの日付が開いた回の日付から何日動いたか。開いた回がわからなければ 0。
  public static func seriesDeltaDays(_ draft: EventDraft, occurrenceDate: String?) -> Int {
    occurrenceDate.map { SeriesShift.daysBetween($0, String(draft.start.prefix(10))) } ?? 0
  }

  /// 変更の入力。空にした項目は null で外す。公開範囲と繰り返しは、変えたときだけ送る。
  /// seriesStart を渡すと、シリーズの開始日に時刻を当てはめる。occurrenceDate も渡すと、下書きの日付と開いた回の日付の差だけシリーズの開始日をずらす。
  public static func updateInput(_ draft: EventDraft, original: CalendarEvent, recurrenceEditable: Bool, seriesStart: String? = nil, occurrenceDate: String? = nil) -> EventUpdateInput {
    var span = times(draft)
    let deltaDays = seriesStart != nil ? seriesDeltaDays(draft, occurrenceDate: occurrenceDate) : 0
    if let seriesStart {
      let length = SeriesShift.daysBetween(CalendarLayout.dateKey(span.startsAt), CalendarLayout.dateKey(span.endsAt))
      let start = CalendarLayout.add(seriesStart, deltaDays)
      span.endsAt = Recurrence.occurrenceStartsAt(span.endsAt, on: CalendarLayout.add(start, length))
      span.startsAt = Recurrence.occurrenceStartsAt(span.startsAt, on: start)
    }
    let before = choice(of: original.recurrence, start: CalendarLayout.dateKey(original.startsAt))
    let rule = draft.rule
    let next = rrule(rule)
    let changed = recurrenceEditable && rule.recurrence != .keep && next != rrule(before)
    // 規則を同時に変えるときは、受け取る側は規則をそのまま使うので、例外日はここで同じだけずらす。
    let exceptions = (original.recurrence?.exceptions ?? []).map { CalendarLayout.add($0, deltaDays) }
    var input = EventUpdateInput()
    input.title = trimmed(draft.title)
    input.startsAt = span.startsAt
    input.endsAt = span.endsAt
    input.allDay = draft.allDay
    input.participantMembershipIds = draft.participantIds
    let location = trimmed(draft.location), note = trimmed(draft.note)
    input.location = location.isEmpty ? .clear : .set(location)
    input.note = note.isEmpty ? .clear : .set(note)
    input.weatherSensitive = draft.weatherSensitive
    input.colorLabelId = draft.colorLabelId.isEmpty ? .clear : .set(draft.colorLabelId)
    input.reminderMinutesBefore = Patch.orClear(draft.reminderMinutes)
    input.visibility = Visibility.change(draft.audience, draft.selectedIds, original: original.visibility)
    if changed { input.recurrence = next.map { .set(RecurrenceRule(rrule: $0, exceptions: exceptions)) } ?? .clear }
    return input
  }

  public enum SeriesPreview: Sendable, Equatable {
    case shift(deltaDays: Int, text: String)
    case refused(deltaDays: Int, text: String)
    public var text: String { switch self { case .shift(_, let text), .refused(_, let text): text } }
    public var refused: Bool { if case .refused = self { true } else { false } }
  }

  /// 「すべて」の編集で日付を動かしたときの見通し。日付が動いていないとき、または規則も同時に変えるときは nil。
  public static func seriesPreview(_ draft: EventDraft, series: CalendarEvent, occurrenceDate: String, recurrenceEditable: Bool = true) -> SeriesPreview? {
    let deltaDays = seriesDeltaDays(draft, occurrenceDate: occurrenceDate)
    guard deltaDays != 0, series.recurrence != nil else { return nil }
    let before = choice(of: series.recurrence, start: CalendarLayout.dateKey(series.startsAt))
    if recurrenceEditable, draft.recurrence != .keep, rrule(draft.rule) != rrule(before) { return nil }
    switch SeriesShift.shift(series, by: deltaDays) {
    case .failure(let refusal): return .refused(deltaDays: deltaDays, text: SeriesShift.refusalMessage(refusal.reason))
    case .success: return .shift(deltaDays: deltaDays, text: SeriesShift.describe(series, by: deltaDays) ?? "")
    }
  }

  /// 過去の予定から作るときの候補。新しい順に、同じ名前は1つにまとめる。
  public static func pastTemplates(_ events: [CalendarEvent], now: String, limit: Int = 5) -> [CalendarEvent] {
    let nowValue = TodayDigest.milliseconds(now)
    var names = Set<String>()
    return events.filter { TodayDigest.milliseconds($0.endsAt) < nowValue }
      .stableSorted { $0.startsAt > $1.startsAt }
      .filter { names.insert(trimmed($0.title)).inserted }
      .prefix(limit).map { $0 }
  }

  /// 過去の予定の内容を入れる。日付は今の入力のまま、時刻と長さは元の予定に合わせる。繰り返しは写さない。
  public static func applyTemplate(_ draft: EventDraft, _ event: CalendarEvent, allowedAudiences: [VisibilityAudience], memberIds: [Id]) -> EventDraft {
    let date = draft.start.prefix(10)
    let start = "\(date)T\(LocalTime.local(fromInstant: event.startsAt).dropFirst(11))"
    let length = (TodayDigest.milliseconds(event.endsAt) - TodayDigest.milliseconds(event.startsAt)) / 60_000
    let participants = event.participantMembershipIds.filter(memberIds.contains)
    let keepAudience = allowedAudiences.contains(event.visibility.audience)
    var next = draft
    next.title = event.title
    next.allDay = event.allDay == true
    next.start = start
    next.end = LocalTime.adding(minutes: length, to: start)
    next.location = event.location ?? ""
    next.note = event.note ?? ""
    next.participantIds = participants.isEmpty ? draft.participantIds : participants
    next.audience = keepAudience ? event.visibility.audience : draft.audience
    next.selectedIds = keepAudience ? event.visibility.selectedMembershipIds.filter(memberIds.contains) : draft.selectedIds
    next.colorLabelId = event.colorLabelId ?? ""
    next.reminderMinutes = event.reminderMinutesBefore
    next.weatherSensitive = event.weatherSensitive == true
    return next
  }
}
