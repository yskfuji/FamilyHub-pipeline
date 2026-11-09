import Foundation
import Testing
@testable import FHGateway
import FHModel

private let notificationJSON = """
{"id":"n-1","kind":"todoDue","destination":"/tasks/t-1","title":"本を返す","body":"18:00まで","remindAt":"2026-09-30T17:30:00+09:00","read":false,"status":"snoozed"}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

struct NotificationRouteTests {
  @Test func routes() async throws {
    let server = StubServer { request, _ in
      let path = request.url?.path ?? ""
      if path == "/v1/auth/csrf" { return (200, #"{"token":"t"}"#, [:]) }
      if path == "/v1/notification-preferences" { return (200, #"{"todoDue":true,"eventDeparture":false,"quietHours":true}"#, [:]) }
      if path == "/v1/search" { return (200, #"[{"kind":"memo","id":"m-1","label":"学校","destination":"/notes/m-1"}]"#, [:]) }
      if path == "/v1/insights" { return (200, "[]", [:]) }
      return (200, notificationJSON, [:])
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    _ = try await gateway.snoozeNotification(id: "n-1", minutes: 30).get()
    #expect(server.seen.last?.path == "/v1/notifications/n-1/snooze")
    #expect(try JSONDecoder().decode(JSONValue.self, from: try #require(server.seen.last?.body)) == .object(["minutes": .number(30)]))
    _ = try await gateway.stopNotification(id: "n-1").get()
    #expect(server.seen.last?.path == "/v1/notifications/n-1/stop" && server.seen.last?.method == "POST")
    _ = try await gateway.resumeNotification(id: "n-1").get()
    #expect(server.seen.last?.path == "/v1/notifications/n-1/resume")
    var preferences = try await gateway.getNotificationPreferences().get()
    #expect(!preferences.eventDeparture)
    preferences.quietHours = false
    _ = try await gateway.updateNotificationPreferences(preferences).get()
    #expect(server.seen.last?.method == "PATCH")
    let results = try await gateway.search("学校 行事").get()
    #expect(results.first?.id == "m-1")
    #expect(server.seenURLs.last(where: { $0.path == "/v1/search" })?.percentEncodedQuery == "q=%E5%AD%A6%E6%A0%A1%20%E8%A1%8C%E4%BA%8B")
    _ = try await gateway.listInsights().get()
  }

  @Test func placeRowsAreChecked() {
    let rows = OpenPoiLookup.rows([
      ["name": " 青葉書店 ", "address": "東京都", "lat": 35.6, "lng": "139.6", "category": "unknown", "source": "", "licenses": ["ODbL", ""], "attributions": ["© OSM"]],
      ["name": "", "lat": 35.0, "lng": 139.0],
      ["name": "北の果て", "lat": 91.0, "lng": 0.0],
      ["name": "数字でない", "lat": "abc", "lng": 1.0],
      "not an object",
    ])
    #expect(rows.count == 1)
    #expect(rows.first == PlaceRow(name: "青葉書店", address: "東京都", lat: 35.6, lng: 139.6, category: nil, source: "unknown", licenses: ["ODbL"], attributions: ["© OSM"]))
    #expect(OpenPoiLookup.center(35.643, 139.669) == "139.669,35.643")
  }
}

struct SampleNotificationTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  @Test func actionsAndPreferences() async throws {
    let list = try await gateway.listNotifications().get()
    let first = try #require(list.first)
    #expect(try await gateway.snoozeNotification(id: first.id, minutes: 30).get().status == .snoozed)
    guard case .failure = await gateway.snoozeNotification(id: first.id, minutes: 10) else { Issue.record("30分以外は断られるはず"); return }
    #expect(try await gateway.stopNotification(id: first.id).get().status == .stopped)
    #expect(try await gateway.resumeNotification(id: first.id).get().status == .active)
    var preferences = try await gateway.getNotificationPreferences().get()
    preferences.todoDue = false
    #expect(try await gateway.updateNotificationPreferences(preferences).get().todoDue == false)
    #expect(try await gateway.listNotifications().get().allSatisfy { $0.kind != .todoDue })
    #expect(try await gateway.search("学校").get().count >= 5)
    #expect(try await gateway.listInsights().get().contains { $0.id == "insight-unsettled" })
  }
}
