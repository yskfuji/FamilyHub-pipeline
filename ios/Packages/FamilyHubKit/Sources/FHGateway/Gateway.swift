import Foundation
import FHModel

/// サーバーとのやり取りの窓口。Web の FamilyHubGateway（src/data/gateway.ts）の写しで、
/// 見本（SampleGateway）とサーバー（HTTPGateway）が同じ形で応える。段階ごとに関数を足す。
public typealias GatewayResult<Value> = Result<Value, GatewayError>

public protocol FamilyHubGateway: Sendable {
  /// サーバーにつながっているか、見本か。
  var mode: GatewayMode { get }

  // auth
  func getSession() async -> GatewayResult<SessionInfo>
  func signInWithPassword(email: String, password: String) async -> GatewayResult<SignInResult>
  func verifyTotp(challengeId: Id, code: String) async -> GatewayResult<UserRef>
  func signUp(_ input: SignUpInput) async -> GatewayResult<UserRef>
  func requestPasswordReset(email: String) async -> GatewayResult<PasswordResetRequested>
  func confirmPasswordReset(_ input: PasswordResetConfirmation) async -> GatewayResult<Empty>
  func reauthenticate(password: String) async -> GatewayResult<Empty>
  func signOut() async -> GatewayResult<Empty>

  // household
  func getSnapshot() async -> GatewayResult<HouseholdSnapshot>
  func createHousehold(name: String) async -> GatewayResult<HouseholdRef>
  func acceptInvite(code: String) async -> GatewayResult<HouseholdRef>
  func getPrivacySettings() async -> GatewayResult<PrivacySettings>
  func savePrivacySettings(_ settings: PrivacySettings) async -> GatewayResult<PrivacySettings>

  // events
  func createEvent(_ input: EventInput, context: MutationContext?) async -> GatewayResult<CalendarEvent>
  /// 繰り返しの予定では、scope が this / future のとき occurrenceDate（対象の回）が必要。
  func updateEvent(id: Id, scope: RecurrenceScope, input: EventUpdateInput, expectedVersion: Int, context: MutationContext?, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent>
  func deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: Int, occurrenceDate: IsoDate?) async -> GatewayResult<Empty>
  /// occurrenceDate を渡すと、その1回だけを元に戻す。
  func restoreEvent(id: Id, occurrenceDate: IsoDate?) async -> GatewayResult<CalendarEvent>

  // todos
  func createTodo(_ input: TodoInput, context: MutationContext?) async -> GatewayResult<Todo>
  /// note は状態を変えるときの一言。完了なら完了の一言、それ以外は引き継ぎの一言になる。
  func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo>
  func updateTodo(id: Id, scope: RecurrenceScope, input: TodoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Todo>
  func deleteTodo(id: Id, expectedVersion: Int, scope: RecurrenceScope) async -> GatewayResult<Empty>
  func restoreTodo(id: Id) async -> GatewayResult<Todo>

  // memos
  func createMemo(_ input: MemoInput, context: MutationContext?) async -> GatewayResult<Memo>
  func updateMemo(id: Id, input: MemoUpdateInput, expectedVersion: Int, context: MutationContext?) async -> GatewayResult<Memo>
  /// 送り直しでも同じ idempotencyKey を使う（応答が届かなかったときに、添付が2つにならない）。
  func uploadAttachment(memoId: Id, file: UploadFile, idempotencyKey: String) async -> GatewayResult<Memo>
  func getAttachmentLink(memoId: Id, attachmentId: Id, disposition: AttachmentDisposition) async -> GatewayResult<AttachmentLink>
  func deleteAttachment(memoId: Id, attachmentId: Id) async -> GatewayResult<Empty>
  func deleteMemo(id: Id) async -> GatewayResult<Empty>
  func restoreMemo(id: Id) async -> GatewayResult<Memo>
  /// リンクの中身を、この端末の一時の場所（AttachmentFiles）に取る。Web にはない（ブラウザがリンクを直接開く）。
  func downloadAttachment(_ link: AttachmentLink, fileName: String) async -> GatewayResult<URL>

  // expenses（家計。精算の変更は本人の再確認が要ることがある）
  /// 同じ入力の画面から送り直すときは、同じ idempotencyKey を渡す。
  func createExpense(_ input: ExpenseInput, idempotencyKey: String) async -> GatewayResult<Expense>
  func updateExpense(id: Id, input: ExpenseUpdateInput, expectedVersion: Int) async -> GatewayResult<Expense>
  /// 取り消していない精算がある支出は削除できない。削除後7日間は元に戻せる。
  func deleteExpense(id: Id, expectedVersion: Int) async -> GatewayResult<Empty>
  func restoreExpense(id: Id) async -> GatewayResult<Expense>
  func recordSettlement(expenseId: Id, fromMembershipId: Id, amountJpy: Int) async -> GatewayResult<Expense>
  func reverseSettlement(expenseId: Id, settlementId: Id) async -> GatewayResult<Expense>
  /// 画面に示した負担をまとめて精算する。冪等の鍵は画面ごとに1つ。
  func settleAll(_ input: SettleAllInput, idempotencyKey: String) async -> GatewayResult<SettlementBatch>
  func reverseBatch(id: Id, idempotencyKey: String) async -> GatewayResult<SettlementBatch>

  // albums（写真と動画。送信は分けて送り、途切れても続きから送る）
  func listAlbums() async -> GatewayResult<[AlbumSummary]>
  func getAlbum(id: Id) async -> GatewayResult<AlbumDetail>
  func createAlbum(_ input: AlbumInput, idempotencyKey: String) async -> GatewayResult<Album>
  func updateAlbum(id: Id, input: AlbumUpdateInput, expectedVersion: Int) async -> GatewayResult<Album>
  func deleteAlbum(id: Id, expectedVersion: Int) async -> GatewayResult<Empty>
  func restoreAlbum(id: Id) async -> GatewayResult<Album>
  /// itemIds はアルバムの全項目の並び。
  func reorderItems(albumId: Id, itemIds: [Id], expectedVersion: Int) async -> GatewayResult<Album>
  func deleteItem(albumId: Id, itemId: Id) async -> GatewayResult<Empty>
  func restoreItem(albumId: Id, itemId: Id) async -> GatewayResult<AlbumItem>
  /// 送る。ticket が前回の枠を持っていれば、その続きから送る。動画の縮小画像（JPEG）は送り終えてから付ける。
  func uploadItem(albumId: Id, source: UploadSource, keepLocation: Bool, thumbnail: Data?, ticket: UploadTicket, progress: @escaping UploadProgress) async -> GatewayResult<Id>
  /// 送り直さないと決めたファイルの枠を手放す。
  func cancelUpload(ticket: UploadTicket) async -> GatewayResult<Empty>
  func mediaSource(albumId: Id, itemId: Id, variant: MediaVariant) -> MediaSource
  /// 写真や動画をこの端末の一時の場所に取る（AttachmentFiles）。
  func downloadMedia(_ source: MediaSource, fileName: String) async -> GatewayResult<URL>

  // assistant（読み取りの補助。結果は提案で、記録には何も保存しない）
  func readReceipt(_ file: UploadFile) async -> GatewayResult<AssistantJob>
  func getAssistantStatus() async -> GatewayResult<AssistantStatus>
  func readEventImage(_ file: UploadFile) async -> GatewayResult<AssistantJob>
  func readEventUrl(_ url: String) async -> GatewayResult<AssistantJob>
  func getAssistantJob(id: Id) async -> GatewayResult<AssistantJob>

  // notifications
  func listNotifications() async -> GatewayResult<[HouseholdNotification]>
  func markNotificationRead(id: Id) async -> GatewayResult<HouseholdNotification>
}

public enum GatewayMode: Sendable, Hashable {
  case sample
  case server(URL)
}

/// 関数の名前（port.method）。Web の FamilyHubGateway の関数と照らす（GatewayParityTests）。
public enum GatewayMethod: String, CaseIterable, Sendable {
  case getSession = "auth.getSession"
  case signInWithPassword = "auth.signInWithPassword"
  case verifyTotp = "auth.verifyTotp"
  case signUp = "auth.signUp"
  case requestPasswordReset = "auth.requestPasswordReset"
  case confirmPasswordReset = "auth.confirmPasswordReset"
  case reauthenticate = "auth.reauthenticate"
  case signOut = "auth.signOut"
  case getSnapshot = "household.getSnapshot"
  case createHousehold = "household.createHousehold"
  case acceptInvite = "household.acceptInvite"
  case getPrivacySettings = "household.getPrivacySettings"
  case savePrivacySettings = "household.savePrivacySettings"
  case createEvent = "events.createEvent"
  case updateEvent = "events.updateEvent"
  case deleteEvent = "events.deleteEvent"
  case restoreEvent = "events.restoreEvent"
  case createTodo = "todos.createTodo"
  case updateTodoStatus = "todos.updateTodoStatus"
  case updateTodo = "todos.updateTodo"
  case deleteTodo = "todos.deleteTodo"
  case restoreTodo = "todos.restoreTodo"
  case createMemo = "memos.createMemo"
  case updateMemo = "memos.updateMemo"
  case uploadAttachment = "memos.uploadAttachment"
  case getAttachmentLink = "memos.getAttachmentLink"
  case deleteAttachment = "memos.deleteAttachment"
  case deleteMemo = "memos.deleteMemo"
  case restoreMemo = "memos.restoreMemo"
  case createExpense = "expenses.createExpense"
  case updateExpense = "expenses.updateExpense"
  case deleteExpense = "expenses.deleteExpense"
  case restoreExpense = "expenses.restoreExpense"
  case recordSettlement = "expenses.recordSettlement"
  case reverseSettlement = "expenses.reverseSettlement"
  case settleAll = "expenses.settleAll"
  case reverseBatch = "expenses.reverseBatch"
  case readReceipt = "assistant.readReceipt"
  case listAlbums = "albums.listAlbums"
  case getAlbum = "albums.getAlbum"
  case createAlbum = "albums.createAlbum"
  case updateAlbum = "albums.updateAlbum"
  case deleteAlbum = "albums.deleteAlbum"
  case restoreAlbum = "albums.restoreAlbum"
  case reorderItems = "albums.reorderItems"
  case deleteItem = "albums.deleteItem"
  case restoreItem = "albums.restoreItem"
  case uploadItem = "albums.uploadItem"
  case cancelUpload = "albums.cancelUpload"
  case getAssistantStatus = "assistant.getStatus"
  case readEventImage = "assistant.readEventImage"
  case readEventUrl = "assistant.readEventUrl"
  case getAssistantJob = "assistant.getJob"
  case listNotifications = "notifications.list"
  case markNotificationRead = "notifications.markRead"
}

/// JSON の引数。末尾の nil は渡さない（JS の省略と同じにする）。
public enum GatewayArgument: Encodable, Sendable {
  case value(any Encodable & Sendable)
  case absent

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .value(let value): try value.encode(to: encoder)
    case .absent:
      var container = encoder.singleValueContainer()
      try container.encodeNil()
    }
  }

  static func list(_ values: [(any Encodable & Sendable)?]) -> [GatewayArgument] {
    var arguments = values.map { $0.map(GatewayArgument.value) ?? .absent }
    while case .absent? = arguments.last { arguments.removeLast() }
    return arguments
  }
}

/// 失敗の文言。Web の httpGateway.ts と同じ。
public enum GatewayFailure {
  public static let offline = GatewayError(code: .offline, message: "ネットワークに接続できません。", retryable: true)
  public static let response = GatewayError(code: .upstreamFailure, message: "応答を受け取れませんでした。少し待ってからお試しください。", retryable: true)
}

/// 送るファイル（画像など）。中身は端末の中に置いたまま、名前と種類と大きさを添える。
public struct UploadFile: Sendable, Hashable {
  public var name: String
  public var type: String
  public var data: Data
  public var size: Int { data.count }
  public init(name: String, type: String, data: Data) { self.name = name; self.type = type; self.data = data }
}
