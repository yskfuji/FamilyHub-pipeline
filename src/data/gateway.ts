import type { AlbumInput, AlbumUpdateInput, ColorLabelInput, EventInput, EventUpdateInput, ExpenseInput, ExpenseUpdateInput, HouseholdProfileInput, MemoInput, TodoInput, TodoUpdateInput } from '../domain/schemas';
import type { AccountUpdateInput, SignUpInput } from '../domain/account';
import type { AssistantJob, AssistantStatus } from '../domain/assistant';
import type { AccountAuditPage, AccountAuditQuery, AuditPage, AuditQuery } from '../domain/auditLog';
import type { AccountProfile, Album, AlbumItem, AlbumSummary, Authenticator, ColorLabel, ItemLink, LinkedItemRef, TrashItem, CalendarEvent, Expense, Household, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, Id, Insight, IsoDate, Memo, MembershipRole, MutationContext, NotificationPreferences, PermissionOverride, PrivacySettings, RecurrenceScope, Result, Scenario, SecurityOverview, SessionInfo, SettleAllInput, SettlementBatch, Todo } from '../domain/types';

export interface AuthPort {
  beginPasskey(): Promise<Result<{ challengeId: Id; publicKey: PublicKeyCredentialRequestOptions | null }>>;
  /** 端末で本人確認した結果をサーバーへ渡し、検証が通ったときだけサインインを完了する。 */
  finishPasskey(challengeId: Id, assertion: unknown): Promise<Result<{ userId: Id }>>;
  /** 確認コードを設定している人は totpChallengeId を受け取り、verifyTotp で完了する。 */
  signInWithPassword(email: string, password: string): Promise<Result<{ userId: Id } | { totpChallengeId: Id }>>;
  verifyTotp(challengeId: Id, code: string): Promise<Result<{ userId: Id }>>;
  signUp(input: SignUpInput): Promise<Result<{ userId: Id }>>;
  requestPasswordReset(email: string): Promise<Result<{ resendAfterSeconds: number }>>;
  confirmPasswordReset(input: { email?: string; code?: string; token?: string; newPassword: string }): Promise<Result<void>>;
  reauthenticate(password: string): Promise<Result<void>>;
  getAccount(): Promise<Result<AccountProfile>>;
  updateAccount(input: AccountUpdateInput): Promise<Result<AccountProfile>>;
  changeEmail(email: string): Promise<Result<AccountProfile>>;
  deleteAccount(): Promise<Result<void>>;
  beginTotpEnrollment(): Promise<Result<{ otpauthUri: string }>>;
  confirmTotpEnrollment(code: string): Promise<Result<{ recoveryCodes: string[] }>>;
  disableTotp(): Promise<Result<void>>;
  signOut(): Promise<Result<void>>;
  getSession(): Promise<Result<SessionInfo>>;
  /** 配信中の版の印。開いている画面より新しい版があるかを確かめる。 */
  getVersion(): Promise<Result<{ build: string }>>;
  getSecurityOverview(): Promise<Result<SecurityOverview>>;
  beginPasskeyRegistration(): Promise<Result<{ challengeId: Id; publicKey: PublicKeyCredentialCreationOptions | null }>>;
  finishPasskeyRegistration(challengeId: Id, credential: unknown): Promise<Result<Authenticator>>;
  changePassword(currentPassword: string, newPassword: string): Promise<Result<void>>;
  revokeSession(sessionId: Id): Promise<Result<void>>;
}

export interface CredentialClient {
  create(options: PublicKeyCredentialCreationOptions | null): Promise<Result<unknown>>;
  /** サインイン時の本人確認。端末のパスキーで署名した結果（assertion）を返す。検証はサーバーが行う。 */
  get(options: PublicKeyCredentialRequestOptions | null): Promise<Result<unknown>>;
}

export interface HouseholdPort {
  createHousehold(name: string): Promise<Result<{ householdId: Id }>>;
  getSnapshot(scenario?: Scenario): Promise<Result<HouseholdSnapshot>>;
  acceptInvite(code: string): Promise<Result<{ householdId: Id }>>;
  updateProfile(input: HouseholdProfileInput): Promise<Result<Household>>;
  updateMembershipRole(id: Id, role: MembershipRole, expectedVersion: number): Promise<Result<HouseholdSnapshot['memberships'][number]>>;
  createInvite(role: Exclude<MembershipRole, 'owner'>): Promise<Result<HouseholdInvite>>;
  listInvites(): Promise<Result<HouseholdInvite[]>>;
  revokeInvite(id: Id): Promise<Result<HouseholdInvite>>;
  getPermissionOverrides(membershipId: Id): Promise<Result<PermissionOverride[]>>;
  updatePermissionOverrides(membershipId: Id, overrides: PermissionOverride[], expectedPermissionRevision: number): Promise<Result<HouseholdSnapshot>>;
  resetPermissionOverrides(membershipId: Id, expectedPermissionRevision: number): Promise<Result<HouseholdSnapshot>>;
  getPrivacySettings(): Promise<Result<PrivacySettings>>;
  savePrivacySettings(settings: PrivacySettings): Promise<Result<PrivacySettings>>;
}

export interface EventPort {
  createEvent(input: EventInput, context?: MutationContext): Promise<Result<CalendarEvent>>;
  /** 繰り返しの予定では、scope が this / future のとき occurrenceDate（対象の回）が必要。 */
  updateEvent(id: Id, scope: RecurrenceScope, input: EventUpdateInput, expectedVersion: number, context?: MutationContext, occurrenceDate?: IsoDate): Promise<Result<CalendarEvent>>;
  deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: number, occurrenceDate?: IsoDate): Promise<Result<void>>;
  /** occurrenceDate を渡すと、その1回だけを元に戻す。 */
  restoreEvent(id: Id, occurrenceDate?: IsoDate): Promise<Result<CalendarEvent>>;
}

export interface TodoPort {
  createTodo(input: TodoInput, context?: MutationContext): Promise<Result<Todo>>;
  /** note は次の人への一言。完了のときは完了の一言として残す。 */
  updateTodoStatus(id: Id, status: Todo['status'], expectedVersion: number, note?: string): Promise<Result<Todo>>;
  updateTodo(id: Id, scope: RecurrenceScope, input: TodoUpdateInput, expectedVersion: number, context?: MutationContext): Promise<Result<Todo>>;
  /** 繰り返しのタスクでは、scope が this なら今回だけを飛ばして次の回へ進める。 */
  deleteTodo(id: Id, expectedVersion: number, scope?: RecurrenceScope): Promise<Result<void>>;
  restoreTodo(id: Id): Promise<Result<Todo>>;
}

export type AttachmentDisposition = 'inline' | 'attachment';

export interface MemoPort {
  createMemo(input: MemoInput, context?: MutationContext): Promise<Result<Memo>>;
  updateMemo(id: Id, input: Partial<MemoInput>, expectedVersion: number, context?: MutationContext): Promise<Result<Memo>>;
  /** 同じファイルを送り直すときは同じ idempotencyKey を渡す。応答だけが届かなかったときに添付が2つにならない。 */
  uploadAttachment(memoId: Id, file: File, idempotencyKey?: string): Promise<Result<Memo>>;
  /**
   * 確認が終わった添付の、期限付きの URL。確認中・拒否の添付には発行しない。
   * inline はアプリの中の表示画面で開くためのもの（画像・mp4・PDF だけが inline で届き、ほかの種類は保存になる）。
   * attachment は保存のためのもの（?download=1）。既定は attachment。
   */
  getAttachmentLink(memoId: Id, attachmentId: Id, disposition?: AttachmentDisposition): Promise<Result<{ url: string; expiresAt: string }>>;
  deleteAttachment(memoId: Id, attachmentId: Id): Promise<Result<void>>;
  deleteMemo(id: Id): Promise<Result<void>>;
  restoreMemo(id: Id): Promise<Result<Memo>>;
}

export interface UploadOptions {
  keepLocation: boolean;
  /** 動画の縮小画像。端末で作って渡す。 */
  thumbnail?: Blob;
  /** 送信の枠を受け取ったとき。アルバムの中の並びは、枠を受け取った順に決まる。 */
  onReserved?(): void;
  onProgress?(sentBytes: number, totalBytes: number): void;
  signal?: AbortSignal;
}

export interface AlbumPort {
  listAlbums(): Promise<Result<AlbumSummary[]>>;
  getAlbum(id: Id): Promise<Result<{ album: Album; items: AlbumItem[] }>>;
  createAlbum(input: AlbumInput): Promise<Result<Album>>;
  updateAlbum(id: Id, input: AlbumUpdateInput, expectedVersion: number): Promise<Result<Album>>;
  deleteAlbum(id: Id, expectedVersion: number): Promise<Result<void>>;
  restoreAlbum(id: Id): Promise<Result<Album>>;
  reorderItems(albumId: Id, itemIds: Id[], expectedVersion: number): Promise<Result<Album>>;
  deleteItem(albumId: Id, itemId: Id): Promise<Result<void>>;
  restoreItem(albumId: Id, itemId: Id): Promise<Result<AlbumItem>>;
  /**
   * 大きなファイルは分けて送り、途切れても続きから送る。同じ File でもう一度呼ぶと、前回の続きから送る。
   * signal で止めたときは、途中まで送った分を取り消す。
   */
  uploadItem(albumId: Id, file: File, options: UploadOptions): Promise<Result<{ itemId: Id }>>;
  /** 送り直さないと決めたファイルの送信を取り消す。途中まで受け取った分と枠を手放す。 */
  cancelUpload(file: File): Promise<Result<void>>;
  /** 写真や動画を開く URL。同じオリジンの画像として読み込める。 */
  mediaUrl(item: Pick<AlbumItem, 'id' | 'albumId'>, variant: 'thumbnail' | 'file'): string;
}

export interface FamilyPort {
  transferOwnership(toMembershipId: Id, expectedVersion: number): Promise<Result<HouseholdSnapshot['memberships'][number]>>;
  setMemberStatus(membershipId: Id, status: 'active' | 'suspended', expectedVersion: number): Promise<Result<HouseholdSnapshot['memberships'][number]>>;
  removeMember(membershipId: Id, expectedVersion: number): Promise<Result<void>>;
  leaveHousehold(): Promise<Result<void>>;
  createColorLabel(input: ColorLabelInput): Promise<Result<ColorLabel>>;
  updateColorLabel(id: Id, input: ColorLabelInput): Promise<Result<ColorLabel>>;
  deleteColorLabel(id: Id): Promise<Result<void>>;
}

export interface LinkPort {
  createLink(from: LinkedItemRef, to: LinkedItemRef): Promise<Result<ItemLink>>;
  deleteLink(id: Id): Promise<Result<void>>;
}

export interface TrashPort {
  list(): Promise<Result<TrashItem[]>>;
}

export interface NotificationPort {
  list(): Promise<Result<HouseholdNotification[]>>;
  markRead(id: Id): Promise<Result<HouseholdNotification>>;
  snooze(id: Id, minutes: 30): Promise<Result<HouseholdNotification>>;
  stop(id: Id): Promise<Result<HouseholdNotification>>;
  resume(id: Id): Promise<Result<HouseholdNotification>>;
  getPreferences(): Promise<Result<NotificationPreferences>>;
  updatePreferences(input: Partial<NotificationPreferences>): Promise<Result<NotificationPreferences>>;
}

export interface ExpensePort {
  createExpense(input: ExpenseInput): Promise<Result<Expense>>;
  updateExpense(id: Id, input: ExpenseUpdateInput, expectedVersion: number): Promise<Result<Expense>>;
  /** 取り消していない精算がある支出は削除できない（先に精算を取り消す）。削除後7日間は復元できる。 */
  deleteExpense(id: Id, expectedVersion: number): Promise<Result<void>>;
  restoreExpense(id: Id): Promise<Result<Expense>>;
  recordSettlement(expenseId: Id, fromMembershipId: Id, amountJpy: number): Promise<Result<Expense>>;
  reverseSettlement(expenseId: Id, settlementId: Id): Promise<Result<Expense>>;
  /**
   * 画面に示した負担をまとめて精算する（A4）。負担がすべて見えて残りの額が一致するときだけ、1回で精算済みにし、
   * 実際に渡す送金の一覧を残す。本人の再確認が要る。冪等キーは画面ごとに1つ。オフラインの待ち行列には入れない。
   */
  settleAll(input: SettleAllInput, idempotencyKey?: string): Promise<Result<SettlementBatch>>;
  /** まとめた精算を、まとめの単位で取り消す。一部をすでに個別に取り消していれば CONFLICT。 */
  reverseBatch(batchId: Id, idempotencyKey?: string): Promise<Result<SettlementBatch>>;
}

export interface InsightPort {
  list(): Promise<Result<Insight[]>>;
}

export interface AssistantPort {
  /** 読み取りの補助を今の人が使えるか。使えなければ画面に出さない。 */
  getStatus(): Promise<Result<AssistantStatus>>;
  /** 領収書の画像から支出の提案を作る仕事を始める。記録には何も保存しない。 */
  readReceipt(file: File): Promise<Result<AssistantJob>>;
  /** チラシの画像から予定の候補を作る仕事を始める。 */
  readEventImage(file: File): Promise<Result<AssistantJob>>;
  /** ページの URL から予定の候補を作る仕事を始める。 */
  readEventUrl(url: string): Promise<Result<AssistantJob>>;
  getJob(id: Id): Promise<Result<AssistantJob>>;
}

/** 変更の記録。本文・秘密・トークンは返さない。見られない記録を指す行は ID を伏せる。 */
export interface AuditPort {
  /** 家族の変更の記録を新しい順に。audit.read が必要（既定では管理者だけ）。鎖の確認の結果も返す。 */
  list(query?: AuditQuery): Promise<Result<AuditPage>>;
  /** 本人のアカウントの記録（サインイン、パスワードや確認コードの変更など）。 */
  listMine(query?: AccountAuditQuery): Promise<Result<AccountAuditPage>>;
}

/** album は /albums/:id、albumItem は表示画面を開く /albums/:id?item=:itemId へ。 */
export type SearchResultKind = 'event' | 'task' | 'memo' | 'expense' | 'place' | 'resource' | 'album' | 'albumItem';
export interface SearchResult { kind: SearchResultKind; id: Id; label: string; detail?: string; destination: string }

export interface ResourcePort {
  search(query: string): Promise<Result<SearchResult[]>>;
}

export interface FamilyHubGateway {
  auth: AuthPort;
  household: HouseholdPort;
  events: EventPort;
  todos: TodoPort;
  memos: MemoPort;
  expenses: ExpensePort;
  albums: AlbumPort;
  family: FamilyPort;
  links: LinkPort;
  trash: TrashPort;
  resources: ResourcePort;
  insights: InsightPort;
  assistant: AssistantPort;
  notifications: NotificationPort;
  audit: AuditPort;
  credentials: CredentialClient;
}
