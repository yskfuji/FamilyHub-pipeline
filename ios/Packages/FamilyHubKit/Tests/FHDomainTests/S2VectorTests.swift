import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S2（予定）の計算が、Web の TS の関数の答え（scripts/ios/export-vectors.ts）と同じになること。
/// 答えは JSON の値として比べる（項目の順は問わない）。

enum JSON {
  static func value(_ encodable: some Encodable) -> JSONValue {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(encodable), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
    return value
  }

  static func load(_ name: String) -> JSONValue {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"),
          let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
    return value
  }

  static func cases(_ name: String) -> [JSONCase] {
    guard case .array(let items) = load(name) else { return [] }
    return items.enumerated().compactMap { index, item in
      guard case .object(let object) = item else { return nil }
      return JSONCase(index: index, input: object["input"] ?? .null, expected: object["expected"] ?? .null)
    }
  }

  static func decode<Value: Decodable>(_ value: JSONValue, as type: Value.Type = Value.self) throws -> Value {
    try JSONDecoder().decode(Value.self, from: JSONEncoder().encode(value))
  }
}

struct JSONCase: Sendable, CustomTestStringConvertible {
  let index: Int
  let input: JSONValue
  let expected: JSONValue
  var testDescription: String { "#\(index)" }
}

extension JSONValue {
  subscript(_ key: String) -> JSONValue { if case .object(let object) = self { object[key] ?? .null } else { .null } }
  subscript(_ index: Int) -> JSONValue { if case .array(let items) = self, index < items.count { items[index] } else { .null } }
  var string: String? { if case .string(let value) = self { value } else { nil } }
  var int: Int? { if case .number(let value) = self { Int(value) } else { nil } }
  var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
  var array: [JSONValue] { if case .array(let items) = self { items } else { [] } }
}

/// JSON として同じか。null と「項目がない」は区別する（変更の入力では、null は項目を外すことを表すため）。
func same(_ actual: some Encodable, _ expected: JSONValue) -> Bool { JSON.value(actual) == expected }
func sameRaw(_ actual: JSONValue, _ expected: JSONValue) -> Bool { actual == expected }

enum S2Fixtures {
  static let events: [CalendarEvent] = (try? JSON.decode(JSON.load("calendarEvents"))) ?? []
  static func event(_ id: String) -> CalendarEvent? { events.first { $0.id == id } }
  static let snapshot: HouseholdSnapshot? = {
    try? JSON.decode(JSON.load("calendarSnapshot"))
  }()
  static let baseDraft = EventForm.newDraft(EventPrefill(date: "2026-09-30", time: "10:00"), viewer: "member-aoi", audience: .household)
}

/// 予定の1回分を [id, その回の日, 開始, 終了] にする。
func brief(_ occurrence: Occurrence) -> JSONValue {
  .array([.string(occurrence.event.id), .string(occurrence.occurrenceDate), .string(occurrence.startsAt), .string(occurrence.endsAt)])
}

struct CalendarVectorTests {
  @Test func vectorsLoad() {
    #expect(S2Fixtures.events.count == 73)
    #expect(JSON.cases("rosterParse").count > 100)
    #expect(JSON.cases("eventUpdates").count > 50)
  }

  @Test(arguments: JSON.cases("calendarOccurrences"))
  func occurrences(_ vector: JSONCase) {
    let result = CalendarLayout.occurrences(S2Fixtures.events, from: vector.input["from"].string!, to: vector.input["to"].string!)
    #expect(sameRaw(.array(result.map(brief)), vector.expected))
  }

  @Test(arguments: JSON.cases("occurrenceStartingOn"))
  func startingOn(_ vector: JSONCase) throws {
    let event = try #require(S2Fixtures.event(vector.input["id"].string!))
    let hit = CalendarLayout.occurrence(startingOn: vector.input["date"].string!, of: event)
    #expect(sameRaw(hit.map(brief) ?? .null, vector.expected))
  }

  @Test(arguments: JSON.cases("layoutLanes"))
  func lanes(_ vector: JSONCase) {
    let month = vector.input["month"].string!
    let week = CalendarLayout.monthWeeks(month).first { $0[0].date == vector.input["first"].string! }!.map(\.date)
    let occurrences = CalendarLayout.occurrences(S2Fixtures.events, from: week[0], to: week[6]).filter { item in week.contains { CalendarLayout.occurs(item, on: $0) } }
    let clip = vector.input["clip"].bool == true ? (from: "\(month)-01", to: CalendarLayout.lastDayOfMonth(month)) : nil
    let result = CalendarLayout.layoutLanes(week, occurrences, maxLanes: vector.input["maxLanes"].int!, clip: clip)
    let placements: [JSONValue] = result.placements.map { .array([.string($0.occurrence.event.id), .string($0.occurrence.occurrenceDate), .number(Double($0.lane)), .number(Double($0.colStart)), .number(Double($0.colEnd)), .bool($0.continuesBefore), .bool($0.continuesAfter)]) }
    #expect(sameRaw(.object(["placements": .array(placements), "hidden": JSON.value(result.hidden)]), vector.expected))
  }

  @Test(arguments: JSON.cases("monthWeeks"))
  func monthWeeks(_ vector: JSONCase) {
    #expect(same(CalendarLayout.monthWeeks(vector.input.string!).map { $0.map(\.date) }, vector.expected))
  }

  @Test(arguments: JSON.cases("layoutTimeline"))
  func timeline(_ vector: JSONCase) {
    let date = vector.input["date"].string!
    let result = CalendarLayout.layoutTimeline(CalendarLayout.occurrences(S2Fixtures.events, from: date, to: date), date: date, maxColumns: vector.input["maxColumns"].int!)
    let blocks: [JSONValue] = result.blocks.map { .array([.string($0.occurrence.event.id), .number(Double($0.start)), .number(Double($0.end)), .number(Double($0.column)), .number(Double($0.columns))]) }
    #expect(sameRaw(.object(["blocks": .array(blocks), "hidden": .number(Double(result.hidden))]), vector.expected))
  }

  @Test(arguments: JSON.cases("calendarTexts"))
  func texts(_ vector: JSONCase) throws {
    let date = vector.input["date"].string!
    let occurrence = try #require(CalendarLayout.occurrences(S2Fixtures.events, from: date, to: date).first { $0.event.id == vector.input["id"].string! && $0.occurrenceDate == date })
    let on = [0, 1, 2].map { CalendarText.time(occurrence, on: CalendarLayout.add(date, $0)) }
    #expect(sameRaw(.object(["when": .string(CalendarText.when(occurrence)), "on": JSON.value(on), "last": .string(CalendarLayout.lastDate(occurrence)), "spanning": .bool(CalendarLayout.isSpanning(occurrence))]), vector.expected))
  }

  @Test(arguments: JSON.cases("calendarDays"))
  func days(_ vector: JSONCase) throws {
    let date = vector.input.string!
    let snapshot = try #require(S2Fixtures.snapshot)
    let holiday = CalendarText.holidayMap(date, date)[date]
    let expected = vector.expected
    #expect(CalendarText.day(date) == expected["day"].string)
    #expect(CalendarText.yearDay(date) == expected["yearDay"].string)
    #expect(CalendarText.week(CalendarDate.weekDates(date)) == expected["week"].string)
    #expect(CalendarText.month(String(date.prefix(7))) == expected["month"].string)
    #expect(CalendarText.tone(date, holiday: holiday)?.rawValue == expected["tone"].string)
    #expect(CalendarDayKey.allCases.map { CalendarDate.moved(date, $0) } == expected["moved"].array.compactMap(\.string))
    #expect(CalendarLayout.todos(snapshot.todos, on: date).map(\.id) == expected["todos"].array.compactMap(\.string))
    #expect(CalendarLayout.expenses(snapshot.expenses, on: date).map(\.id) == expected["expenses"].array.compactMap(\.string))
  }

  @Test func smallHelpers() {
    let small = JSON.load("calendarSmall")
    for item in small["isDateKey"].array { #expect(CalendarDate.isDateKey(item[0].string) == item[1].bool, "\(item[0])") }
    for item in small["slot"].array {
      guard case .number(let offset) = item[0], case .number(let hour) = item[1] else { continue }
      #expect(CalendarLayout.slotMinutes(offsetY: offset, hourHeight: hour) == item[2].int)
    }
    for item in small["initial"].array {
      #expect(CalendarLayout.initialTimelineMinutes(item[0].array.compactMap(\.string), today: item[1].string!, now: item[2].int!) == item[3].int)
    }
    for item in small["clock"].array { #expect(CalendarLayout.clock(item[0].int!) == item[1].string) }
    for item in small["lastDay"].array { #expect(CalendarLayout.lastDayOfMonth(item[0].string!) == item[1].string) }
    for item in small["reminder"].array { #expect(CalendarText.reminder(item[0].int!) == item[1].string) }
    for item in small["validLocal"].array { #expect(LocalTime.isValid(item[0].string!) == item[1].bool, "\(item[0])") }
  }
}

struct EventFormVectorTests {
  @Test(arguments: JSON.cases("eventDrafts"))
  func drafts(_ vector: JSONCase) throws {
    let event = try #require(S2Fixtures.event(vector.input.string!))
    let draft = EventForm.draft(from: event)
    #expect(same(draft, vector.expected["draft"]))
    #expect(same(EventForm.createInput(draft), vector.expected["create"]))
    #expect(EventForm.problem(draft, recurrenceEditable: true) == vector.expected["problem"].string)
  }

  @Test(arguments: JSON.cases("newEventDrafts"))
  func newDrafts(_ vector: JSONCase) {
    let input = vector.input
    let prefill = EventPrefill(date: input["date"].string!, time: input["time"].string, allDay: input["allDay"].bool)
    #expect(same(EventForm.newDraft(prefill, viewer: "member-aoi", audience: .household), vector.expected))
  }

  @Test(arguments: JSON.cases("eventDraftChecks"))
  func checks(_ vector: JSONCase) throws {
    let draft: EventDraft = try JSON.decode(vector.input["draft"])
    #expect(EventForm.problem(draft, recurrenceEditable: true) == vector.expected["problem"].string, "\(vector.input["name"])")
    #expect(EventForm.problem(draft, recurrenceEditable: false) == vector.expected["locked"].string, "\(vector.input["name"])")
    #expect(same(EventForm.createInput(draft), vector.expected["create"]), "\(vector.input["name"])")
  }

  @Test(arguments: JSON.cases("withStart"))
  func withStart(_ vector: JSONCase) throws {
    let draft: EventDraft = try JSON.decode(vector.input["draft"])
    #expect(same(EventForm.withStart(draft, vector.input["start"].string!), vector.expected))
  }

  @Test(arguments: JSON.cases("eventUpdates"))
  func updates(_ vector: JSONCase) throws {
    let original = try #require(S2Fixtures.event(vector.input["id"].string!))
    let draft: EventDraft = try JSON.decode(vector.input["draft"])
    let occurrenceDate = vector.input["occurrenceDate"].string!
    let seriesStart = CalendarLayout.dateKey(original.startsAt)
    let name = vector.input["name"]
    #expect(same(EventForm.updateInput(draft, original: original, recurrenceEditable: true), vector.expected["plain"]), "\(original.id) \(name)")
    #expect(same(EventForm.updateInput(draft, original: original, recurrenceEditable: false), vector.expected["locked"]), "\(original.id) \(name)")
    #expect(same(EventForm.updateInput(draft, original: original, recurrenceEditable: true, seriesStart: seriesStart, occurrenceDate: occurrenceDate), vector.expected["series"]), "\(original.id) \(name)")
    func preview(_ editable: Bool) -> JSONValue {
      guard original.recurrence != nil, let value = EventForm.seriesPreview(draft, series: original, occurrenceDate: occurrenceDate, recurrenceEditable: editable) else { return .null }
      switch value {
      case .shift(let delta, let text): return .object(["kind": .string("shift"), "deltaDays": .number(Double(delta)), "text": .string(text)])
      case .refused(let delta, let text): return .object(["kind": .string("refused"), "deltaDays": .number(Double(delta)), "text": .string(text)])
      }
    }
    #expect(sameRaw(preview(true), vector.expected["preview"]), "\(original.id) \(name)")
    #expect(sameRaw(preview(false), vector.expected["previewLocked"]), "\(original.id) \(name)")
  }

  @Test(arguments: JSON.cases("recurrenceChoices"))
  func choices(_ vector: JSONCase) {
    let choice = EventForm.choice(of: RecurrenceRule(rrule: vector.input["rrule"].string!), start: vector.input["start"].string!)
    #expect(same(choice, vector.expected["choice"]))
    #expect(EventForm.rrule(choice) == vector.expected["rrule"].string)
  }

  @Test(arguments: JSON.cases("pastTemplates"))
  func templates(_ vector: JSONCase) {
    let templates = EventForm.pastTemplates(S2Fixtures.events, now: vector.input.string!)
    #expect(templates.map(\.id) == vector.expected["ids"].array.compactMap(\.string))
    let applied = templates.map { EventForm.applyTemplate(S2Fixtures.baseDraft, $0, allowedAudiences: [.participants, .creator, .selected], memberIds: ["member-aoi", "member-ren"]) }
    #expect(same(applied, vector.expected["applied"]))
  }

  @Test(arguments: JSON.cases("seriesShift"))
  func seriesShift(_ vector: JSONCase) {
    let rrule = vector.input["rrule"].string!, start = vector.input["start"].string!, delta = vector.input["delta"].int!
    let series = CalendarEvent.sample(id: "s", startsAt: "\(start)T08:00:00+09:00", endsAt: "\(start)T09:30:00+09:00", recurrence: RecurrenceRule(rrule: rrule, exceptions: [CalendarLayout.add(start, 14)]))
    #expect(SeriesShift.refusal(start: start, recurrence: series.recurrence!, deltaDays: delta)?.rawValue == vector.expected["refusal"].string, "\(rrule) \(start) \(delta)")
    let shifted: JSONValue = switch SeriesShift.shift(series, by: delta) {
    case .success(let event): .object(["startsAt": .string(event.startsAt), "endsAt": .string(event.endsAt), "recurrence": JSON.value(event.recurrence)])
    case .failure(let refusal): .string(refusal.reason.rawValue)
    }
    #expect(sameRaw(shifted, vector.expected["shifted"]), "\(rrule) \(start) \(delta)")
    #expect(SeriesShift.describe(series, by: delta) == vector.expected["describe"].string, "\(rrule) \(start) \(delta)")
  }
}

struct VisibilityVectorTests {
  @Test(arguments: JSON.cases("visibility"))
  func visibility(_ vector: JSONCase) throws {
    let role = MembershipRole(rawValue: vector.input["role"].string!)
    let kind = try #require(SharedKind(rawValue: vector.input["kind"].string!))
    let audiences: [VisibilityAudience] = [.household, .adults, .participants, .creator, .selected]
    #expect(same(audiences.map { Visibility.choices(role, kind, current: $0) }, vector.expected["choices"]))
    #expect(same(Visibility.choices(role, kind), vector.expected["plain"]))
    #expect(same((audiences.map(Optional.some) + [nil]).map { Visibility.defaultAudience(role, kind, preferred: $0) }, vector.expected["defaults"]))
    #expect(same(audiences.map { Visibility.label(kind, $0) }, vector.expected["labels"]))
    #expect(same(audiences.map { Visibility.help(kind, $0) }, vector.expected["help"]))
  }

  @Test(arguments: JSON.cases("visibilityChange"))
  func change(_ vector: JSONCase) {
    let original = VisibilityPolicy(audience: .selected, creatorMembershipId: "member-aoi", selectedMembershipIds: ["member-ren", "member-hana"])
    let audience = VisibilityAudience(rawValue: vector.input["audience"].string!)
    let ids = vector.input["ids"].array.compactMap(\.string)
    #expect(sameRaw(Visibility.change(audience, ids, original: original).map(JSON.value) ?? .null, vector.expected["change"]))
    #expect(Visibility.problem(audience, ids) == vector.expected["problem"].string)
  }
}

struct ReadingVectorTests {
  @Test(arguments: JSON.cases("readingCandidates"))
  func candidates(_ vector: JSONCase) throws {
    let candidate: EventCandidate = try JSON.decode(vector.input)
    #expect(same(Reading.apply(candidate, to: S2Fixtures.baseDraft), vector.expected))
  }

  @Test(arguments: JSON.cases("readingUrls"))
  func urls(_ vector: JSONCase) {
    #expect(Reading.urlProblem(vector.input.string!) == vector.expected.string, "\(vector.input.string!.prefix(40))")
  }

  @Test(arguments: JSON.cases("readingImages"))
  func images(_ vector: JSONCase) {
    let input = vector.input
    #expect(Reading.imageProblem(name: input["name"].string!, type: input["type"].string!, size: input["size"].int!) == vector.expected.string)
  }
}

struct ShiftVectorTests {
  @Test(arguments: JSON.cases("rosterText"))
  func text(_ vector: JSONCase) {
    let normalized = ShiftText.normalize(vector.input.string!)
    #expect(normalized == vector.expected["normalized"].string)
    let cells = ShiftText.cells(normalized)
    #expect(sameRaw(.object(["cells": JSON.value(cells.cells), "exact": .bool(cells.exact)]), vector.expected["cells"]))
    #expect(sameRaw(range(ShiftText.clockRange(normalized)), vector.expected["range"]))
  }

  func range(_ value: ShiftText.ClockRange?) -> JSONValue {
    guard let value else { return .null }
    return .object(["start": .string(value.start), "end": .string(value.end), "endsNextDay": .bool(value.endsNextDay), "text": .string(value.text)])
  }

  @Test(arguments: JSON.cases("clockRanges"))
  func clockRanges(_ vector: JSONCase) {
    #expect(sameRaw(range(ShiftText.clockRange(ShiftText.normalize(vector.input.string!))), vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("rosterPeople"))
  func people(_ vector: JSONCase) {
    let a = vector.input[0].string!, b = vector.input[1].string!
    #expect(ShiftText.samePerson(a, b) == vector.expected["same"].bool)
    #expect(ShiftText.personKey(a) == vector.expected["key"].string)
  }

  @Test(arguments: JSON.cases("rosterParse"))
  func parse(_ vector: JSONCase) {
    let result = Roster.parse(vector.input["text"].string!, month: vector.input["month"].string!, rules: ShiftRules.defaults, person: vector.input["person"].string)
    let actual: JSONValue = .object(["rows": JSON.value(result.rows), "people": JSON.value(result.people), "legend": JSON.value(result.legend), "skipped": JSON.value(result.skipped), "layout": .string(result.layout)])
    #expect(sameRaw(actual, vector.expected), "\(vector.input["text"].string!.prefix(30)) \(vector.input["month"]) \(vector.input["person"])")
  }

  @Test(arguments: JSON.cases("rosterMonth"))
  func month(_ vector: JSONCase) {
    #expect(Roster.detectMonth(vector.input["text"].string!, todayMonth: vector.input["today"].string!) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("rosterLegend"))
  func legend(_ vector: JSONCase) {
    #expect(same(Roster.legendRules(vector.input.string!), vector.expected), "\(vector.input)")
  }

  @Test func rules() throws {
    let expected = JSON.load("shiftRules")
    let legend = Roster.legendRules("A=8:00-17:00 早 6:00-15:00 新=10:00-19:00")
    #expect(same(ShiftRules.merge(ShiftRules.defaults, legend), expected["merged"]))
    let custom = ShiftRules.custom("", ShiftRules.defaults)
    #expect(same(custom, expected["custom"]))
    #expect(same(ShiftRules.custom("とても長い名前の勤務の規則をつくってみる", ShiftRules.defaults + [custom]), expected["customNamed"]))
    var blank = ShiftRules.defaults[0]; blank.label = " "
    var badClock = ShiftRules.defaults[0]; badClock.start = "7:00"
    var other = ShiftRules.defaults[0]; other.id = "other"
    var clash = custom; clash.aliases = ["早"]
    var clashWide = custom; clashWide.aliases = ["ｅ"]
    var long = custom; long.label = String(repeating: "x", count: 21)
    let problems = [ShiftRules.defaults[0], blank, badClock, other, clash, clashWide, long].map { ShiftRules.problem($0, ShiftRules.defaults) }
    #expect(same(problems, expected["problems"]))
    #expect(same(["早、E/ｅ  夜,,夜", "", " a ／ b "].map(ShiftRules.parseAliases), expected["aliases"]))
    #expect(same(ShiftRules.defaults.map(ShiftRules.rangeText), expected["ranges"]))
  }

  @Test(arguments: JSON.cases("shiftProposals"))
  func proposals(_ vector: JSONCase) throws {
    let snapshot = try #require(S2Fixtures.snapshot)
    let memberId = vector.input.string!
    var rows = Roster.parse("10/1 早番\n10/2 遅番\n10/3 休み\n10/4 夜勤", month: "2026-10", rules: ShiftRules.defaults).rows
    rows.append(RosterRow(date: "2026-10-09", symbol: "Z", kind: .unknown, title: "Z", endsNextDay: false))
    let events = snapshot.events + [CalendarEvent.sample(id: "dup", startsAt: "2026-10-01T07:00:00+09:00", endsAt: "2026-10-01T16:00:00+09:00", title: "早番")]
    let made = ShiftProposals.make(rows, events: events, memberId: memberId)
    let target = ShiftSaveTarget(memberId: memberId, workLabelId: "label-work", offLabelId: "", audience: .household)
    let actual: [JSONValue] = made.map { item in
      .object(["id": .string(item.id), "duplicate": .bool(item.duplicate), "included": .bool(ShiftProposals.includedByDefault(item)), "time": .string(ShiftProposals.timeText(item.row)),
               "input": item.row.kind == .unknown ? .null : JSON.value(ShiftProposals.eventInput(item.row, target: target))])
    }
    #expect(sameRaw(.array(actual), vector.expected))
  }
}

extension CalendarEvent {
  static func sample(id: String, startsAt: String, endsAt: String, title: String? = nil, recurrence: RecurrenceRule? = nil) -> CalendarEvent {
    var event = S2Fixtures.events[0]
    event.id = id
    event.title = title ?? "予定\(id)"
    event.startsAt = startsAt
    event.endsAt = endsAt
    event.recurrence = recurrence
    event.participantMembershipIds = ["member-aoi"]
    event.ownerMembershipId = "member-aoi"
    return event
  }
}
