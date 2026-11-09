import Foundation
import Testing
@testable import FHGateway
import FHModel

private let albumJSON = """
{"id":"album-1","householdId":"house-1","title":"運動会","creatorMembershipId":"m-1","visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]},"createdAt":"2026-09-20T10:00:00+09:00","version":2}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

/// 分けて送る送信を真似るサーバー。受け取った位置を覚え、1回目の PATCH だけ通信を切る。
final class UploadServer: @unchecked Sendable {
  private let lock = NSLock()
  var received = 0
  var failOnce = false
  var patches: [Int] = []
  var thumbnail: Data?

  func handle(_ request: URLRequest) -> (status: Int, body: String, headers: [String: String]) {
    let path = request.url?.path ?? ""
    return lock.withLock {
      switch (request.httpMethod, path) {
      case (_, "/v1/auth/csrf"): return (200, #"{"token":"t"}"#, [:])
      case ("POST", "/v1/uploads"): return (201, #"{"uploadId":"up-1","itemId":"item-9","offset":0}"#, [:])
      case ("HEAD", "/v1/uploads/up-1"): return (200, "", ["Upload-Offset": String(received)])
      case ("PATCH", "/v1/uploads/up-1"):
        let offset = Int(request.value(forHTTPHeaderField: "Upload-Offset") ?? "-1") ?? -1
        patches.append(offset)
        if offset != received { return (409, "", [:]) }
        received += 8 * 1024 * 1024
        if failOnce { failOnce = false; return (500, #"{"code":"UPSTREAM_FAILURE","message":"x","retryable":true}"#, [:]) }
        return (204, "", ["Upload-Offset": String(received)])
      case ("PUT", "/v1/albums/album-1/items/item-9/thumbnail"): return (204, "", [:])
      case ("DELETE", "/v1/uploads/up-1"): return (204, "", [:])
      case (_, let other) where other.hasPrefix("/v1/albums"): return request.httpMethod == "DELETE" ? (204, "", [:]) : (200, albumJSON, [:])
      default: return (404, "", [:])
      }
    }
  }
}

struct AlbumRouteTests {
  func json(_ data: Data?) throws -> [String: JSONValue] {
    guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: try #require(data)) else { throw CancellationError() }
    return object
  }

  @Test func albumRoutes() async throws {
    let server = StubServer { request, _ in
      let path = request.url?.path ?? ""
      if path == "/v1/auth/csrf" { return (200, #"{"token":"t"}"#, [:]) }
      return request.httpMethod == "DELETE" ? (204, "", [:]) : (200, albumJSON, [:])
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    _ = try await gateway.createAlbum(AlbumInput(title: "運動会", bgmPreset: .bright), idempotencyKey: "k").get()
    #expect(server.seen.last?.path == "/v1/albums" && server.seen.last?.headers["Idempotency-Key"] == "k")
    var change = AlbumUpdateInput()
    change.coverItemId = .set("item-2")
    change.description = .clear
    _ = try await gateway.updateAlbum(id: "album-1", input: change, expectedVersion: 2).get()
    #expect(try json(server.seen.last?.body) == ["input": .object(["coverItemId": .string("item-2"), "description": .null]), "expectedVersion": .number(2)])
    _ = try await gateway.reorderItems(albumId: "album-1", itemIds: ["b", "a"], expectedVersion: 2).get()
    #expect(server.seen.last?.method == "PUT" && server.seen.last?.path == "/v1/albums/album-1/order")
    _ = try await gateway.deleteAlbum(id: "album-1", expectedVersion: 2).get()
    #expect(server.seenURLs.last?.query == "expectedVersion=2")
    _ = try await gateway.deleteItem(albumId: "album-1", itemId: "i 1").get()
    #expect(server.seen.last?.path == "/v1/albums/album-1/items/i 1")
    #expect(gateway.mediaSource(albumId: "album-1", itemId: "i 1", variant: .thumbnail) == .server(path: "/v1/albums/album-1/items/i%201/thumbnail"))
  }

  @Test func uploadResumesFromTheReceivedOffset() async throws {
    let upload = UploadServer()
    let server = StubServer { request, _ in upload.handle(request) }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mov")
    try Data(count: 20 * 1024 * 1024).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let source = UploadSource(name: "clip.mov", type: "video/quicktime", size: 20 * 1024 * 1024, url: file)
    let ticket = UploadTicket()
    upload.failOnce = true
    // 1回目は 8MiB を受け取ったところで失敗する。
    guard case .failure = await gateway.uploadItem(albumId: "album-1", source: source, keepLocation: false, thumbnail: nil, ticket: ticket, progress: { _, _ in }) else { Issue.record("失敗するはず"); return }
    #expect(await ticket.uploadId == "up-1")
    // 2回目は HEAD で受け取られた位置を確かめ、続きから送る（枠は作り直さない）。
    let itemId = try await gateway.uploadItem(albumId: "album-1", source: source, keepLocation: false, thumbnail: Data([0xFF, 0xD8]), ticket: ticket, progress: { _, _ in }).get()
    #expect(itemId == "item-9")
    #expect(upload.patches == [0, 8 * 1024 * 1024, 16 * 1024 * 1024])
    #expect(server.seen.filter { $0.method == "POST" && $0.path == "/v1/uploads" }.count == 1)
    #expect(server.seen.contains { $0.method == "PUT" && $0.path.hasSuffix("/thumbnail") })
    #expect(server.seen.filter { $0.path.hasPrefix("/v1/uploads") }.allSatisfy { $0.headers["Tus-Resumable"] == "1.0.0" || $0.method == "POST" })
    #expect(await ticket.uploadId == nil)
  }
}

struct SampleAlbumTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  @Test func albumLifecycle() async throws {
    let albums = try await gateway.listAlbums().get()
    #expect(albums.contains { $0.id == "album-sports" })
    let created = try await gateway.createAlbum(AlbumInput(title: "旅行", visibility: VisibilityInput(audience: .household, selectedMembershipIds: [])), idempotencyKey: "k").get()
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")
    try Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let itemId = try await gateway.uploadItem(albumId: created.id, source: UploadSource(name: "a.jpg", type: "image/jpeg", size: 7, url: file), keepLocation: false, thumbnail: nil, ticket: UploadTicket(), progress: { _, _ in }).get()
    let detail = try await gateway.getAlbum(id: created.id).get()
    #expect(detail.items.first { $0.id == itemId }?.status == .ready)
    // 送った写真は、この端末の写しから見せる。
    guard case .local(let local) = gateway.mediaSource(albumId: created.id, itemId: itemId, variant: .file) else { Issue.record("端末の写しのはず"); return }
    #expect(try Data(contentsOf: local).count == 7)
    #expect(gateway.mediaSource(albumId: "album-sports", itemId: "item-sports-1", variant: .thumbnail) == .sampleArt(id: "item-sports-1"))
    let reordered = try await gateway.reorderItems(albumId: "album-sports", itemIds: ["item-sports-3", "item-sports-1", "item-sports-2"], expectedVersion: 1).get()
    #expect(reordered.version == 2)
    _ = try await gateway.deleteItem(albumId: "album-sports", itemId: "item-sports-2").get()
    _ = try await gateway.restoreItem(albumId: "album-sports", itemId: "item-sports-2").get()
    let album = try await gateway.getAlbum(id: created.id).get().album
    _ = try await gateway.deleteAlbum(id: created.id, expectedVersion: album.version).get()
    _ = try await gateway.restoreAlbum(id: created.id).get()
  }
}
