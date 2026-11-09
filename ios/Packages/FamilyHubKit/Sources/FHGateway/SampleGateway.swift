import Foundation
import FHModel

/// 見本のモード。サーバーなしで、アプリに入れた見本の家族（森さんち）を動かす。変更は記憶の中だけに残る。
public final class SampleGateway: FamilyHubGateway {
  public let engine: SampleEngine
  public var mode: GatewayMode { .sample }

  public init(engine: SampleEngine) { self.engine = engine }

  /// 見本で送ったファイル（fh-file://<ref>）の、この端末の中の場所。
  private let files = SampleFiles()
  public convenience init(actorId: Id = "member-aoi") throws { self.init(engine: try SampleEngine(actorId: actorId)) }

  /// 見本をはじめの状態に戻す。
  public func reset(actorId: Id = "member-aoi") throws { try engine.reset(actorId: actorId) }

  /// port.method を呼ぶ。見本の仕組みが壊れていたときは UPSTREAM_FAILURE にする（画面は失敗として扱える）。
  func invoke<Value: Decodable & Sendable>(_ method: GatewayMethod, _ arguments: (any Encodable & Sendable)?..., as type: Value.Type = Value.self) async -> GatewayResult<Value> {
    let parts = method.rawValue.split(separator: ".", maxSplits: 1).map(String.init)
    do {
      let json = String(decoding: try stableEncoder.encode(GatewayArgument.list(arguments)), as: UTF8.self)
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

  public func createExpense(_ input: ExpenseInput, idempotencyKey: String) async -> GatewayResult<Expense> { await invoke(.createExpense, input, idempotencyKey) }
  public func updateExpense(id: Id, input: ExpenseUpdateInput, expectedVersion: Int) async -> GatewayResult<Expense> { await invoke(.updateExpense, id, input, expectedVersion) }
  public func deleteExpense(id: Id, expectedVersion: Int) async -> GatewayResult<Empty> { await invoke(.deleteExpense, id, expectedVersion) }
  public func restoreExpense(id: Id) async -> GatewayResult<Expense> { await invoke(.restoreExpense, id) }
  public func recordSettlement(expenseId: Id, fromMembershipId: Id, amountJpy: Int) async -> GatewayResult<Expense> { await invoke(.recordSettlement, expenseId, fromMembershipId, amountJpy) }
  public func reverseSettlement(expenseId: Id, settlementId: Id) async -> GatewayResult<Expense> { await invoke(.reverseSettlement, expenseId, settlementId) }
  public func settleAll(_ input: SettleAllInput, idempotencyKey: String) async -> GatewayResult<SettlementBatch> { await invoke(.settleAll, input, idempotencyKey) }
  public func reverseBatch(id: Id, idempotencyKey: String) async -> GatewayResult<SettlementBatch> { await invoke(.reverseBatch, id, idempotencyKey) }
  public func readReceipt(_ file: UploadFile) async -> GatewayResult<AssistantJob> { await invoke(.readReceipt, SampleFile(file)) }

  public func listAlbums() async -> GatewayResult<[AlbumSummary]> { await invoke(.listAlbums) }
  public func getAlbum(id: Id) async -> GatewayResult<AlbumDetail> { await invoke(.getAlbum, id) }
  public func createAlbum(_ input: AlbumInput, idempotencyKey: String) async -> GatewayResult<Album> { await invoke(.createAlbum, input) }
  public func updateAlbum(id: Id, input: AlbumUpdateInput, expectedVersion: Int) async -> GatewayResult<Album> { await invoke(.updateAlbum, id, input, expectedVersion) }
  public func deleteAlbum(id: Id, expectedVersion: Int) async -> GatewayResult<Empty> { await invoke(.deleteAlbum, id, expectedVersion) }
  public func restoreAlbum(id: Id) async -> GatewayResult<Album> { await invoke(.restoreAlbum, id) }
  public func reorderItems(albumId: Id, itemIds: [Id], expectedVersion: Int) async -> GatewayResult<Album> { await invoke(.reorderItems, albumId, itemIds, expectedVersion) }
  public func deleteItem(albumId: Id, itemId: Id) async -> GatewayResult<Empty> { await invoke(.deleteItem, albumId, itemId) }
  public func restoreItem(albumId: Id, itemId: Id) async -> GatewayResult<AlbumItem> { await invoke(.restoreItem, albumId, itemId) }

  struct UploadOptions: Encodable, Sendable { var keepLocation: Bool; var thumbnail: SampleFile? }
  struct UploadedItem: Decodable, Sendable { var itemId: Id }

  /// 見本は一度に受け取る。送ったファイルは記憶の中の見本と一緒に、この端末の一時の場所に残す（アプリを閉じると消える）。
  public func uploadItem(albumId: Id, source: UploadSource, keepLocation: Bool, thumbnail: Data?, ticket: UploadTicket, progress: @escaping UploadProgress) async -> GatewayResult<Id> {
    let ref = UUID().uuidString
    let thumbRef = UUID().uuidString
    let head = (try? source.chunk(at: 0, length: 64)) ?? Data()
    let file = SampleFile(name: source.name, type: source.type, size: source.size, head: head, ref: ref)
    let thumb = thumbnail.map { SampleFile(name: "thumbnail.jpg", type: "image/jpeg", size: $0.count, head: $0.prefix(64), ref: thumbRef) }
    let result: GatewayResult<UploadedItem> = await invoke(.uploadItem, albumId, file, UploadOptions(keepLocation: keepLocation, thumbnail: thumb))
    guard case .success(let uploaded) = result else { if case .failure(let error) = result { return .failure(error) }; return .failure(GatewayFailure.response) }
    await files.keep(ref, copying: source.url)
    if let thumbnail { await files.keep(thumbRef, data: thumbnail) }
    progress(source.size, source.size)
    return .success(uploaded.itemId)
  }

  public func cancelUpload(ticket: UploadTicket) async -> GatewayResult<Empty> { .success(Empty()) }

  public func mediaSource(albumId: Id, itemId: Id, variant: MediaVariant) -> MediaSource {
    let url = engine.mediaURL(albumId: albumId, itemId: itemId, variant: variant.rawValue)
    if url.hasPrefix("fh-file://"), let local = files.url(String(url.dropFirst("fh-file://".count))) { return .local(local) }
    return .sampleArt(id: itemId)
  }

  public func downloadMedia(_ source: MediaSource, fileName: String) async -> GatewayResult<URL> {
    guard case .local(let url) = source else { return .failure(AttachmentFiles.unavailable) }
    let destination = AttachmentFiles.destination(for: fileName)
    do {
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      try FileManager.default.copyItem(at: url, to: copy)
      try AttachmentFiles.place(copy, at: destination)
      return .success(destination)
    } catch { return .failure(AttachmentFiles.unavailable) }
  }

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
  public func snoozeNotification(id: Id, minutes: Int) async -> GatewayResult<HouseholdNotification> { await invoke(.snoozeNotification, id, minutes) }
  public func stopNotification(id: Id) async -> GatewayResult<HouseholdNotification> { await invoke(.stopNotification, id) }
  public func resumeNotification(id: Id) async -> GatewayResult<HouseholdNotification> { await invoke(.resumeNotification, id) }
  public func getNotificationPreferences() async -> GatewayResult<NotificationPreferences> { await invoke(.getNotificationPreferences) }
  public func updateNotificationPreferences(_ input: NotificationPreferences) async -> GatewayResult<NotificationPreferences> { await invoke(.updateNotificationPreferences, input) }
  public func search(_ query: String) async -> GatewayResult<[SearchResult]> { await invoke(.search, query) }
  public func listInsights() async -> GatewayResult<[Insight]> { await invoke(.listInsights) }
}

/// 見本の仕組みに渡すファイル（{"__file": {name, type, size, head, ref}}）。中身は先頭の数バイトだけを渡す。
struct SampleFile: Encodable, Sendable {
  struct Body: Encodable, Sendable { var name: String; var type: String; var size: Int; var head: String; var ref: String }
  var __file: Body
  init(_ file: UploadFile) {
    __file = Body(name: file.name, type: file.type, size: file.size, head: file.data.prefix(64).base64EncodedString(), ref: UUID().uuidString)
  }
  init(name: String, type: String, size: Int, head: Data, ref: String) {
    __file = Body(name: name, type: type, size: size, head: head.prefix(64).base64EncodedString(), ref: ref)
  }
}

/// 見本で送ったファイルの置き場所。ref ごとに、一時の場所の写しを持つ。
final class SampleFiles: @unchecked Sendable {
  private let lock = NSLock()
  private var urls: [String: URL] = [:]
  private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fh-sample-uploads", isDirectory: true)

  func url(_ ref: String) -> URL? { lock.withLock { urls[ref] } }

  func keep(_ ref: String, copying source: URL) async {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = folder.appendingPathComponent("\(ref).\(source.pathExtension)")
    guard (try? FileManager.default.copyItem(at: source, to: target)) != nil else { return }
    lock.withLock { urls[ref] = target }
  }

  func keep(_ ref: String, data: Data) async {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = folder.appendingPathComponent("\(ref).jpg")
    guard (try? data.write(to: target)) != nil else { return }
    lock.withLock { urls[ref] = target }
  }
}
