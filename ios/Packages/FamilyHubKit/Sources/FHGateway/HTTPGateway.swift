import Foundation
import FHModel

/// サーバーにつなぐ窓口。Web の src/data/httpGateway.ts の関数ごとの写し（経路と本文の形を同じにする）。
public final class HTTPGateway: FamilyHubGateway {
  public let client: APIClient
  public var mode: GatewayMode { .server(client.baseURL) }

  public init(client: APIClient) { self.client = client }

  public convenience init(baseURL: URL, userAgent: String, session: URLSession = .shared) {
    self.init(client: APIClient(baseURL: baseURL, session: session, userAgent: userAgent))
  }

  private func send<Value: Decodable & Sendable>(_ request: APIClient.Request, as: Value.Type = Value.self) async -> GatewayResult<Value> {
    await client.send(request)
  }
  private func json(_ method: APIClient.Method, _ path: String, _ body: [String: JSONValue]) -> APIClient.Request {
    .json(method, path, body)
  }
  /// サインインが済んだら、セッションに結び付いた CSRF の token を捨てる（サーバーはサインインのたびに結び直す）。
  private func afterSessionChange<Value>(_ result: GatewayResult<Value>) async -> GatewayResult<Value> {
    if case .success = result { await client.sessionChanged() }
    return result
  }

  // MARK: auth
  public func getSession() async -> GatewayResult<SessionInfo> { await send(.init(.get, "/v1/auth/session")) }

  public func signInWithPassword(email: String, password: String) async -> GatewayResult<SignInResult> {
    let result: GatewayResult<SignInResult> = await send(json(.post, "/v1/auth/password", ["email": .string(email), "password": .string(password)]))
    if case .success(.signedIn) = result { await client.sessionChanged() }
    return result
  }

  public func verifyTotp(challengeId: Id, code: String) async -> GatewayResult<UserRef> {
    await afterSessionChange(await send(json(.post, "/v1/auth/totp/verify", ["challengeId": .string(challengeId), "code": .string(code)])))
  }

  public func signUp(_ input: SignUpInput) async -> GatewayResult<UserRef> { await send(.json(.post, "/v1/auth/sign-up", input)) }

  public func requestPasswordReset(email: String) async -> GatewayResult<PasswordResetRequested> {
    await send(json(.post, "/v1/auth/password-reset", ["email": .string(email)]))
  }

  public func confirmPasswordReset(_ input: PasswordResetConfirmation) async -> GatewayResult<Empty> {
    await send(.json(.post, "/v1/auth/password-reset/confirm", input))
  }

  public func reauthenticate(password: String) async -> GatewayResult<Empty> {
    await send(json(.post, "/v1/auth/reauthenticate", ["password": .string(password)]))
  }

  public func signOut() async -> GatewayResult<Empty> {
    let result: GatewayResult<Empty> = await send(.init(.delete, "/v1/auth/session", csrf: true))
    await client.sessionChanged()
    await client.clearCookies()
    return result
  }

  // MARK: household
  public func getSnapshot() async -> GatewayResult<HouseholdSnapshot> {
    let result: GatewayResult<HouseholdSnapshot> = await send(.init(.get, "/v1/households/current/snapshot"))
    // 権限の版は、家族の記録で分かったものを変更の要求に付ける（Web の setPermissionRevision）。
    if case .success(let snapshot) = result { await client.setPermissionRevision(snapshot.viewer.permissionRevision) }
    return result
  }

  public func createHousehold(name: String) async -> GatewayResult<HouseholdRef> { await send(json(.post, "/v1/households", ["name": .string(name)])) }
  public func acceptInvite(code: String) async -> GatewayResult<HouseholdRef> { await send(json(.post, "/v1/household-invites/accept", ["code": .string(code)])) }
  public func getPrivacySettings() async -> GatewayResult<PrivacySettings> { await send(.init(.get, "/v1/households/current/privacy")) }
  public func savePrivacySettings(_ settings: PrivacySettings) async -> GatewayResult<PrivacySettings> { await send(.json(.put, "/v1/households/current/privacy", settings)) }

  // MARK: todos
  public func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo> {
    var body: [String: JSONValue] = ["status": .string(status.rawValue), "expectedVersion": .number(Double(expectedVersion))]
    if let note, !note.isEmpty { body["note"] = .string(note) }
    return await send(json(.patch, "/v1/todos/\(id.uriComponent)/status", body))
  }

  // MARK: notifications
  public func listNotifications() async -> GatewayResult<[HouseholdNotification]> { await send(.init(.get, "/v1/notifications")) }
  public func markNotificationRead(id: Id) async -> GatewayResult<HouseholdNotification> { await send(.init(.post, "/v1/notifications/\(id.uriComponent)/read", csrf: true)) }
}
