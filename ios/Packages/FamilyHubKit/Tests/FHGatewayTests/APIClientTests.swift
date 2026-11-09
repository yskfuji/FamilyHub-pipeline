import Foundation
import Testing
@testable import FHGateway
import FHModel

/// 偽のサーバー。試験ごとに別のホスト名を使い、受け取った要求を覚える。
final class StubServer: @unchecked Sendable {
  struct Seen: Sendable { let method: String; let path: String; let headers: [String: String]; let body: Data? }
  typealias Handler = @Sendable (URLRequest, Int) -> (status: Int, body: String, headers: [String: String])

  private static let lock = NSLock()
  nonisolated(unsafe) private static var servers: [String: StubServer] = [:]

  let host: String
  private let handler: Handler
  private var seenRequests: [Seen] = []

  init(_ handler: @escaping Handler) {
    host = "stub-\(UUID().uuidString.lowercased()).example.test"
    self.handler = handler
    Self.lock.withLock { Self.servers[host] = self }
  }

  var baseURL: URL { URL(string: "https://\(host)")! }
  var seen: [Seen] { Self.lock.withLock { seenRequests } }

  func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: configuration)
  }

  static func respond(to request: URLRequest) -> (HTTPURLResponse, Data)? {
    guard let host = request.url?.host, let server = lock.withLock({ servers[host] }) else { return nil }
    var body = request.httpBody
    if body == nil, let stream = request.httpBodyStream {
      stream.open(); defer { stream.close() }
      var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(buffer, count: count) }
      body = data
    }
    let index: Int = lock.withLock {
      server.seenRequests.append(Seen(method: request.httpMethod ?? "GET", path: request.url?.path ?? "", headers: request.allHTTPHeaderFields ?? [:], body: body))
      return server.seenRequests.count - 1
    }
    let reply = server.handler(request, index)
    let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers.merging(["Content-Type": "application/json"]) { a, _ in a })!
    return (response, Data(reply.body.utf8))
  }
}

final class StubProtocol: URLProtocol {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard let (response, data) = StubServer.respond(to: request) else {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost)); return
    }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

private let todo = """
{"id":"todo-1","householdId":"house-1","title":"買い物","status":"done","assigneeMembershipId":"m-1","creatorMembershipId":"m-1","version":2,"visibility":{"audience":"household","creatorMembershipId":"m-1","selectedMembershipIds":[]}}
"""
private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"

struct APIClientTests {
  @Test func sendsCookieFreeHeadersAndTheAppUserAgent() async throws {
    let server = StubServer { request, _ in
      request.url?.path == "/v1/auth/session" ? (200, #"{"stage":"signed-out","idleTimeoutMinutes":30}"#, [:]) : (404, "", [:])
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let session = try await gateway.getSession().get()
    #expect(session.stage == .signedOut)
    let seen = try #require(server.seen.first)
    #expect(seen.headers["User-Agent"] == agent)
    #expect(seen.headers["Accept"] == "application/json")
    #expect(seen.headers["Origin"] == nil)
    #expect(seen.headers["X-CSRF-Token"] == nil)
    #expect(seen.headers["Idempotency-Key"] == nil)
  }

  @Test func fetchesTheCsrfTokenOnceAndRetriesAStaleTokenWithTheSameKey() async throws {
    let server = StubServer { request, _ in
      switch request.url?.path {
      case "/v1/auth/csrf": return (200, #"{"token":"token-\#(UUID().uuidString)"}"#, [:])
      case "/v1/todos/todo-1/status":
        // 最初の1回だけ、古い token として断る。
        let attempts = request.value(forHTTPHeaderField: "X-Attempt")
        _ = attempts
        return StubState.shared.once() ? (403, #"{"code":"FORBIDDEN","message":"確認できませんでした。","retryable":true,"reason":"CSRF"}"#, [:]) : (200, todo, [:])
      default: return (404, "", [:])
      }
    }
    StubState.shared.reset()
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let done = try await gateway.updateTodoStatus(id: "todo-1", status: .done, expectedVersion: 1, note: nil).get()
    #expect(done.version == 2)
    let mutations = server.seen.filter { $0.method == "PATCH" }
    #expect(mutations.count == 2)
    #expect(mutations[0].headers["Idempotency-Key"] != nil)
    #expect(mutations[0].headers["Idempotency-Key"] == mutations[1].headers["Idempotency-Key"])
    #expect(mutations[0].headers["X-CSRF-Token"] != mutations[1].headers["X-CSRF-Token"])
    #expect(server.seen.filter { $0.path == "/v1/auth/csrf" }.count == 2)
    let body = try JSONSerialization.jsonObject(with: try #require(mutations[0].body)) as? [String: Any]
    #expect(body?["status"] as? String == "done")
    #expect(body?["expectedVersion"] as? Int == 1)
    #expect(body?["note"] == nil)
  }

  @Test func sendsThePermissionRevisionLearnedFromTheSnapshot() async throws {
    let snapshot = try String(contentsOf: fixtureURL("snapshot.member-aoi"), encoding: .utf8)
    let server = StubServer { request, _ in
      switch request.url?.path {
      case "/v1/auth/csrf": return (200, #"{"token":"t"}"#, [:])
      case "/v1/households/current/snapshot": return (200, snapshot, [:])
      default: return (200, todo, [:])
      }
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let loaded = try await gateway.getSnapshot().get()
    _ = await gateway.updateTodoStatus(id: "todo-1", status: .done, expectedVersion: 1, note: "済み")
    let mutation = try #require(server.seen.last)
    #expect(mutation.headers["If-Permission-Revision"] == String(loaded.viewer.permissionRevision))
    #expect(server.seen.first?.headers["If-Permission-Revision"] == nil)
  }

  @Test func readsServerErrorsAndUnreadableReplies() async throws {
    let server = StubServer { request, _ in
      switch request.url?.path {
      case "/v1/auth/csrf": return (200, #"{"token":"t"}"#, [:])
      case "/v1/auth/password": return (401, #"{"code":"UNAUTHENTICATED","message":"メールアドレスまたはパスワードが違います。","retryable":false}"#, [:])
      case "/v1/auth/session": return (502, "<html>Bad gateway</html>", [:])
      default: return (404, "", [:])
      }
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    let signIn = await gateway.signInWithPassword(email: "aoi@example.test", password: "wrong-password-123")
    #expect(signIn.failure?.code == .unauthenticated)
    #expect(signIn.failure?.message == "メールアドレスまたはパスワードが違います。")
    let session = await gateway.getSession()
    #expect(session.failure == GatewayFailure.response)
  }

  @Test func reportsOfflineWhenTheServerCannotBeReached() async {
    let session = StubServer { _, _ in (200, "", [:]) }.session()
    let gateway = HTTPGateway(baseURL: URL(string: "https://unreachable.example.test")!, userAgent: agent, session: session)
    #expect(await gateway.getSession().failure == GatewayFailure.offline)
  }

  @Test func readsBothSignInOutcomes() async throws {
    let server = StubServer { request, index in
      switch request.url?.path {
      case "/v1/auth/csrf": return (200, #"{"token":"t"}"#, [:])
      case "/v1/auth/password": return index < 3 ? (200, #"{"totpChallengeId":"totp-1"}"#, [:]) : (200, #"{"userId":"user-1"}"#, [:])
      case "/v1/auth/totp/verify": return (200, #"{"userId":"user-1"}"#, [:])
      case "/v1/auth/session": return (204, "", [:])
      default: return (404, "", [:])
      }
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    #expect(try await gateway.signInWithPassword(email: "a@example.test", password: "x").get() == .needsTotp(challengeId: "totp-1"))
    #expect(try await gateway.verifyTotp(challengeId: "totp-1", code: "123456").get().userId == "user-1")
    #expect(try await gateway.signInWithPassword(email: "a@example.test", password: "x").get() == .signedIn(userId: "user-1"))
    #expect((try? await gateway.signOut().get()) != nil)
    // サインインの後は、セッションに結び付いた token を取り直す。
    #expect(server.seen.filter { $0.path == "/v1/auth/csrf" }.count >= 3)
  }

  @Test func refusesPlainHttpExceptOnThisMachine() {
    #expect(APIClient.allows(URL(string: "https://family.example.test")!))
    #expect(APIClient.allows(URL(string: "http://127.0.0.1:8799")!))
    #expect(APIClient.allows(URL(string: "http://localhost:8799")!))
    #expect(!APIClient.allows(URL(string: "http://192.168.0.10:8799")!))
    #expect(!APIClient.allows(URL(string: "http://family.local:4330")!))
  }

  @Test func encodesPathSegmentsLikeEncodeURIComponent() {
    #expect("todo-1".uriComponent == "todo-1")
    #expect("a/b c?".uriComponent == "a%2Fb%20c%3F")
    #expect("森".uriComponent == "%E6%A3%AE")
    #expect("(x)!*'~._-".uriComponent == "(x)!*'~._-")
  }
}

/// 一度だけ true を返す（最初の要求だけを断るため）。
final class StubState: @unchecked Sendable {
  static let shared = StubState()
  private let lock = NSLock()
  private var used = false
  func reset() { lock.withLock { used = false } }
  func once() -> Bool { lock.withLock { defer { used = true }; return !used } }
}

func fixtureURL(_ name: String) -> URL {
  URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("FHModelTests/Fixtures/\(name).json")
}

extension Result {
  var failure: Failure? { if case .failure(let error) = self { error } else { nil } }
}

/// Swift の Gateway の関数が、Web の FamilyHubGateway（src/data/gateway.ts）にあること。
struct GatewayParityTests {
  @Test func everySwiftMethodExistsInTheWebGateway() throws {
    let root = (0..<6).reduce(URL(fileURLWithPath: #filePath)) { url, _ in url.deletingLastPathComponent() }
    let source = try String(contentsOf: root.appendingPathComponent("src/data/gateway.ts"), encoding: .utf8)
    let gatewayBlock = try #require(source.range(of: "export interface FamilyHubGateway {")).upperBound
    // interface の終わりは、行の頭の }。
    func block(from start: String.Index) -> Substring { source[start..<(source.range(of: "\n}", range: start..<source.endIndex)?.lowerBound ?? source.endIndex)] }
    let ports = block(from: gatewayBlock)
    for method in GatewayMethod.allCases {
      let parts = method.rawValue.split(separator: ".").map(String.init)
      let portLine = try #require(ports.split(separator: "\n").first { $0.trimmingCharacters(in: .whitespaces).hasPrefix("\(parts[0]):") }, "\(parts[0])")
      let portType = portLine.split(separator: ":")[1].trimmingCharacters(in: CharacterSet(charactersIn: " ;"))
      let start = try #require(source.range(of: "export interface \(portType) {"), "\(portType)").upperBound
      let body = block(from: start)
      #expect(body.contains("\n  \(parts[1])("), "\(method.rawValue) が \(portType) にない")
    }
  }
}
