import type { EventInput, ExpenseInput, MemoInput, TodoInput } from '../domain/schemas';
import type { Authenticator, CalendarEvent, ContextSnapshot, Expense, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, Id, Memo, MembershipRole, MutationContext, NotificationPreferences, PermissionOverride, PrivacySettings, RecurrenceScope, Result, Scenario, SecurityOverview, Todo } from '../domain/types';

export interface AuthPort {
  beginPasskey(): Promise<Result<{ challengeId: Id }>>;
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
}

export interface HouseholdPort {
  getSnapshot(scenario?: Scenario): Promise<Result<HouseholdSnapshot>>;
  acceptInvite(code: string): Promise<Result<{ householdId: Id }>>;
  updateMembershipRole(id: Id, role: MembershipRole, expectedVersion: number): Promise<Result<HouseholdSnapshot['memberships'][number]>>;
  createInvite(role: Exclude<MembershipRole, 'owner'>): Promise<Result<HouseholdInvite>>;
  listInvites(): Promise<Result<HouseholdInvite[]>>;
  revokeInvite(id: Id): Promise<Result<HouseholdInvite>>;
  getPermissionOverrides(membershipId: Id): Promise<Result<PermissionOverride[]>>;
  updatePermissionOverrides(membershipId: Id, overrides: PermissionOverride[], expectedPermissionRevision: number): Promise<Result<HouseholdSnapshot>>;
  resetPermissionOverrides(membershipId: Id, expectedPermissionRevision: number): Promise<Result<HouseholdSnapshot>>;
  savePrivacySettings(settings: PrivacySettings): Promise<Result<PrivacySettings>>;
}

export interface EventPort {
  createEvent(input: EventInput, context?: MutationContext): Promise<Result<CalendarEvent>>;
  updateEvent(id: Id, scope: RecurrenceScope, input: Partial<EventInput>, expectedVersion: number, context?: MutationContext): Promise<Result<CalendarEvent>>;
  deleteEvent(id: Id, scope: RecurrenceScope, expectedVersion: number): Promise<Result<void>>;
  restoreEvent(id: Id): Promise<Result<CalendarEvent>>;
}

export interface TodoPort {
  createTodo(input: TodoInput, context?: MutationContext): Promise<Result<Todo>>;
  updateTodoStatus(id: Id, status: Todo['status'], expectedVersion: number): Promise<Result<Todo>>;
  updateTodo(id: Id, scope: RecurrenceScope, input: Partial<TodoInput>, expectedVersion: number, context?: MutationContext): Promise<Result<Todo>>;
  deleteTodo(id: Id, expectedVersion: number): Promise<Result<void>>;
  restoreTodo(id: Id): Promise<Result<Todo>>;
}

export interface MemoPort {
  createMemo(input: MemoInput, context?: MutationContext): Promise<Result<Memo>>;
  updateMemo(id: Id, input: Partial<MemoInput>, expectedVersion: number, context?: MutationContext): Promise<Result<Memo>>;
  uploadAttachment(memoId: Id, file: File): Promise<Result<Memo>>;
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
  recordSettlement(expenseId: Id, amountJpy: number): Promise<Result<Expense>>;
  reverseSettlement(expenseId: Id, settlementId: Id): Promise<Result<Expense>>;
}

export interface ResourcePort {
  search(query: string): Promise<Result<Array<{ kind: string; id: Id; label: string; destination: string }>>>;
}

export interface ContextPort {
  getContext(): Promise<Result<ContextSnapshot>>;
}

export interface FamilyHubGateway {
  auth: AuthPort;
  household: HouseholdPort;
  events: EventPort;
  todos: TodoPort;
  memos: MemoPort;
  expenses: ExpensePort;
  resources: ResourcePort;
  context: ContextPort;
  notifications: NotificationPort;
  credentials: CredentialClient;
}
