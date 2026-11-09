import Foundation
import Testing
@testable import FHGateway
import FHModel

private let todoJSON = """
{"id":"todo-1","householdId":"house-1","title":"提出物","status":"open","assigneeMembershipId":"m-1","creatorMembershipId":"m-1","version":2,"visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]}}
"""
private let memoJSON = """
{"id":"memo-1","householdId":"house-1","title":"連絡","body":"本文","updatedAt":"2026-09-30T07:30:00+09:00","authorMembershipId":"m-1","tags":[],"attachments":[],"visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]},"version":1}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

/// タスクとメモの経路と本文の形が、Web の httpGateway.ts と同じであること。
struct ContentRouteTests {
  func server() -> StubServer {
    StubServer { request, _ in
      let path = request.url?.path ?? ""
      if path == "/v1/auth/csrf" { return (200, #"{"token":"token-1"}"#, [:]) }
      if path.hasPrefix("/v1/attachment-files/") { return path.hasSuffix("/gone") ? (404, #"{"code":"NOT_FOUND","message":"x","retryable":false}"#, [:]) : (200, "%PDF-1.4 見本", [:]) }
      if path.hasSuffix("/link") { return (200, #"{"url":"/v1/attachment-files/a-1?expires=1&signature=s","expiresAt":"2026-09-30T00:05:00.000Z"}"#, [:]) }
      if request.httpMethod == "DELETE" { return (204, "", [:]) }
      if path.hasPrefix("/v1/todos") { return (path.hasSuffix("/todos") ? 201 : 200, todoJSON, [:]) }
      if path.hasPrefix("/v1/memos") { return (path.hasSuffix("/attachments") ? 202 : 200, memoJSON, [:]) }
      return (404, "", [:])
    }
  }

  func json(_ data: Data?) throws -> [String: JSONValue] {
    guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: try #require(data)) else { throw CancellationError() }
    return object
  }

  @Test func todoRoutes() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    _ = try await gateway.createTodo(TodoInput(title: "提出物", assigneeMembershipId: "m-1"), context: MutationContext(idempotencyKey: "key-1", expectedPermissionRevision: 4)).get()
    var seen = try #require(server.seen.last)
    #expect(seen.method == "POST" && seen.path == "/v1/todos")
    #expect(seen.headers["Idempotency-Key"] == "key-1" && seen.headers["If-Permission-Revision"] == "4")
    #expect(try json(seen.body) == ["title": .string("提出物"), "assigneeMembershipId": .string("m-1")])

    var change = TodoUpdateInput()
    change.title = "提出物"
    change.reviewerMembershipId = .clear
    change.note = .set("持ち物")
    _ = try await gateway.updateTodo(id: "todo 1", scope: .this, input: change, expectedVersion: 2, context: nil).get()
    seen = try #require(server.seen.last)
    #expect(seen.method == "PATCH" && seen.path == "/v1/todos/todo 1")
    let body = try json(seen.body)
    #expect(body["scope"] == .string("this") && body["expectedVersion"] == .number(2))
    #expect(body["input"] == .object(["title": .string("提出物"), "reviewerMembershipId": .null, "note": .string("持ち物")]))

    _ = try await gateway.updateTodoStatus(id: "todo-1", status: .done, expectedVersion: 2, note: "").get()
    #expect(try json(server.seen.last?.body) == ["status": .string("done"), "expectedVersion": .number(2)])

    _ = try await gateway.deleteTodo(id: "todo-1", expectedVersion: 2, scope: .series).get()
    #expect(server.seen.last?.method == "DELETE")
    #expect(server.seenURLs.last?.query == "scope=series&expectedVersion=2")
    _ = try await gateway.restoreTodo(id: "todo-1").get()
    #expect(server.seen.last?.path == "/v1/todos/todo-1/restore" && server.seen.last?.method == "POST")
  }

  @Test func memoRoutes() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    _ = try await gateway.createMemo(MemoInput(title: "連絡", body: "本文", tags: ["学校"], memoDate: "2026-09-30"), context: nil).get()
    #expect(server.seen.last?.path == "/v1/memos")
    #expect(try json(server.seen.last?.body) == ["title": .string("連絡"), "body": .string("本文"), "tags": .array([.string("学校")]), "memoDate": .string("2026-09-30")])

    var change = MemoUpdateInput()
    change.ocrText = .clear
    _ = try await gateway.updateMemo(id: "memo-1", input: change, expectedVersion: 1, context: nil).get()
    #expect(server.seen.last?.method == "PATCH" && server.seen.last?.path == "/v1/memos/memo-1")
    #expect(try json(server.seen.last?.body) == ["input": .object(["ocrText": .null]), "expectedVersion": .number(1)])

    _ = try await gateway.deleteMemo(id: "memo-1").get()
    #expect(server.seen.last?.method == "DELETE" && server.seen.last?.path == "/v1/memos/memo-1")
    _ = try await gateway.restoreMemo(id: "memo-1").get()
    #expect(server.seen.last?.path == "/v1/memos/memo-1/restore")
    _ = try await gateway.deleteAttachment(memoId: "memo-1", attachmentId: "a-1").get()
    #expect(server.seen.last?.method == "DELETE" && server.seen.last?.path == "/v1/memos/memo-1/attachments/a-1")
  }

  @Test func uploadKeepsTheSameKeyWhenSentAgain() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let file = UploadFile(name: "お知らせ.pdf", type: "application/pdf", data: Data("%PDF-1.4".utf8))
    _ = try await gateway.uploadAttachment(memoId: "memo-1", file: file, idempotencyKey: "file-key").get()
    _ = try await gateway.uploadAttachment(memoId: "memo-1", file: file, idempotencyKey: "file-key").get()
    let uploads = server.seen.filter { $0.path == "/v1/memos/memo-1/attachments" }
    #expect(uploads.count == 2)
    #expect(uploads.allSatisfy { $0.headers["Idempotency-Key"] == "file-key" && $0.headers["X-CSRF-Token"] == "token-1" })
    let type = try #require(uploads[0].headers["Content-Type"])
    #expect(type.hasPrefix("multipart/form-data; boundary="))
    let body = String(decoding: try #require(uploads[0].body), as: UTF8.self)
    #expect(body.contains(#"name="file"; filename="お知らせ.pdf""#) && body.contains("Content-Type: application/pdf"))
  }

  @Test func linksAndDownloads() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let inline = try await gateway.getAttachmentLink(memoId: "memo-1", attachmentId: "a-1", disposition: .inline).get()
    #expect(server.seen.last?.path == "/v1/memos/memo-1/attachments/a-1/link" && server.seenURLs.last?.query == nil)
    _ = try await gateway.getAttachmentLink(memoId: "memo-1", attachmentId: "a-1", disposition: .attachment).get()
    #expect(server.seenURLs.last?.query == "download=1")
    // 相対の道を、同じサーバーから取る。名前の道の区切りは外す。
    let file = try await gateway.downloadAttachment(inline, fileName: "../学校公開.pdf").get()
    defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
    #expect(file.lastPathComponent == "学校公開.pdf")
    #expect(file.path.contains("fh-attachments"))
    #expect(String(decoding: try Data(contentsOf: file), as: UTF8.self) == "%PDF-1.4 見本")
    #expect(server.seen.last?.path == "/v1/attachment-files/a-1" && server.seenURLs.last?.query == "expires=1&signature=s")
    // 取れなかったときと、ほかのサーバーへの道は失敗にする。
    guard case .failure = await gateway.downloadAttachment(AttachmentLink(url: "/v1/attachment-files/gone", expiresAt: ""), fileName: "a.pdf") else { Issue.record("404 は失敗のはず"); return }
    guard case .failure = await gateway.downloadAttachment(AttachmentLink(url: "https://elsewhere.example/a", expiresAt: ""), fileName: "a.pdf") else { Issue.record("ほかのサーバーは読まない"); return }
  }

  @Test func safeNames() {
    #expect(AttachmentFiles.safeName("a/b:c.pdf") == "abc.pdf")
    #expect(AttachmentFiles.safeName("..") == "file")
    #expect(AttachmentFiles.safeName(".hidden") == "hidden")
    #expect(AttachmentFiles.safeName("  ") == "file")
  }
}

/// 見本のモードで、タスクとメモが Web と同じ規則で動くこと。
struct SampleContentTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  @Test func taskLifecycle() async throws {
    let created = try await gateway.createTodo(TodoInput(title: "上履きを洗う", dueAt: "2026-10-02T20:00:00+09:00", assigneeMembershipId: "member-aoi", reviewerMembershipId: "member-ren", visibility: VisibilityInput(audience: .household, selectedMembershipIds: [])), context: nil).get()
    #expect(created.status == .open && created.reviewerMembershipId == "member-ren")
    let review = try await gateway.updateTodoStatus(id: created.id, status: .review, expectedVersion: created.version, note: "乾かしてあります").get()
    #expect(review.status == .review && review.handoffNote == "乾かしてあります")
    var change = TodoUpdateInput()
    change.reviewerMembershipId = .clear
    let updated = try await gateway.updateTodo(id: created.id, scope: .series, input: change, expectedVersion: review.version, context: nil).get()
    #expect(updated.reviewerMembershipId == nil)
    guard case .failure(let stale) = await gateway.updateTodo(id: created.id, scope: .series, input: change, expectedVersion: review.version, context: nil) else { Issue.record("版の競合になるはず"); return }
    #expect(stale.code == .conflict)
    _ = try await gateway.deleteTodo(id: created.id, expectedVersion: updated.version, scope: .series).get()
    #expect(!(try await gateway.getSnapshot().get().todos.contains { $0.id == created.id }))
    _ = try await gateway.restoreTodo(id: created.id).get()
    #expect(try await gateway.getSnapshot().get().todos.contains { $0.id == created.id })
  }

  @Test func completingARecurringTaskMakesTheNextOne() async throws {
    let series = try #require(try await gateway.getSnapshot().get().todos.first { $0.id == "todo-garbage" })
    let done = try await gateway.updateTodoStatus(id: series.id, status: .done, expectedVersion: series.version, note: "出しました").get()
    #expect(done.status == .done && done.recurrence == nil && done.completionNote == "出しました")
    let next = try #require(try await gateway.getSnapshot().get().todos.first { $0.id == series.id })
    #expect(next.status == .open)
    #expect(next.dueAt?.hasPrefix("2026-10-08") == true)
  }

  @Test func memoWithAnAttachment() async throws {
    let memo = try await gateway.createMemo(MemoInput(title: "持ち物", body: "体操服", tags: ["学校"], visibility: VisibilityInput(audience: .household, selectedMembershipIds: [])), context: nil).get()
    let file = UploadFile(name: "持ち物.pdf", type: "application/pdf", data: Data("%PDF-1.4".utf8))
    let accepted = try await gateway.uploadAttachment(memoId: memo.id, file: file, idempotencyKey: "k-1").get()
    let attachment = try #require(accepted.attachments.first)
    #expect(attachment.status == .quarantined && attachment.originalName == "持ち物.pdf")
    // 確認が終わるまでは開けない。
    guard case .failure = await gateway.getAttachmentLink(memoId: memo.id, attachmentId: attachment.id, disposition: .inline) else { Issue.record("確認中は開けないはず"); return }
    var status = attachment.status
    for _ in 0..<200 where status != .clean {
      try await Task.sleep(for: .milliseconds(20))
      status = try await gateway.getSnapshot().get().memos.first { $0.id == memo.id }?.attachments.first?.status ?? status
    }
    #expect(status == .clean)
    let link = try await gateway.getAttachmentLink(memoId: memo.id, attachmentId: attachment.id, disposition: .inline).get()
    #expect(link.url == "fh-sample://sample-notice.pdf")
    let local = try await gateway.downloadAttachment(link, fileName: attachment.originalName).get()
    defer { try? FileManager.default.removeItem(at: local.deletingLastPathComponent()) }
    #expect(local.lastPathComponent == "持ち物.pdf")
    #expect(try Data(contentsOf: local).starts(with: Data("%PDF".utf8)))
    _ = try await gateway.deleteAttachment(memoId: memo.id, attachmentId: attachment.id).get()
    #expect(try await gateway.getSnapshot().get().memos.first { $0.id == memo.id }?.attachments.isEmpty == true)
    var ocr = MemoUpdateInput()
    ocr.ocrText = .set(" 体操服 ")
    let latest = try #require(try await gateway.getSnapshot().get().memos.first { $0.id == memo.id })
    let corrected = try await gateway.updateMemo(id: memo.id, input: ocr, expectedVersion: latest.version, context: nil).get()
    #expect(corrected.ocrText == " 体操服 ")
    _ = try await gateway.deleteMemo(id: memo.id).get()
    _ = try await gateway.restoreMemo(id: memo.id).get()
  }

  @Test func sampleFilesResolveOnlyInsideTheBundle() {
    for name in ["sample-notice.pdf", "sample-photo.jpg", "sample-clip.mp4", "sample-diagram.png"] {
      #expect(SampleGateway.sampleFile("fh-sample://\(name)") != nil, "\(name)")
    }
    #expect(SampleGateway.sampleFile("fh-sample://../Info.plist") == nil)
    #expect(SampleGateway.sampleFile("https://example.com/a.pdf") == nil)
    #expect(SampleGateway.sampleFile("fh-sample://missing.pdf") == nil)
  }
}
