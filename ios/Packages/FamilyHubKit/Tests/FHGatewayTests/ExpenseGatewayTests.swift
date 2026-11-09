import Foundation
import Testing
@testable import FHGateway
import FHModel

private let expenseJSON = """
{"id":"expense-1","householdId":"house-1","kind":"expense","title":"食材","amountJpy":1000,"incurredOn":"2026-09-30","payerMembershipId":"m-1","creatorMembershipId":"m-1","category":"food","shares":[],"settlements":[],"visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]},"version":2}
"""
private let batchJSON = """
{"id":"batch-1","householdId":"house-1","recordedAt":"2026-09-30T07:30:00+09:00","recordedByMembershipId":"m-1","transfers":[],"items":[]}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

/// 家計の経路と本文の形が、Web の httpGateway.ts と同じであること。
struct ExpenseRouteTests {
  func server() -> StubServer {
    StubServer { request, _ in
      let path = request.url?.path ?? ""
      if path == "/v1/auth/csrf" { return (200, #"{"token":"token-1"}"#, [:]) }
      if path.hasPrefix("/v1/settlement-batches") { return (201, batchJSON, [:]) }
      if path == "/v1/assistant/receipt" { return (202, #"{"id":"job-1","kind":"receipt","status":"queued"}"#, [:]) }
      if request.httpMethod == "DELETE" { return (204, "", [:]) }
      if path.hasPrefix("/v1/expenses") { return (200, expenseJSON, [:]) }
      return (404, "", [:])
    }
  }

  func json(_ data: Data?) throws -> [String: JSONValue] {
    guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: try #require(data)) else { throw CancellationError() }
    return object
  }

  @Test func routes() async throws {
    let server = server()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let input = ExpenseInput(kind: .expense, title: "食材", amountJpy: 1000, incurredOn: "2026-09-30", payerMembershipId: "m-1", category: "food", visibility: VisibilityInput(audience: .household, selectedMembershipIds: []), shareMembershipIds: ["m-1", "m-2"])
    _ = try await gateway.createExpense(input, idempotencyKey: "form-key").get()
    var seen = try #require(server.seen.last)
    #expect(seen.method == "POST" && seen.path == "/v1/expenses" && seen.headers["Idempotency-Key"] == "form-key")
    let body = try json(seen.body)
    #expect(body["shareMembershipIds"] == .array([.string("m-1"), .string("m-2")]) && body["shareAmounts"] == nil && body["note"] == nil)

    var change = ExpenseUpdateInput()
    change.title = "食材"
    change.note = .clear
    change.place = .clear
    _ = try await gateway.updateExpense(id: "expense-1", input: change, expectedVersion: 2).get()
    seen = try #require(server.seen.last)
    #expect(seen.method == "PATCH" && seen.path == "/v1/expenses/expense-1")
    #expect(try json(seen.body) == ["input": .object(["title": .string("食材"), "note": .null, "place": .null]), "expectedVersion": .number(2)])

    _ = try await gateway.deleteExpense(id: "expense-1", expectedVersion: 2).get()
    #expect(server.seen.last?.method == "DELETE" && server.seenURLs.last?.query == "expectedVersion=2")
    _ = try await gateway.restoreExpense(id: "expense-1").get()
    #expect(server.seen.last?.path == "/v1/expenses/expense-1/restore")
    _ = try await gateway.recordSettlement(expenseId: "expense-1", fromMembershipId: "m-2", amountJpy: 500).get()
    #expect(server.seen.last?.path == "/v1/expenses/expense-1/settlements")
    #expect(try json(server.seen.last?.body) == ["fromMembershipId": .string("m-2"), "amountJpy": .number(500)])
    _ = try await gateway.reverseSettlement(expenseId: "expense-1", settlementId: "s 1").get()
    #expect(server.seen.last?.path == "/v1/expenses/expense-1/settlements/s 1/reverse")

    let all = SettleAllInput(shares: [.init(expenseId: "expense-1", membershipId: "m-2", remainingJpy: 500)], transfers: [SettlementTransfer(from: "m-2", to: "m-1", amountJpy: 500)])
    _ = try await gateway.settleAll(all, idempotencyKey: "batch-key").get()
    seen = try #require(server.seen.last)
    #expect(seen.path == "/v1/settlement-batches" && seen.headers["Idempotency-Key"] == "batch-key")
    #expect(try json(seen.body)["transfers"] == .array([.object(["from": .string("m-2"), "to": .string("m-1"), "amountJpy": .number(500)])]))
    _ = try await gateway.reverseBatch(id: "batch-1", idempotencyKey: "reverse-key").get()
    #expect(server.seen.last?.path == "/v1/settlement-batches/batch-1/reverse" && server.seen.last?.headers["Idempotency-Key"] == "reverse-key")

    _ = try await gateway.readReceipt(UploadFile(name: "receipt.jpg", type: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF]))).get()
    #expect(server.seen.last?.path == "/v1/assistant/receipt" && server.seen.last?.headers["Content-Type"]?.hasPrefix("multipart/form-data") == true)
  }
}

/// 見本のモードで、家計の追加・精算・まとめた精算・削除が Web と同じ規則で動くこと。
struct SampleExpenseTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  @Test func createSettleAndReverse() async throws {
    let input = ExpenseInput(kind: .expense, title: "上履き", amountJpy: 1001, incurredOn: "2026-09-30", payerMembershipId: "member-aoi", category: "shopping", visibility: VisibilityInput(audience: .household, selectedMembershipIds: []), shareMembershipIds: ["member-aoi", "member-ren"])
    let created = try await gateway.createExpense(input, idempotencyKey: "k-1").get()
    #expect(created.shares.map(\.amountJpy) == [501, 500])
    // 同じ鍵で送り直しても、記録は1つ。
    let again = try await gateway.createExpense(input, idempotencyKey: "k-1").get()
    #expect(again.id == created.id)
    let settled = try await gateway.recordSettlement(expenseId: created.id, fromMembershipId: "member-ren", amountJpy: 200).get()
    let record = try #require(settled.settlements.first)
    #expect(record.amountJpy == 200 && settled.shares.first { $0.membershipId == "member-ren" }?.settledJpy == 200)
    // 精算の記録があるうちは削除できない。
    guard case .failure(let blocked) = await gateway.deleteExpense(id: created.id, expectedVersion: settled.version) else { Issue.record("削除できないはず"); return }
    #expect(blocked.code == .conflict)
    let reversed = try await gateway.reverseSettlement(expenseId: created.id, settlementId: record.id).get()
    #expect(reversed.settlements.count == 2 && reversed.settlements.last?.amountJpy == -200)
    _ = try await gateway.deleteExpense(id: created.id, expectedVersion: reversed.version).get()
    _ = try await gateway.restoreExpense(id: created.id).get()
    #expect(try await gateway.getSnapshot().get().expenses.contains { $0.id == created.id })
  }

  static func request(_ snapshot: HouseholdSnapshot) -> SettleAllInput {
    let open = snapshot.expenses.flatMap { expense in
      expense.shares.filter { $0.membershipId != expense.payerMembershipId && $0.amountJpy > $0.settledJpy }.map { SettleAllInput.Share(expenseId: expense.id, membershipId: $0.membershipId, remainingJpy: $0.amountJpy - $0.settledJpy) }
    }
    var net: [Id: Int] = [:]
    for share in open {
      net[share.membershipId, default: 0] -= share.remainingJpy
      let payer = snapshot.expenses.first { $0.id == share.expenseId }!.payerMembershipId
      net[payer, default: 0] += share.remainingJpy
    }
    let from = net.first { $0.value < 0 }!, to = net.first { $0.value > 0 }!
    return SettleAllInput(shares: open, transfers: [SettlementTransfer(from: from.key, to: to.key, amountJpy: to.value)])
  }

  /// 碧さんには見えない蓮さんの記録に、碧さんの残りがある。見えない負担があるときは、まとめて精算しない（Web と同じ）。
  @Test func settleAllIsRefusedWhenAShareIsHidden() async throws {
    let input = Self.request(try await gateway.getSnapshot().get())
    guard case .failure(let refused) = await gateway.settleAll(input, idempotencyKey: "batch-1") else { Issue.record("断られるはず"); return }
    #expect(refused.code == .conflict)
  }

  @Test func settleEverythingAtOnce() async throws {
    let ren = SampleGateway(engine: try SampleEngine(actorId: "member-ren", timeScale: 0.01))
    let input = Self.request(try await ren.getSnapshot().get())
    let batch = try await ren.settleAll(input, idempotencyKey: "batch-1").get()
    #expect(batch.items.count == input.shares.count)
    #expect(try await ren.getSnapshot().get().settlementBatches.contains { $0.id == batch.id })
    let undone = try await ren.reverseBatch(id: batch.id, idempotencyKey: "undo-1").get()
    #expect(undone.reversedAt != nil)
  }

  @Test func readingAReceipt() async throws {
    let started = try await gateway.readReceipt(UploadFile(name: "r.jpg", type: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF, 0xE0]))).get()
    var job = started
    for _ in 0..<200 where job.status != .done {
      try await Task.sleep(for: .milliseconds(20))
      job = try await gateway.getAssistantJob(id: started.id).get()
    }
    #expect(job.receipt != nil)
  }
}

/// 同じ入力は、何度送っても同じ本文になる（冪等の鍵で照らされるため）。
struct StableBodyTests {
  @Test func sameInputSameBytes() throws {
    let input = ExpenseInput(kind: .expense, title: "上履き", amountJpy: 1001, incurredOn: "2026-09-30", payerMembershipId: "member-aoi", category: "shopping", visibility: VisibilityInput(audience: .household, selectedMembershipIds: []), shareMembershipIds: ["member-aoi", "member-ren"], note: "a")
    let first = try #require(APIClient.Request.json(.post, "/v1/expenses", input).body)
    for _ in 0..<50 { #expect(APIClient.Request.json(.post, "/v1/expenses", input).body == first) }
  }
}
