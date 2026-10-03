import type { EventInput, ExpenseInput, ExpenseUpdateInput, HouseholdProfileInput, MemoInput, TodoInput } from '../domain/schemas';
import type { Authenticator, CalendarEvent, Expense, Household, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, Id, Insight, IsoDate, Memo, MembershipRole, MutationContext, NotificationPreferences, PermissionOverride, PrivacySettings, RecurrenceScope, Result, Scenario, SecurityOverview, Todo } from '../domain/types';

export interface AuthPort {
  beginPasskey(): Promise<Result<{ challengeId: Id; publicKey: PublicKeyCredentialRequestOptions | null }>>;
  /** 端末で本人確認した結果をサーバーへ渡し、検証が通ったときだけサインインを完了する。 */
  finishPasskey(challengeId: Id, assertion: unknown): Promise<Result<{ userId: Id }>>;
  signInWithPassword(email: string, password: string): Promise<Result<{ userId: Id }>>;
  signOut(): Promise<Result<void>>;
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
  updateEvent(id: Id, scope: RecurrenceScope, input: Partial<EventInput>, expectedVersion: number, context?: MutationContext, occurrenceDate?: IsoDate): Promise<Result<CalendarEvent>>;
  deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: number, occurrenceDate?: IsoDate): Promise<Result<void>>;
  restoreEvent(id: Id): Promise<Result<CalendarEvent>>;
}

export interface TodoPort {
  createTodo(input: TodoInput, context?: MutationContext): Promise<Result<Todo>>;
  updateTodoStatus(id: Id, status: Todo['status'], expectedVersion: number): Promise<Result<Todo>>;
  updateTodo(id: Id, scope: RecurrenceScope, input: Partial<TodoInput>, expectedVersion: number, context?: MutationContext): Promise<Result<Todo>>;
  /** 繰り返しのタスクでは、scope が this なら今回だけを飛ばして次の回へ進める。 */
  deleteTodo(id: Id, expectedVersion: number, scope?: RecurrenceScope): Promise<Result<void>>;
  restoreTodo(id: Id): Promise<Result<Todo>>;
}

export interface MemoPort {
  createMemo(input: MemoInput, context?: MutationContext): Promise<Result<Memo>>;
  updateMemo(id: Id, input: Partial<MemoInput>, expectedVersion: number, context?: MutationContext): Promise<Result<Memo>>;
  uploadAttachment(memoId: Id, file: File): Promise<Result<Memo>>;
  /** 確認が終わった添付の、期限付きの閲覧URL。確認中・拒否の添付には発行しない。 */
  getAttachmentLink(memoId: Id, attachmentId: Id): Promise<Result<{ url: string; expiresAt: string }>>;
  deleteMemo(id: Id): Promise<Result<void>>;
  restoreMemo(id: Id): Promise<Result<Memo>>;
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
}

export interface InsightPort {
  list(): Promise<Result<Insight[]>>;
}

export type SearchResultKind = 'event' | 'task' | 'memo' | 'expense' | 'place' | 'resource';
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
  resources: ResourcePort;
  insights: InsightPort;
  notifications: NotificationPort;
  credentials: CredentialClient;
}
