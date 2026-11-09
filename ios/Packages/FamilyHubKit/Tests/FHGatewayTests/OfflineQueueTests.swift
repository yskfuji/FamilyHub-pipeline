import Foundation
import Testing
import CryptoKit
@testable import FHGateway
import FHModel

/// 送れなかった変更の待ち行列（Web の src/offline/queue.test.ts と同じ決まり）。
struct OfflineQueueTests {
  final class Clock: @unchecked Sendable {
    var value: Double = 1_790_000_000_000
  }

  private func memo(_ title: String) -> QueueableCommand {
    .memoCreate(input: MemoInput(title: title, body: "本文", tags: ["学校"]))
  }

  @Test func storesEncryptedAndReadsBack() async throws {
    let store = MemoryQueueStore()
    let queue = OfflineQueue(store: store)
    var update = MemoUpdateInput()
    update.ocrText = .clear
    update.title = "直した題"
    let id = try await queue.enqueue(.memoUpdate(id: "memo-1", input: update, expectedVersion: 3), summary: "メモ「学校」を変更", actorUserId: "user-aoi", householdId: "house-mori", permissionRevision: 7, clientOperationId: "key-1")
    try await queue.enqueue(memo("持ち物"), summary: "メモ「持ち物」を作成", actorUserId: "user-aoi", householdId: "house-mori", permissionRevision: 7)
    let list = try await queue.list()
    #expect(list.map(\.summary) == ["メモ「学校」を変更", "メモ「持ち物」を作成"])
    #expect(list[0].id == id && list[0].clientOperationId == "key-1" && list[0].state == .pending)
    guard case .memoUpdate(let memoId, let input, let version) = list[0].command else { Issue.record("種類が違う"); return }
    #expect(memoId == "memo-1" && version == 3 && input == update)
    // 端末に置いた形には、題や本文が平文で残らない。
    let raw = try JSONEncoder().encode(try store.load())
    #expect(String(decoding: raw, as: UTF8.self).contains("持ち物") == false)
    #expect(String(decoding: raw, as: UTF8.self).contains("本文") == false)
  }

  @Test func tamperedMetadataCannotBeRead() async throws {
    let store = MemoryQueueStore()
    let queue = OfflineQueue(store: store)
    try await queue.enqueue(memo("a"), summary: "a", actorUserId: "user-aoi", householdId: "house-mori", permissionRevision: 1)
    var records = try store.load()
    records[0].householdId = "house-other"
    try store.save(records)
    await #expect(throws: QueueFailure.unreadable) { try await queue.list() }
  }

  @Test func expiresAfterADayAndKeepsFifty() async throws {
    let clock = Clock()
    let store = MemoryQueueStore()
    let queue = OfflineQueue(store: store, now: { clock.value })
    for index in 0..<50 { try await queue.enqueue(memo("\(index)"), summary: "\(index)", actorUserId: "u", householdId: "h", permissionRevision: 1) }
    await #expect(throws: QueueFailure.full) { try await queue.enqueue(memo("51"), summary: "51", actorUserId: "u", householdId: "h", permissionRevision: 1) }
    clock.value += OfflineQueue.lifetime + 1
    #expect(try await queue.list().isEmpty)
    #expect(try store.load().isEmpty)
  }

  @Test func markRemoveAndClear() async throws {
    let store = MemoryQueueStore()
    let queue = OfflineQueue(store: store)
    let first = try await queue.enqueue(memo("a"), summary: "a", actorUserId: "u", householdId: "h", permissionRevision: 1)
    let second = try await queue.enqueue(.taskUpdate(id: "t", scope: .this, input: TodoUpdateInput(), expectedVersion: 1), summary: "b", actorUserId: "u", householdId: "h", permissionRevision: 1)
    try await queue.mark(first, .conflicted)
    #expect(try await queue.list().first?.state == .conflicted)
    try await queue.remove(first)
    #expect(try await queue.list().map(\.id) == [second])
    try await queue.clear()
    #expect(try store.key() == nil)
    #expect(try await queue.list().isEmpty)
  }

  @Test func updateInputsRoundTrip() throws {
    var event = EventUpdateInput()
    event.title = "歯医者"
    event.location = .clear
    event.reminderMinutesBefore = .set(30)
    let decodedEvent = try JSONDecoder().decode(EventUpdateInput.self, from: JSONEncoder().encode(event))
    #expect(decodedEvent == event)
    var todo = TodoUpdateInput()
    todo.dueAt = .clear
    todo.priority = .set(.high)
    #expect(try JSONDecoder().decode(TodoUpdateInput.self, from: JSONEncoder().encode(todo)) == todo)
  }
}

struct SampleOfflineTests {
  @Test func offlineUntilTheNextSnapshot() async throws {
    let gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01))
    await gateway.simulateOffline()
    let input = TodoInput(title: "電池を買う", assigneeMembershipId: "member-aoi")
    guard case .failure(let failure) = await gateway.createTodo(input, context: nil) else { Issue.record("切れている間は断られるはず"); return }
    #expect(failure.code == .offline)
    _ = try await gateway.getSnapshot().get()
    #expect(try await gateway.createTodo(input, context: nil).get().title == "電池を買う")
  }
}
