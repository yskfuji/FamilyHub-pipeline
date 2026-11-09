import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S6（場所・通知の予定・検索のまとめ）の計算が、Web の TS の関数の答えと同じになること。
struct PlaceVectorTests {
  @Test(arguments: JSON.cases("placeKeys"))
  func keys(_ vector: JSONCase) {
    #expect(Places.key(name: vector.input[0].string!, address: vector.input[1].string!) == vector.expected.string, "\(vector.input)")
  }

  @Test func summaries() throws {
    let records = JSON.load("placeRecords")
    let expenses: [Expense] = try JSON.decode(records["expenses"])
    let memos: [Memo] = try JSON.decode(records["memos"])
    let expected = JSON.load("placeSummaries")
    let aggregated = Places.aggregate(expenses: expenses, memos: memos)
    #expect(same(aggregated, expected["aggregated"]))
    for pair in expected["sorted"].array {
      #expect(same(Places.sort(aggregated, Places.Sort(rawValue: pair[0].string!)!).map(\.key), pair[1]), "\(pair[0])")
    }
  }

  @Test(arguments: JSON.cases("placeDistances"))
  func distances(_ vector: JSONCase) {
    guard case .number(let meters) = vector.input else { return }
    #expect(Places.distanceLabel(meters) == vector.expected.string, "\(meters)")
  }

  @Test(arguments: JSON.cases("placeCategories"))
  func categories(_ vector: JSONCase) {
    #expect(Places.categoryLabel(vector.input.string) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("placeCoarsen"))
  func coarsen(_ vector: JSONCase) throws {
    let input: Geo.Position = try JSON.decode(vector.input)
    #expect(same(Geo.coarsen(input), vector.expected["coarse"]))
    guard case .number(let distance) = vector.expected["distance"] else { return }
    #expect(abs(Geo.haversine(Geo.Position(lat: 35.6431, lng: 139.6693), input) - distance) < 1e-6)
  }

  @Test func candidates() throws {
    let data = JSON.load("placeCandidates")
    let candidates: [Geo.Candidate] = try JSON.decode(data["candidates"])
    let ranked = Geo.rank(candidates, from: Geo.Position(lat: 35.6431, lng: 139.6693))
    let expected: [Geo.Candidate] = try JSON.decode(data["ranked"])
    #expect(ranked.map(\.key) == expected.map(\.key))
    for (a, b) in zip(ranked, expected) { #expect(abs((a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)) < 1e-6) }
    let now = Tokyo.parse("2026-09-30T07:30:00+09:00")!
    #expect(same(candidates.prefix(5).map { Geo.placeRef($0, via: .device, now: now) }, data["refs"]))
  }
}

struct NotificationPlanVectorTests {
  @Test(arguments: JSON.cases("notificationPlans"))
  func plans(_ vector: JSONCase) throws {
    var snapshot: HouseholdSnapshot = try JSON.decode(JSON.load("notificationPlanSnapshot"))
    snapshot.viewer.membershipId = vector.input["viewer"].string!
    #expect(same(NotificationPlan.plan(snapshot, now: vector.input["now"].string!), vector.expected), "\(vector.input)")
  }

  @Test func searchGroups() throws {
    let results: [SearchResult] = try JSON.decode(JSON.load("searchResults"))
    let groups = SearchGroups.group(results).map { group -> JSONValue in
      .object(["kind": .string(group.kind), "label": .string(group.label), "ids": .array(group.items.map { .string($0.id) })])
    }
    #expect(sameRaw(.array(groups), JSON.load("searchGroups")))
  }
}

/// 夜間の通知は7時にまとめる（server の notifications.list の規則。domain/commands/notifications.ts）。
struct QuietHoursTests {
  @Test(arguments: [
    ("2026-09-30T20:59:00+09:00", "2026-09-30T20:59:00+09:00"),
    ("2026-09-30T21:00:00+09:00", "2026-10-01T07:00:00+09:00"),
    ("2026-09-30T23:30:00+09:00", "2026-10-01T07:00:00+09:00"),
    ("2026-09-30T06:59:00+09:00", "2026-09-30T07:00:00+09:00"),
    ("2026-09-30T07:00:00+09:00", "2026-09-30T07:00:00+09:00"),
    ("2026-09-30T13:00:00Z", "2026-10-01T07:00:00+09:00"),
    ("2026-12-31T22:00:00+09:00", "2027-01-01T07:00:00+09:00"),
  ])
  func quiet(_ pair: (String, String)) {
    #expect(NotificationPlan.quietHours(pair.0) == pair.1)
  }
}
