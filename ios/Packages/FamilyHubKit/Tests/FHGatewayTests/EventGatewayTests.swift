import Foundation
import Testing
@testable import FHGateway
import FHModel

private let eventJSON = """
{"id":"event-1","householdId":"house-1","title":"面談","startsAt":"2026-10-01T10:00:00+09:00","endsAt":"2026-10-01T11:00:00+09:00","timezone":"Asia/Tokyo","ownerMembershipId":"m-1","participantMembershipIds":["m-1"],"version":3,"visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]}}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

/// 予定と読み取りの経路と本文の形が、Web の httpGateway.ts と同じであること。
struct EventRouteTests {
  func server() -> StubServer {
    StubServer { request, _ in
      switch request.url?.path {
      case "/v1/auth/csrf": (200, #"{"token":"token-1"}"#, [:])
      case "/v1/assistant/event-image", "/v1/assistant/event-url": (202, #"{"id":"job-1","kind":"event","status":"queued"}"#, [:])
      case let path? where path.hasPrefix("/v1/events"): request.httpMethod == "DELETE" ? (204, "", [:]) : (200, eventJSON, [:])
      default: (404, "", [:])
      }
    }
  }

  func json(_ data: Data?) throws -> [String: JSONValue] {
    guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: try #require(data)) else { throw CancellationError() }
    return object
  }

  @Test func createSendsTheContextHeaders() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let input = EventInput(title: "面談", startsAt: "2026-10-01T10:00:00+09:00", endsAt: "2026-10-01T11:00:00+09:00", participantMembershipIds: ["m-1"], visibility: VisibilityInput(audience: .household, selectedMembershipIds: ["x"]))
    _ = try await gateway.createEvent(input, context: MutationContext(idempotencyKey: "key-1", expectedPermissionRevision: 7)).get()
    let seen = try #require(server.seen.last)
    #expect(seen.method == "POST" && seen.path == "/v1/events")
    #expect(seen.headers["Idempotency-Key"] == "key-1")
    #expect(seen.headers["If-Permission-Revision"] == "7")
    #expect(seen.headers["X-CSRF-Token"] == "token-1")
    let body = try json(seen.body)
    #expect(body["title"] == .string("面談"))
    // 選んだ人は「選択したメンバー」のときだけ送る。省いた項目は書かない。
    #expect(body["visibility"] == .object(["audience": .string("household"), "selectedMembershipIds": .array([])]))
    #expect(body["location"] == nil && body["allDay"] == nil)
  }

  @Test func updateSendsNullForClearedFields() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    var input = EventUpdateInput()
    input.title = "面談"
    input.location = .clear
    input.note = .set("持ち物")
    input.recurrence = .clear
    _ = try await gateway.updateEvent(id: "event 1", scope: .this, input: input, expectedVersion: 3, context: nil, occurrenceDate: "2026-10-01").get()
    let seen = try #require(server.seen.last)
    #expect(seen.method == "PATCH")
    #expect(seen.path == "/v1/events/event 1")
    let body = try json(seen.body)
    #expect(body["scope"] == .string("this") && body["expectedVersion"] == .number(3) && body["occurrenceDate"] == .string("2026-10-01"))
    guard case .object(let sent)? = body["input"] else { Issue.record("input がない"); return }
    #expect(sent["location"] == .null && sent["recurrence"] == .null)
    #expect(sent["note"] == .string("持ち物"))
    #expect(sent["colorLabelId"] == nil && sent["visibility"] == nil)
  }

  @Test func deleteAndRestoreUseTheQuery() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    _ = try await gateway.deleteEvent(id: "event-1", scope: .future, expectedVersion: 3, occurrenceDate: "2026-10-08").get()
    let deleted = try #require(server.seen.last)
    #expect(deleted.method == "DELETE")
    #expect(server.seenURLs.last?.query == "scope=future&expectedVersion=3&occurrenceDate=2026-10-08")
    _ = try await gateway.restoreEvent(id: "event-1", occurrenceDate: nil).get()
    #expect(server.seen.last?.path == "/v1/events/event-1/restore")
    #expect(server.seenURLs.last?.query == nil)
    _ = try await gateway.restoreEvent(id: "event-1", occurrenceDate: "2026-10-08").get()
    #expect(server.seenURLs.last?.query == "occurrenceDate=2026-10-08")
  }

  @Test func imageReadingSendsAMultipartForm() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let job = try await gateway.readEventImage(UploadFile(name: "flyer.jpg", type: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF, 0x00]))).get()
    #expect(job.id == "job-1")
    let seen = try #require(server.seen.last)
    let type = try #require(seen.headers["Content-Type"])
    #expect(type.hasPrefix("multipart/form-data; boundary="))
    let body = String(decoding: try #require(seen.body), as: UTF8.self)
    #expect(body.contains(#"Content-Disposition: form-data; name="file"; filename="flyer.jpg""#))
    #expect(body.contains("Content-Type: image/jpeg"))
    _ = try await gateway.readEventUrl("https://example.com/a").get()
    #expect(try json(server.seen.last?.body)["url"] == .string("https://example.com/a"))
  }
}

/// 見本のモードで、予定の追加・変更・削除・復元と読み取りが Web と同じ規則で動くこと。
struct SampleEventTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  func context() async throws -> MutationContext {
    let snapshot = try await gateway.getSnapshot().get()
    return MutationContext(idempotencyKey: UUID().uuidString.lowercased(), expectedPermissionRevision: snapshot.viewer.permissionRevision)
  }

  @Test func createUpdateDeleteRestore() async throws {
    let input = EventInput(title: "歯医者", startsAt: "2026-10-02T15:00:00+09:00", endsAt: "2026-10-02T16:00:00+09:00", participantMembershipIds: ["member-aoi"], location: "駅前", visibility: VisibilityInput(audience: .household, selectedMembershipIds: []))
    let created = try await gateway.createEvent(input, context: try await context()).get()
    #expect(created.title == "歯医者" && created.location == "駅前")
    var change = EventUpdateInput()
    change.title = "歯医者（検診）"
    change.location = .clear
    let updated = try await gateway.updateEvent(id: created.id, scope: .series, input: change, expectedVersion: created.version, context: nil, occurrenceDate: nil).get()
    #expect(updated.title == "歯医者（検診）" && updated.location == nil)
    // 古い版では変えられない。
    guard case .failure(let stale) = await gateway.updateEvent(id: created.id, scope: .series, input: change, expectedVersion: created.version, context: nil, occurrenceDate: nil) else { Issue.record("版の競合になるはず"); return }
    #expect(stale.code == .conflict)
    _ = try await gateway.deleteEvent(id: created.id, scope: .series, expectedVersion: updated.version, occurrenceDate: nil).get()
    #expect(!(try await gateway.getSnapshot().get().events.contains { $0.id == created.id }))
    _ = try await gateway.restoreEvent(id: created.id, occurrenceDate: nil).get()
    #expect(try await gateway.getSnapshot().get().events.contains { $0.id == created.id })
  }

  @Test func oneOccurrenceOfASeries() async throws {
    let snapshot = try await gateway.getSnapshot().get()
    let series = try #require(snapshot.events.first { $0.recurrence != nil })
    // 見本の繰り返しの予定は 2026-10-01（木）から毎週。次の回は 10月8日。
    #expect(series.startsAt.hasPrefix("2026-10-01"))
    let next = "2026-10-08"
    _ = try await gateway.deleteEvent(id: series.id, scope: .this, expectedVersion: series.version, occurrenceDate: next).get()
    let after = try #require(try await gateway.getSnapshot().get().events.first { $0.id == series.id })
    #expect(after.recurrence?.exceptions.contains(next) == true)
    _ = try await gateway.restoreEvent(id: series.id, occurrenceDate: next).get()
    let restored = try #require(try await gateway.getSnapshot().get().events.first { $0.id == series.id })
    #expect(restored.recurrence?.exceptions.contains(next) == false)
  }

  @Test func readingAFlyerGivesCandidates() async throws {
    let status = try await gateway.getAssistantStatus().get()
    #expect(status.available && status.sample == true)
    guard case .failure(let rejected) = await gateway.readEventImage(UploadFile(name: "a.gif", type: "image/gif", data: Data([0x47, 0x49, 0x46]))) else { Issue.record("GIF は断られるはず"); return }
    #expect(rejected.message == "読み取れるのはJPEGとPNGの画像です。")
    let started = try await gateway.readEventImage(UploadFile(name: "a.jpg", type: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]))).get()
    var job = started
    for _ in 0..<200 where job.status != .done {
      try await Task.sleep(for: .milliseconds(20))
      job = try await gateway.getAssistantJob(id: started.id).get()
    }
    #expect(job.status == .done)
    #expect(job.events?.isEmpty == false)
    guard case .failure(let badURL) = await gateway.readEventUrl("http://example.com") else { Issue.record("http は断られるはず"); return }
    #expect(badURL.message == "https で始まる URL を入力してください。", "\(badURL)")
  }
}
