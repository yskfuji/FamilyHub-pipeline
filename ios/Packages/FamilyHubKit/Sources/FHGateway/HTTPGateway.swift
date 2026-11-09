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
  public func createTodo(_ input: TodoInput, context: MutationContext?) async -> GatewayResult<Todo> {
    await send(mutation(.json(.post, "/v1/todos", input), context))
  }

  public func updateTodo(id: Id, scope: RecurrenceScope, input: TodoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Todo> {
    await send(mutation(.json(.patch, "/v1/todos/\(id.uriComponent)", ScopedUpdateBody(scope: scope, input: input, expectedVersion: expectedVersion)), context))
  }

  public func deleteTodo(id: Id, expectedVersion: Int, scope: RecurrenceScope) async -> GatewayResult<Empty> {
    await send(.init(.delete, "/v1/todos/\(id.uriComponent)?scope=\(scope.rawValue.formComponent)&expectedVersion=\(expectedVersion)", csrf: true))
  }

  public func restoreTodo(id: Id) async -> GatewayResult<Todo> { await send(.init(.post, "/v1/todos/\(id.uriComponent)/restore", csrf: true)) }

  public func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo> {
    var body: [String: JSONValue] = ["status": .string(status.rawValue), "expectedVersion": .number(Double(expectedVersion))]
    if let note, !note.isEmpty { body["note"] = .string(note) }
    return await send(json(.patch, "/v1/todos/\(id.uriComponent)/status", body))
  }

  // MARK: memos
  public func createMemo(_ input: MemoInput, context: MutationContext?) async -> GatewayResult<Memo> {
    await send(mutation(.json(.post, "/v1/memos", input), context))
  }

  public func updateMemo(id: Id, input: MemoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Memo> {
    await send(mutation(.json(.patch, "/v1/memos/\(id.uriComponent)", MemoUpdateBody(input: input, expectedVersion: expectedVersion)), context))
  }

  public func uploadAttachment(memoId: Id, file: UploadFile, idempotencyKey: String) async -> GatewayResult<Memo> {
    let form = MultipartForm(file: file)
    return await send(.init(.post, "/v1/memos/\(memoId.uriComponent)/attachments", body: form.body, csrf: true, idempotencyKey: idempotencyKey, headers: ["Content-Type": form.contentType]))
  }

  public func getAttachmentLink(memoId: Id, attachmentId: Id, disposition: AttachmentDisposition) async -> GatewayResult<AttachmentLink> {
    await send(.init(.get, "/v1/memos/\(memoId.uriComponent)/attachments/\(attachmentId.uriComponent)/link\(disposition == .attachment ? "?download=1" : "")"))
  }

  public func deleteAttachment(memoId: Id, attachmentId: Id) async -> GatewayResult<Empty> {
    await send(.init(.delete, "/v1/memos/\(memoId.uriComponent)/attachments/\(attachmentId.uriComponent)", csrf: true))
  }

  public func deleteMemo(id: Id) async -> GatewayResult<Empty> { await send(.init(.delete, "/v1/memos/\(id.uriComponent)", csrf: true)) }
  public func restoreMemo(id: Id) async -> GatewayResult<Memo> { await send(.init(.post, "/v1/memos/\(id.uriComponent)/restore", csrf: true)) }

  /// 署名つきの相対の道を、同じセッション（cookie）で取る。
  public func downloadAttachment(_ link: AttachmentLink, fileName: String) async -> GatewayResult<URL> {
    await client.download(link.url, to: AttachmentFiles.destination(for: fileName))
  }

  // MARK: expenses
  public func createExpense(_ input: ExpenseInput, idempotencyKey: String) async -> GatewayResult<Expense> {
    await send(.json(.post, "/v1/expenses", input, idempotencyKey: idempotencyKey))
  }

  public func updateExpense(id: Id, input: ExpenseUpdateInput, expectedVersion: Int) async -> GatewayResult<Expense> {
    await send(.json(.patch, "/v1/expenses/\(id.uriComponent)", ExpenseUpdateBody(input: input, expectedVersion: expectedVersion)))
  }

  public func deleteExpense(id: Id, expectedVersion: Int) async -> GatewayResult<Empty> {
    await send(.init(.delete, "/v1/expenses/\(id.uriComponent)?expectedVersion=\(expectedVersion)", csrf: true))
  }

  public func restoreExpense(id: Id) async -> GatewayResult<Expense> { await send(.init(.post, "/v1/expenses/\(id.uriComponent)/restore", csrf: true)) }

  public func recordSettlement(expenseId: Id, fromMembershipId: Id, amountJpy: Int) async -> GatewayResult<Expense> {
    await send(json(.post, "/v1/expenses/\(expenseId.uriComponent)/settlements", ["fromMembershipId": .string(fromMembershipId), "amountJpy": .number(Double(amountJpy))]))
  }

  public func reverseSettlement(expenseId: Id, settlementId: Id) async -> GatewayResult<Expense> {
    await send(.init(.post, "/v1/expenses/\(expenseId.uriComponent)/settlements/\(settlementId.uriComponent)/reverse", csrf: true))
  }

  public func settleAll(_ input: SettleAllInput, idempotencyKey: String) async -> GatewayResult<SettlementBatch> {
    await send(.json(.post, "/v1/settlement-batches", input, idempotencyKey: idempotencyKey))
  }

  public func reverseBatch(id: Id, idempotencyKey: String) async -> GatewayResult<SettlementBatch> {
    await send(.init(.post, "/v1/settlement-batches/\(id.uriComponent)/reverse", csrf: true, idempotencyKey: idempotencyKey))
  }

  // MARK: albums
  public func listAlbums() async -> GatewayResult<[AlbumSummary]> { await send(.init(.get, "/v1/albums")) }
  public func getAlbum(id: Id) async -> GatewayResult<AlbumDetail> { await send(.init(.get, "/v1/albums/\(id.uriComponent)")) }
  public func createAlbum(_ input: AlbumInput, idempotencyKey: String) async -> GatewayResult<Album> { await send(.json(.post, "/v1/albums", input, idempotencyKey: idempotencyKey)) }
  public func updateAlbum(id: Id, input: AlbumUpdateInput, expectedVersion: Int) async -> GatewayResult<Album> {
    await send(.json(.patch, "/v1/albums/\(id.uriComponent)", AlbumUpdateBody(input: input, expectedVersion: expectedVersion)))
  }
  public func deleteAlbum(id: Id, expectedVersion: Int) async -> GatewayResult<Empty> {
    await send(.init(.delete, "/v1/albums/\(id.uriComponent)?expectedVersion=\(expectedVersion)", csrf: true))
  }
  public func restoreAlbum(id: Id) async -> GatewayResult<Album> { await send(.init(.post, "/v1/albums/\(id.uriComponent)/restore", csrf: true)) }
  public func reorderItems(albumId: Id, itemIds: [Id], expectedVersion: Int) async -> GatewayResult<Album> {
    await send(.json(.put, "/v1/albums/\(albumId.uriComponent)/order", ReorderBody(itemIds: itemIds, expectedVersion: expectedVersion)))
  }
  public func deleteItem(albumId: Id, itemId: Id) async -> GatewayResult<Empty> {
    await send(.init(.delete, "/v1/albums/\(albumId.uriComponent)/items/\(itemId.uriComponent)", csrf: true))
  }
  public func restoreItem(albumId: Id, itemId: Id) async -> GatewayResult<AlbumItem> {
    await send(.init(.post, "/v1/albums/\(albumId.uriComponent)/items/\(itemId.uriComponent)/restore", csrf: true))
  }

  static let chunkBytes = 8 * 1024 * 1024
  static let uploadRetries = 6
  private static let tus = ["Tus-Resumable": "1.0.0"]

  /// 受け取られた位置。枠がなくなっていれば nil。
  private func receivedOffset(_ uploadId: Id) async throws -> Int? {
    let response = try await client.exchange(.head, "/v1/uploads/\(uploadId.uriComponent)", headers: Self.tus)
    return (200..<300).contains(response.status) ? Int(response.headers["upload-offset"] ?? "0") ?? 0 : nil
  }

  /// Web の uploadItem と同じ手順: 枠を作り（または続きを確かめ）、8MiB ずつ PATCH で送り、最後に動画の縮小画像を PUT する。
  public func uploadItem(albumId: Id, source: UploadSource, keepLocation: Bool, thumbnail: Data?, ticket: UploadTicket, progress: @escaping UploadProgress) async -> GatewayResult<Id> {
    var offset = 0
    var uploadId: Id?
    var itemId: Id?
    if await ticket.albumId == albumId, let open = await ticket.uploadId {
      if let received = try? await receivedOffset(open) { uploadId = open; itemId = await ticket.itemId; offset = received } else { await ticket.close() }
    }
    if uploadId == nil {
      let body = CreateUploadBody(albumId: albumId, name: source.name, mimeType: source.type, byteSize: source.size, keepLocation: keepLocation)
      let created: GatewayResult<UploadSlot> = await send(.json(.post, "/v1/uploads", body))
      guard case .success(let slot) = created else { if case .failure(let error) = created { return .failure(error) }; return .failure(GatewayFailure.response) }
      await ticket.open(albumId: albumId, uploadId: slot.uploadId, itemId: slot.itemId)
      uploadId = slot.uploadId; itemId = slot.itemId; offset = slot.offset
    }
    guard let uploadId, let itemId else { return .failure(GatewayFailure.response) }
    var retries = 0
    while offset < source.size {
      if Task.isCancelled { _ = await cancelUpload(ticket: ticket); return .failure(GatewayError(code: .offline, message: "送信を止めました。", retryable: true)) }
      do {
        let chunk = try source.chunk(at: offset, length: Self.chunkBytes)
        let response = try await client.exchange(.patch, "/v1/uploads/\(uploadId.uriComponent)", body: chunk,
                                                  headers: Self.tus.merging(["Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset)]) { $1 })
        if response.status == 204 {
          offset = Int(response.headers["upload-offset"] ?? "") ?? offset + chunk.count
          retries = 0
          progress(offset, source.size)
          continue
        }
        if response.status != 409 {
          let error = (try? JSONDecoder().decode(GatewayError.self, from: response.data)) ?? GatewayFailure.response
          if !error.retryable { _ = await cancelUpload(ticket: ticket) }
          return .failure(error)
        }
        offset = (try? await receivedOffset(uploadId)) ?? nil ?? offset
      } catch {
        // 通信が切れたら、受け取られた位置を確かめて続きから送る。
        retries += 1
        if retries > Self.uploadRetries { return .failure(GatewayFailure.offline) }
        try? await Task.sleep(for: .milliseconds(500 * (1 << retries)))
        if let received = try? await receivedOffset(uploadId) { offset = received }
      }
    }
    await ticket.close()
    if let thumbnail {
      _ = try? await client.exchange(.put, "/v1/albums/\(albumId.uriComponent)/items/\(itemId.uriComponent)/thumbnail", body: thumbnail, headers: ["Content-Type": "application/octet-stream"])
    }
    return .success(itemId)
  }

  public func cancelUpload(ticket: UploadTicket) async -> GatewayResult<Empty> {
    if let uploadId = await ticket.uploadId { _ = try? await client.exchange(.delete, "/v1/uploads/\(uploadId.uriComponent)", headers: Self.tus) }
    await ticket.close()
    return .success(Empty())
  }

  public func mediaSource(albumId: Id, itemId: Id, variant: MediaVariant) -> MediaSource {
    .server(path: "/v1/albums/\(albumId.uriComponent)/items/\(itemId.uriComponent)/\(variant.rawValue)")
  }

  public func downloadMedia(_ source: MediaSource, fileName: String) async -> GatewayResult<URL> {
    guard case .server(let path) = source else { return .failure(AttachmentFiles.unavailable) }
    return await client.download(path, to: AttachmentFiles.destination(for: fileName))
  }

  // MARK: assistant
  public func readReceipt(_ file: UploadFile) async -> GatewayResult<AssistantJob> {
    let form = MultipartForm(file: file)
    return await send(.init(.post, "/v1/assistant/receipt", body: form.body, csrf: true, headers: ["Content-Type": form.contentType]))
  }

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

/// タスクの変更の本文（Web と同じ順と形）。
struct ScopedUpdateBody<Input: Encodable & Sendable>: Encodable, Sendable {
  var scope: RecurrenceScope
  var input: Input
  var expectedVersion: Int
}

/// アルバムの変更の本文。
struct AlbumUpdateBody: Encodable, Sendable {
  var input: AlbumUpdateInput
  var expectedVersion: Int
}

struct ReorderBody: Encodable, Sendable {
  var itemIds: [Id]
  var expectedVersion: Int
}

struct CreateUploadBody: Encodable, Sendable {
  var albumId: Id
  var name: String
  var mimeType: String
  var byteSize: Int
  var keepLocation: Bool
}

/// 支出の変更の本文。
struct ExpenseUpdateBody: Encodable, Sendable {
  var input: ExpenseUpdateInput
  var expectedVersion: Int
}

/// メモの変更の本文。メモには繰り返しがないので scope はない。
struct MemoUpdateBody: Encodable, Sendable {
  var input: MemoUpdateInput
  var expectedVersion: Int
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
