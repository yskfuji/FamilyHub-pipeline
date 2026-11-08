import Foundation
import Testing
@testable import FHGateway
import FHModel

/// 見本のモードが、JavaScriptCore の中で Web と同じ規則で動くこと。
struct SampleGatewayTests {
  let gateway: SampleGateway

  init() throws {
    gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01))
  }

  @Test func readsTheSampleHousehold() async throws {
    let snapshot = try await gateway.getSnapshot().get()
    #expect(snapshot.household.name == "森さんち")
    #expect(snapshot.viewer.membershipId == "member-aoi")
    #expect(snapshot.todos.contains { $0.id == "todo-library" })
    let session = try await gateway.getSession().get()
    #expect(session.stage == .active)
  }

  @Test func changesFollowTheSameRules() async throws {
    let before = try await gateway.getSnapshot().get()
    let todo = try #require(before.todos.first { $0.id == "todo-library" })
    let done = try await gateway.updateTodoStatus(id: todo.id, status: .done, expectedVersion: todo.version, note: nil).get()
    #expect(done.status == .done)
    #expect(done.version == todo.version + 1)
    // 古い版で変えようとすると、サーバーと同じく版の競合になる。
    let stale = await gateway.updateTodoStatus(id: todo.id, status: .open, expectedVersion: todo.version, note: nil)
    guard case .failure(let error) = stale else { Issue.record("版の競合になるはず"); return }
    #expect(error.code == .conflict)
    #expect(error.reason == .version)
  }

  @Test func resetStartsOver() async throws {
    let todo = try #require(try await gateway.getSnapshot().get().todos.first { $0.id == "todo-library" })
    _ = try await gateway.updateTodoStatus(id: todo.id, status: .done, expectedVersion: todo.version, note: nil).get()
    try gateway.engine.reset()
    let again = try #require(try await gateway.getSnapshot().get().todos.first { $0.id == "todo-library" })
    #expect(again.status == .doing)
  }

  @Test func otherViewersSeeTheirOwnSnapshot() async throws {
    let child = SampleGateway(engine: try SampleEngine(actorId: "member-hana", timeScale: 0.01))
    let snapshot = try await child.getSnapshot().get()
    #expect(snapshot.viewer.role == .child)
    #expect(!snapshot.can(.auditRead))
  }

  @Test func sampleImagesAreMarked() throws {
    #expect(gateway.engine.mediaURL(albumId: "album-sports", itemId: "item-sports-1", variant: "thumbnail") == "fh-sample-image://item-sports-1")
  }

  @Test func formatsMatchTheWeb() async throws {
    // ヒントの文は見本の仕組みの中で Intl を使って作る。JavaScriptCore でも Web と同じ書式になること。
    let data = try await gateway.engine.call("insights", "list", argumentsJSON: "[]")
    let text = String(decoding: data, as: UTF8.self)
    #expect(text.contains("未精算は合計￥3,110"))
    #expect(text.contains("9月30日(水)"))
  }
}
