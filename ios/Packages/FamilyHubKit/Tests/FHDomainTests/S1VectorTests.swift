import Foundation
import Testing
import FHModel
@testable import FHDomain

// 段階 S1 の移植（パスワード・登録・繰り返し・今日の画面）を、Web の TS の答え（scripts/ios/export-vectors.ts）と照らす。

struct PasswordExpected: Decodable, Sendable { let plain: String?; let checked: String?; let normalized: String; let current: String? }
struct SignUpExpected: Decodable, Sendable { let ok: Bool; let message: String?; let displayName: String?; let email: String? }
struct AgeInput: Decodable, Sendable { let birthdate: String; let today: String }
struct RecurrenceInput: Decodable, Sendable { let start: String; let rrule: String; let exceptions: [String]; let from: String; let to: String }
struct RuleInput: Decodable, Sendable { let start: String; let rrule: String }
struct RuleExpected: Decodable, Sendable { let parsed: Bool; let describe: String; let next: String?; let withUntil: String; let remainder: String }
struct StripInput: Decodable, Sendable { let marks: [TimeStrip.Mark]; let now: Double }
struct DigestInput: Decodable, Sendable { let actor: String; let asOf: String; let scope: String; let weather: String?; let empty: Bool? }
struct DigestItem: Decodable, Sendable, Equatable { let key: String; let at: String; let minutes: Double; let title: String; let meta: String; let href: String; let id: String; let kind: String }
struct DigestEvent: Decodable, Sendable, Equatable { let id: String; let startsAt: String; let minutes: Double }
struct ScopedIds: Decodable, Sendable, Equatable { let events: [String]; let todos: [String]; let expenses: [String]; let memos: [String] }
struct DigestExpected: Decodable, Sendable {
  let memberId: String?
  let scoped: ScopedIds
  let today: String; let now: Int; let greeting: String; let mine: [String]
  let unsettled: Ledger.Summary; let spentThisMonth: Ledger.Summary
  let reviewTodo: String?; let events: [DigestEvent]; let affected: [String]; let showWeather: Bool
  let timeline: [DigestItem]; let upcoming: String?; let nextTask: String?; let attention: Int; let empty: Bool
  let strip: TimeStrip.Layout
}

/// 人ごとの家族の記録（FHModelTests の見本の JSON。export-fixtures.mjs が書く）。macOS の swift test でだけ読む。
enum Fixtures {
  static func snapshot(_ actor: String) throws -> HouseholdSnapshot {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("FHModelTests/Fixtures/snapshot.\(actor).json")
    return try JSONDecoder().decode(HouseholdSnapshot.self, from: Data(contentsOf: url))
  }
}

struct S1VectorTests {
  @Test func everyS1VectorFileLoads() {
    #expect(Vectors.load("passwordPolicy", String.self, PasswordExpected.self).count > 80)
    #expect(Vectors.load("recurrence", RecurrenceInput.self, [String].self).count == 29 * 4 * 4 * 2)
    #expect(Vectors.load("todayDigest", DigestInput.self, DigestExpected.self).count == 3 * (5 * 5 + 2))
  }

  @Test func commonPasswordsAreBundled() {
    #expect(PasswordPolicy.commonPasswords.count > 5000)
  }

  @Test(arguments: Vectors.load("passwordPolicy", String.self, PasswordExpected.self))
  func passwordPolicy(_ vector: Vector<String, PasswordExpected>) throws {
    let context = try #require(Vectors.single("passwordContext", PasswordPolicy.Context.self))
    #expect(PasswordPolicy.normalize(vector.input) == vector.expected.normalized, "\(vector.input)")
    #expect(PasswordPolicy.problem(vector.input, common: nil)?.rawValue == vector.expected.plain, "\(vector.input)")
    #expect(PasswordPolicy.problem(vector.input, context: context)?.rawValue == vector.expected.checked, "\(vector.input)")
    #expect(PasswordPolicy.currentPasswordMessage(vector.input) == vector.expected.current)
  }

  @Test(arguments: Vectors.load("signUp", SignUpInputVector.self, SignUpExpected.self))
  func signUp(_ vector: Vector<SignUpInputVector, SignUpExpected>) {
    let input = vector.input
    switch Account.validate(.init(displayName: input.displayName, email: input.email, password: input.password, birthdate: input.birthdate, guardianConsent: input.guardianConsent)) {
    case .success(let parsed):
      #expect(vector.expected.ok, "\(input)")
      #expect(parsed.displayName == vector.expected.displayName)
      #expect(parsed.email == vector.expected.email)
    case .failure(let failure):
      #expect(!vector.expected.ok, "\(input)")
      #expect(failure.message == vector.expected.message, "\(input)")
    }
  }

  @Test(arguments: Vectors.load("ageOn", AgeInput.self, Int.self))
  func ageOn(_ vector: Vector<AgeInput, Int>) {
    #expect(Account.age(birthdate: vector.input.birthdate, on: vector.input.today) == vector.expected)
  }

  @Test(arguments: Vectors.load("recurrence", RecurrenceInput.self, [String].self))
  func recurrence(_ vector: Vector<RecurrenceInput, [String]>) {
    let input = vector.input
    let rule = RecurrenceRule(rrule: input.rrule, timezone: "Asia/Tokyo", exceptions: input.exceptions)
    #expect(Recurrence.occurrenceDates(start: input.start, recurrence: rule, from: input.from, to: input.to) == vector.expected, "\(input)")
  }

  @Test(arguments: Vectors.load("recurrenceRules", RuleInput.self, RuleExpected.self))
  func recurrenceRules(_ vector: Vector<RuleInput, RuleExpected>) {
    let input = vector.input
    let rule = RecurrenceRule(rrule: input.rrule, timezone: "Asia/Tokyo", exceptions: ["2026-10-02"])
    #expect((Recurrence.parse(input.rrule) != nil) == vector.expected.parsed, "\(input.rrule)")
    #expect(Recurrence.describe(start: input.start, recurrence: rule) == vector.expected.describe, "\(input.rrule)")
    #expect(Recurrence.nextOccurrence(start: input.start, recurrence: rule, after: "2026-10-01") == vector.expected.next, "\(input.rrule)")
    #expect(Recurrence.withUntil(input.rrule, "2026-12-01") == vector.expected.withUntil)
    #expect(Recurrence.remainderRule(start: input.start, recurrence: rule, split: "2026-11-01") == vector.expected.remainder, "\(input.rrule)")
  }

  @Test(arguments: Vectors.load("season", String.self, String.self))
  func season(_ vector: Vector<String, String>) {
    #expect(Season(dateOrMonthKey: vector.input).rawValue == vector.expected)
  }

  @Test(arguments: Vectors.load("stripLayout", StripInput.self, TimeStrip.Layout.self))
  func stripLayout(_ vector: Vector<StripInput, TimeStrip.Layout>) {
    #expect(TimeStrip.layout(vector.input.marks, now: vector.input.now) == vector.expected)
  }

  @Test(arguments: Vectors.load("memberScopeChoices", String.self, [MemberScope.Choice].self))
  func memberScopeChoices(_ vector: Vector<String, [MemberScope.Choice]>) throws {
    let snapshot = try Fixtures.snapshot(vector.input)
    #expect(MemberScope.choices(viewerId: snapshot.viewer.membershipId, memberships: snapshot.memberships) == vector.expected)
  }

  @Test(arguments: Vectors.load("todayDigest", DigestInput.self, DigestExpected.self))
  func todayDigest(_ vector: Vector<DigestInput, DigestExpected>) throws {
    let input = vector.input
    var snapshot = try Fixtures.snapshot(input.actor)
    snapshot.context.asOf = input.asOf
    if input.weather == "sunny" { snapshot.context.weather.condition = .sunny }
    if input.empty == true { snapshot.events = []; snapshot.todos = []; snapshot.expenses = [] }
    let scoped = MemberScope.scoped(snapshot, scope: input.scope)
    let expected = vector.expected
    let label = "\(input.actor) \(input.asOf) \(input.scope)"
    #expect(scoped.memberId == expected.memberId, "\(label)")
    #expect(ScopedIds(events: scoped.events.map(\.id), todos: scoped.todos.map(\.id), expenses: scoped.expenses.map(\.id), memos: scoped.memos.map(\.id)) == expected.scoped, "\(label)")
    let digest = TodayDigest(snapshot: snapshot, scoped: scoped)
    #expect(digest.today == expected.today)
    #expect(digest.now == expected.now)
    #expect(digest.greeting == expected.greeting)
    #expect(digest.mine.map(\.id) == expected.mine, "\(label)")
    #expect(digest.unsettled == expected.unsettled, "\(label)")
    #expect(digest.spentThisMonth == expected.spentThisMonth, "\(label)")
    #expect(digest.reviewTodo?.id == expected.reviewTodo, "\(label)")
    #expect(digest.events.map { DigestEvent(id: $0.id, startsAt: $0.startsAt, minutes: $0.minutes) } == expected.events, "\(label)")
    #expect(digest.affected.map(\.id) == expected.affected, "\(label)")
    #expect(digest.showWeather == expected.showWeather, "\(label)")
    #expect(digest.timeline.map { DigestItem(key: $0.key, at: $0.at, minutes: $0.minutes, title: $0.title, meta: $0.meta, href: $0.href, id: $0.targetId, kind: $0.kind.rawValue) } == expected.timeline, "\(label)")
    #expect(digest.upcoming?.key == expected.upcoming, "\(label)")
    #expect(digest.nextTask?.id == expected.nextTask, "\(label)")
    #expect(digest.attention == expected.attention, "\(label)")
    #expect(digest.empty == expected.empty)
    #expect(digest.strip == expected.strip, "\(label)")
  }
}

struct SignUpInputVector: Decodable, Sendable, CustomStringConvertible {
  let displayName: String; let email: String; let password: String; let birthdate: String; let guardianConsent: Bool
  var description: String { "\(displayName)|\(email)|\(password)|\(birthdate)" }
}

extension Vectors {
  static func single<Value: Decodable>(_ name: String, _: Value.Type) -> Value? {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"), let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Value.self, from: data)
  }
}
