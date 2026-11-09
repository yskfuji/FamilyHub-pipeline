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

  // MARK: events
  /// 変更の要求に付ける見出し（Web の mutationHeaders）。権限の版は、画面が持つ家族の記録の版を優先する。
  private func mutation(_ request: APIClient.Request, _ context: MutationContext?) -> APIClient.Request {
    var request = request
    if let context {
      request.idempotencyKey = context.idempotencyKey
      request.headers["If-Permission-Revision"] = String(context.expectedPermissionRevision)
    }
    return request
  }

  public func createEvent(_ input: EventInput, context: MutationContext?) async -> GatewayResult<CalendarEvent> {
    await send(mutation(.json(.post, "/v1/events", input), context))
  }

  public func updateEvent(id: Id, scope: RecurrenceScope, input: EventUpdateInput, expectedVersion: Int, context: MutationContext?, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent> {
    await send(mutation(.json(.patch, "/v1/events/\(id.uriComponent)", EventUpdateBody(scope: scope, input: input, expectedVersion: expectedVersion, occurrenceDate: occurrenceDate)), context))
  }

  public func deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: Int, occurrenceDate: IsoDate?) async -> GatewayResult<Empty> {
    var query = "scope=\(scope.rawValue.formComponent)&expectedVersion=\(expectedVersion)"
    if let occurrenceDate { query += "&occurrenceDate=\(occurrenceDate.formComponent)" }
    return await send(.init(.delete, "/v1/events/\(id.uriComponent)?\(query)", csrf: true))
  }

  public func restoreEvent(id: Id, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent> {
    await send(.init(.post, "/v1/events/\(id.uriComponent)/restore\(occurrenceDate.map { "?occurrenceDate=\($0)" } ?? "")", csrf: true))
  }

  // MARK: todos
  public func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo> {
    var body: [String: JSONValue] = ["status": .string(status.rawValue), "expectedVersion": .number(Double(expectedVersion))]
    if let note, !note.isEmpty { body["note"] = .string(note) }
    return await send(json(.patch, "/v1/todos/\(id.uriComponent)/status", body))
  }

  // MARK: assistant
  public func getAssistantStatus() async -> GatewayResult<AssistantStatus> { await send(.init(.get, "/v1/assistant/status")) }

  public func readEventImage(_ file: UploadFile) async -> GatewayResult<AssistantJob> {
    let form = MultipartForm(file: file)
    return await send(.init(.post, "/v1/assistant/event-image", body: form.body, csrf: true, headers: ["Content-Type": form.contentType]))
  }

  public func readEventUrl(_ url: String) async -> GatewayResult<AssistantJob> {
    await send(json(.post, "/v1/assistant/event-url", ["url": .string(url)]))
  }

  public func getAssistantJob(id: Id) async -> GatewayResult<AssistantJob> { await send(.init(.get, "/v1/assistant/jobs/\(id.uriComponent)")) }

  // MARK: notifications
  public func listNotifications() async -> GatewayResult<[HouseholdNotification]> { await send(.init(.get, "/v1/notifications")) }
  public func markNotificationRead(id: Id) async -> GatewayResult<HouseholdNotification> { await send(.init(.post, "/v1/notifications/\(id.uriComponent)/read", csrf: true)) }
}

/// 予定の変更の本文（Web と同じ順と形）。
struct EventUpdateBody: Encodable, Sendable {
  var scope: RecurrenceScope
  var input: EventUpdateInput
  var expectedVersion: Int
  var occurrenceDate: IsoDate?
}

/// file の欄を1つ持つ multipart/form-data（Web の FormData と同じ形）。
struct MultipartForm {
  let boundary = "FamilyHub-\(UUID().uuidString)"
  let file: UploadFile

  var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  var body: Data {
    // 名前に引用符や改行があっても壊れないように、Web（WHATWG）と同じく %22・%0D・%0A に置き換える。
    let name = file.name.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: "%0D").replacingOccurrences(of: "\n", with: "%0A")
    var data = Data()
    data.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(file.type.isEmpty ? "application/octet-stream" : file.type)\r\n\r\n".utf8))
    data.append(file.data)
    data.append(Data("\r\n--\(boundary)--\r\n".utf8))
    return data
  }
}

extension String {
  /// URLSearchParams の値の書き方（空白は +）。
  var formComponent: String {
    var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
    allowed.insert(charactersIn: "*-._ ")
    return (addingPercentEncoding(withAllowedCharacters: allowed) ?? self).replacingOccurrences(of: " ", with: "+")
  }
}
