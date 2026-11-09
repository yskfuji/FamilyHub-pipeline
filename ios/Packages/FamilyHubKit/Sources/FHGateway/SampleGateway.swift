import Foundation
import FHModel

/// 見本のモード。サーバーなしで、アプリに入れた見本の家族（森さんち）を動かす。変更は記憶の中だけに残る。
public final class SampleGateway: FamilyHubGateway {
  public let engine: SampleEngine
  public var mode: GatewayMode { .sample }

  public init(engine: SampleEngine) { self.engine = engine }
  public convenience init(actorId: Id = "member-aoi") throws { self.init(engine: try SampleEngine(actorId: actorId)) }

  /// 見本をはじめの状態に戻す。
  public func reset(actorId: Id = "member-aoi") throws { try engine.reset(actorId: actorId) }

  /// port.method を呼ぶ。見本の仕組みが壊れていたときは UPSTREAM_FAILURE にする（画面は失敗として扱える）。
  func invoke<Value: Decodable & Sendable>(_ method: GatewayMethod, _ arguments: (any Encodable & Sendable)?..., as type: Value.Type = Value.self) async -> GatewayResult<Value> {
    let parts = method.rawValue.split(separator: ".", maxSplits: 1).map(String.init)
    do {
      let json = String(decoding: try JSONEncoder().encode(GatewayArgument.list(arguments)), as: UTF8.self)
      let data = try await engine.call(parts[0], parts[1], argumentsJSON: json)
      return try JSONDecoder().decode(WireResult<Value>.self, from: data).result
    } catch {
      return .failure(GatewayError(code: .upstreamFailure, message: "見本のデータを読み込めませんでした。アプリを開き直してください。", retryable: true))
    }
  }

  public func getSession() async -> GatewayResult<SessionInfo> { await invoke(.getSession) }
  public func signInWithPassword(email: String, password: String) async -> GatewayResult<SignInResult> { await invoke(.signInWithPassword, email, password) }
  public func verifyTotp(challengeId: Id, code: String) async -> GatewayResult<UserRef> { await invoke(.verifyTotp, challengeId, code) }
  public func signUp(_ input: SignUpInput) async -> GatewayResult<UserRef> { await invoke(.signUp, input) }
  public func requestPasswordReset(email: String) async -> GatewayResult<PasswordResetRequested> { await invoke(.requestPasswordReset, email) }
  public func confirmPasswordReset(_ input: PasswordResetConfirmation) async -> GatewayResult<Empty> { await invoke(.confirmPasswordReset, input) }
  public func reauthenticate(password: String) async -> GatewayResult<Empty> { await invoke(.reauthenticate, password) }
  public func signOut() async -> GatewayResult<Empty> { await invoke(.signOut) }

  public func getSnapshot() async -> GatewayResult<HouseholdSnapshot> { await invoke(.getSnapshot) }
  public func createHousehold(name: String) async -> GatewayResult<HouseholdRef> { await invoke(.createHousehold, name) }
  public func acceptInvite(code: String) async -> GatewayResult<HouseholdRef> { await invoke(.acceptInvite, code) }
  public func getPrivacySettings() async -> GatewayResult<PrivacySettings> { await invoke(.getPrivacySettings) }
  public func savePrivacySettings(_ settings: PrivacySettings) async -> GatewayResult<PrivacySettings> { await invoke(.savePrivacySettings, settings) }

  public func createEvent(_ input: EventInput, context: MutationContext?) async -> GatewayResult<CalendarEvent> { await invoke(.createEvent, input, context) }
  public func updateEvent(id: Id, scope: RecurrenceScope, input: EventUpdateInput, expectedVersion: Int, context: MutationContext?, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent> {
    await invoke(.updateEvent, id, scope, input, expectedVersion, context, occurrenceDate)
  }
  public func deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: Int, occurrenceDate: IsoDate?) async -> GatewayResult<Empty> {
    await invoke(.deleteEvent, id, scope, expectedVersion, occurrenceDate)
  }
  public func restoreEvent(id: Id, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent> { await invoke(.restoreEvent, id, occurrenceDate) }

  public func getAssistantStatus() async -> GatewayResult<AssistantStatus> { await invoke(.getAssistantStatus) }
  public func readEventImage(_ file: UploadFile) async -> GatewayResult<AssistantJob> { await invoke(.readEventImage, SampleFile(file)) }
  public func readEventUrl(_ url: String) async -> GatewayResult<AssistantJob> { await invoke(.readEventUrl, url) }
  public func getAssistantJob(id: Id) async -> GatewayResult<AssistantJob> { await invoke(.getAssistantJob, id) }

  public func createTodo(_ input: TodoInput, context: MutationContext?) async -> GatewayResult<Todo> { await invoke(.createTodo, input, context) }
  public func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo> {
    await invoke(.updateTodoStatus, id, status, expectedVersion, note)
  }
  public func updateTodo(id: Id, scope: RecurrenceScope, input: TodoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Todo> {
    await invoke(.updateTodo, id, scope, input, expectedVersion, context)
  }
  public func deleteTodo(id: Id, expectedVersion: Int, scope: RecurrenceScope) async -> GatewayResult<Empty> { await invoke(.deleteTodo, id, expectedVersion, scope) }
  public func restoreTodo(id: Id) async -> GatewayResult<Todo> { await invoke(.restoreTodo, id) }

  public func createMemo(_ input: MemoInput, context: MutationContext?) async -> GatewayResult<Memo> { await invoke(.createMemo, input, context) }
  public func updateMemo(id: Id, input: MemoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Memo> {
    await invoke(.updateMemo, id, input, expectedVersion, context)
  }
  /// 見本は中身を見ないので、種類は送る側（端末）で正しく付ける。
  public func uploadAttachment(memoId: Id, file: UploadFile, idempotencyKey: String) async -> GatewayResult<Memo> {
    await invoke(.uploadAttachment, memoId, SampleFile(file), idempotencyKey)
  }
  public func getAttachmentLink(memoId: Id, attachmentId: Id, disposition: AttachmentDisposition) async -> GatewayResult<AttachmentLink> {
    await invoke(.getAttachmentLink, memoId, attachmentId, disposition.rawValue)
  }
  public func deleteAttachment(memoId: Id, attachmentId: Id) async -> GatewayResult<Empty> { await invoke(.deleteAttachment, memoId, attachmentId) }
  public func deleteMemo(id: Id) async -> GatewayResult<Empty> { await invoke(.deleteMemo, id) }
  public func restoreMemo(id: Id) async -> GatewayResult<Memo> { await invoke(.restoreMemo, id) }

  /// 見本の添付（fh-sample://<名前>）は、アプリに入れたファイルを写す。
  public func downloadAttachment(_ link: AttachmentLink, fileName: String) async -> GatewayResult<URL> {
    guard let source = Self.sampleFile(link.url) else { return .failure(AttachmentFiles.unavailable) }
    let destination = AttachmentFiles.destination(for: fileName)
    do {
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      try FileManager.default.copyItem(at: source, to: copy)
      try AttachmentFiles.place(copy, at: destination)
      return .success(destination)
    } catch {
      return .failure(AttachmentFiles.unavailable)
    }
  }

  /// fh-sample://sample-notice.pdf を、パッケージの samples/sample-notice.pdf にする。ほかの形は読まない。
  public static func sampleFile(_ url: String) -> URL? {
    let prefix = "fh-sample://"
    guard url.hasPrefix(prefix) else { return nil }
    let name = String(url.dropFirst(prefix.count))
    guard !name.isEmpty, !name.contains("/"), !name.contains(".."), let dot = name.lastIndex(of: ".") else { return nil }
    return Bundle.module.url(forResource: String(name[..<dot]), withExtension: String(name[name.index(after: dot)...]), subdirectory: "samples")
  }

  public func listNotifications() async -> GatewayResult<[HouseholdNotification]> { await invoke(.listNotifications) }
  public func markNotificationRead(id: Id) async -> GatewayResult<HouseholdNotification> { await invoke(.markNotificationRead, id) }
}

/// 見本の仕組みに渡すファイル（{"__file": {name, type, size, head, ref}}）。中身は先頭の数バイトだけを渡す。
struct SampleFile: Encodable, Sendable {
  struct Body: Encodable, Sendable { var name: String; var type: String; var size: Int; var head: String; var ref: String }
  var __file: Body
  init(_ file: UploadFile) {
    __file = Body(name: file.name, type: file.type, size: file.size, head: file.data.prefix(64).base64EncodedString(), ref: UUID().uuidString)
  }
}
