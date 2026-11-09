import Foundation
import FHModel

/// サーバーとの通信。Web の src/data/httpGateway.ts の send と request と同じ決まりで送る。
/// - 認証は cookie だけ（`__Host-fh_session`）。URLSession の cookie の入れ物に任せる。Bearer のトークンはない。
/// - 変更の要求には CSRF の token（`GET /v1/auth/csrf`）と Idempotency-Key と、分かっていれば If-Permission-Revision を付ける。
/// - token が古くて 403 CSRF になったら、取り直して同じ冪等キーで1回だけ送り直す。
/// - Origin は付けない（サーバーは Origin のない要求を通す。server/http/app.ts）。
/// - 接続できないときは OFFLINE、本文の読めない応答は UPSTREAM_FAILURE。
/// 同じ値はいつも同じバイト列にする（項目の順を揃える）。サーバーは冪等の鍵ごとに本文を照らすので、
/// 送り直しで順が変わると「同じ鍵で別の内容」として断られる。
let stableEncoder: JSONEncoder = {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  return encoder
}()

public actor APIClient {
  public enum Method: String, Sendable { case get = "GET", post = "POST", patch = "PATCH", put = "PUT", delete = "DELETE", head = "HEAD" }

  public struct Request: Sendable {
    public var method: Method
    public var path: String
    public var body: Data?
    public var csrf: Bool
    public var idempotencyKey: String?
    public var headers: [String: String]

    public init(_ method: Method, _ path: String, body: Data? = nil, csrf: Bool = false, idempotencyKey: String? = nil, headers: [String: String] = [:]) {
      self.method = method; self.path = path; self.body = body; self.csrf = csrf; self.idempotencyKey = idempotencyKey; self.headers = headers
    }

    public static func json(_ method: Method, _ path: String, _ value: some Encodable, idempotencyKey: String? = nil) -> Request {
      Request(method, path, body: try? stableEncoder.encode(value), csrf: true, idempotencyKey: idempotencyKey)
    }

    var isMutation: Bool { method != .get && method != .head }
  }

  public let baseURL: URL
  private let session: URLSession
  private let userAgent: String
  private var csrfToken: String?
  private var permissionRevision: Int?

  /// 平文の http は、同じ端末（127.0.0.1・localhost）の試験だけで使う。
  public static func allows(_ url: URL) -> Bool {
    url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""))
  }

  public init(baseURL: URL, session: URLSession = .shared, userAgent: String) {
    precondition(Self.allows(baseURL), "サーバーには https の URL が要ります")
    self.baseURL = baseURL
    self.session = session
    self.userAgent = userAgent
  }

  /// 家族の記録で分かった権限の版。0 以下は「まだない」。
  public func setPermissionRevision(_ revision: Int?) { permissionRevision = revision.flatMap { $0 > 0 ? $0 : nil } }

  /// サインインやサインアウトでセッションが変わったとき。CSRF の token はセッションに結び付くので捨てる。
  public func sessionChanged() { csrfToken = nil; permissionRevision = nil }

  /// cookie を消す（サインアウトの後に、この端末に残さない）。
  public func clearCookies() {
    guard let storage = session.configuration.httpCookieStorage, let cookies = storage.cookies(for: baseURL) else { return }
    for cookie in cookies { storage.deleteCookie(cookie) }
  }

  public func send<Value: Decodable & Sendable>(_ request: Request, as: Value.Type = Value.self) async -> GatewayResult<Value> {
    let key = request.isMutation ? (request.idempotencyKey ?? UUID().uuidString.lowercased()) : nil
    do {
      let first: GatewayResult<Value> = try await attempt(request, idempotencyKey: key, refreshCsrf: false)
      guard case .failure(let error) = first, error.reason == .csrf else { return first }
      // token が古いときは取り直し、同じ冪等キーで一度だけ送り直す。
      return try await attempt(request, idempotencyKey: key, refreshCsrf: true)
    } catch {
      return .failure(GatewayFailure.offline)
    }
  }

  /// 添付のファイルを取る。道は署名つきの相対の道（/v1/attachment-files/…）。同じセッションの cookie を使い、destination に置く。
  public func download(_ path: String, to destination: URL) async -> GatewayResult<URL> {
    guard let target = URL(string: path, relativeTo: baseURL)?.absoluteURL, target.host == baseURL.host, target.scheme == baseURL.scheme else {
      return .failure(AttachmentFiles.unavailable)
    }
    var request = URLRequest(url: target)
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    do {
      let (file, response) = try await session.download(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(status) else {
        try? FileManager.default.removeItem(at: file)
        return .failure(AttachmentFiles.unavailable)
      }
      try AttachmentFiles.place(file, at: destination)
      return .success(destination)
    } catch {
      return .failure(GatewayFailure.offline)
    }
  }

  private func token(refresh: Bool) async throws -> String? {
    if let csrfToken, !refresh { return csrfToken }
    var request = URLRequest(url: url("/v1/auth/csrf"))
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    let (data, _) = try await session.data(for: request)
    struct Token: Decodable { let token: String }
    csrfToken = (try? JSONDecoder().decode(Token.self, from: data))?.token
    return csrfToken
  }

  private func url(_ path: String) -> URL { URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL }

  private func attempt<Value: Decodable & Sendable>(_ request: Request, idempotencyKey: String?, refreshCsrf: Bool) async throws -> GatewayResult<Value> {
    var urlRequest = URLRequest(url: url(request.path))
    urlRequest.httpMethod = request.method.rawValue
    urlRequest.httpBody = request.body
    urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
    urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    if request.body != nil { urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    if request.csrf, let token = try await token(refresh: refreshCsrf) { urlRequest.setValue(token, forHTTPHeaderField: "X-CSRF-Token") }
    if let idempotencyKey { urlRequest.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
    if request.isMutation, let permissionRevision { urlRequest.setValue(String(permissionRevision), forHTTPHeaderField: "If-Permission-Revision") }
    for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }

    let (data, response) = try await session.data(for: urlRequest)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    let ok = (200..<300).contains(status)
    if status == 204 || data.isEmpty {
      guard ok else { return .failure(GatewayFailure.response) }
      if let empty = Empty() as? Value { return .success(empty) }
      return .failure(GatewayFailure.response)
    }
    let decoder = JSONDecoder()
    if ok {
      // 本文のない成功（Result<void>）でも、サーバーが JSON を返すことがある。
      if let empty = Empty() as? Value { return .success(empty) }
      guard let value = try? decoder.decode(Value.self, from: data) else { return .failure(GatewayFailure.response) }
      return .success(value)
    }
    // 中継の機器が返す本文の読めない失敗などは、UPSTREAM_FAILURE にする（オフラインの扱いにしない）。
    guard let error = try? decoder.decode(GatewayError.self, from: data) else { return .failure(GatewayFailure.response) }
    return .failure(error)
  }
}

extension String {
  /// JS の encodeURIComponent。
  public var uriComponent: String {
    var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
    allowed.insert(charactersIn: "-_.!~*'()")
    return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
  }
}
