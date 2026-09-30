export type Id = string;
export type IsoDate = `${number}-${number}-${number}`;
export type Rfc3339 = string;
export type Theme = 'light' | 'dusk';
export type Scenario = 'normal' | 'empty' | 'loading' | 'offline' | 'conflict' | 'expired-invite' | 'expired-session' | 'quarantined' | 'weather';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: GatewayError };

export type GatewayErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REAUTH_REQUIRED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'OFFLINE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_FAILURE'
  | 'ATTACHMENT_REJECTED';

export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
  reason?: 'CAPABILITY_MISSING' | 'SCOPE_DENIED' | 'MEMBERSHIP_INACTIVE' | 'OWNER_REQUIRED' | 'VERSION' | 'PERMISSION_REVISION' | 'IDEMPOTENCY';
}

export interface User {
  id: Id;
  displayName: string;
  email: string;
  avatarTone: 'persimmon' | 'indigo' | 'moss' | 'plum';
}

export interface Household {
  id: Id;
  name: string;
  timezone: 'Asia/Tokyo';
}

export type MembershipRole = 'owner' | 'adult' | 'child' | 'guest';
export type Capability =
  | 'household.members.read' | 'household.members.manage' | 'household.invites.manage'
  | 'event.read' | 'event.create' | 'event.update' | 'event.delete'
  | 'task.read' | 'task.create' | 'task.update' | 'task.delete' | 'task.transition'
  | 'memo.read' | 'memo.create' | 'memo.update' | 'memo.delete' | 'memo.attach'
  | 'expense.read' | 'expense.create' | 'expense.settle'
  | 'insight.read' | 'resource.read' | 'settings.own' | 'notification.manage';
export interface PermissionOverride { membershipId: Id; capability: Capability; effect: 'allow' | 'deny'; }
export interface ViewerContext {
  userId: Id;
  membershipId: Id;
  role: MembershipRole;
  status: HouseholdMembership['status'];
  capabilities: Capability[];
  permissionRevision: number;
}
export type VisibilityAudience = 'household' | 'adults' | 'participants' | 'creator' | 'selected';
export interface VisibilityPolicy {
  audience: VisibilityAudience;
  creatorMembershipId: Id;
  selectedMembershipIds: Id[];
}
export type AuthorizationDecision = { allowed: true } | { allowed: false; reason: NonNullable<GatewayError['reason']> };
export interface HouseholdMembership {
  id: Id;
  householdId: Id;
  userId: Id;
  displayName: string;
  role: MembershipRole;
  status: 'active' | 'invited' | 'suspended';
  color: string;
  version: number;
}

export type RecurrenceScope = 'this' | 'future' | 'series';

export interface RecurrenceRule {
  rrule: string;
  timezone: string;
  exceptions: IsoDate[];
}

export interface CalendarEvent {
  id: Id;
  householdId: Id;
  title: string;
  startsAt: Rfc3339;
  endsAt: Rfc3339;
  timezone: string;
  allDay?: boolean;
  ownerMembershipId: Id;
  participantMembershipIds: Id[];
  location?: string;
  recurrence?: RecurrenceRule;
  resourceIds?: Id[];
  note?: string;
  weatherSensitive?: boolean;
  version: number;
  visibility: VisibilityPolicy;
  deletedAt?: Rfc3339;
}

export type TodoStatus = 'open' | 'doing' | 'review' | 'done';
export interface Todo {
  id: Id;
  householdId: Id;
  title: string;
  dueAt?: Rfc3339;
  status: TodoStatus;
  assigneeMembershipId: Id;
  reviewerMembershipId?: Id;
  creatorMembershipId: Id;
  recurrence?: RecurrenceRule;
  version: number;
  note?: string;
  visibility: VisibilityPolicy;
  deletedAt?: Rfc3339;
}

export type AttachmentStatus = 'selected' | 'validating' | 'quarantined' | 'clean' | 'rejected';
export interface Attachment {
  id: Id;
  memoId: Id;
  originalName: string;
  mimeType: string;
  byteSize: number;
  status: AttachmentStatus;
  statusMessage: string;
}

export interface Memo {
  id: Id;
  householdId: Id;
  title: string;
  body: string;
  updatedAt: Rfc3339;
  authorMembershipId: Id;
  tags: string[];
  attachments: Attachment[];
  ocrText?: string;
  visibility: VisibilityPolicy;
  deletedAt?: Rfc3339;
  version: number;
}

export interface ExpenseShare {
  membershipId: Id;
  amountJpy: number;
  settledJpy: number;
}

export interface SettlementRecord {
  id: Id;
  amountJpy: number;
  fromMembershipId: Id;
  toMembershipId: Id;
  recordedAt: Rfc3339;
  reversedAt?: Rfc3339;
  reversalOfSettlementId?: Id;
}

export interface Expense {
  id: Id;
  householdId: Id;
  title: string;
  amountJpy: number;
  incurredOn: IsoDate;
  payerMembershipId: Id;
  category: 'food' | 'transport' | 'education' | 'home' | 'other';
  shares: ExpenseShare[];
  settlements: SettlementRecord[];
  note?: string;
}

export interface ResourceLink {
  id: Id;
  householdId: Id;
  label: string;
  url: string;
  kind: 'school' | 'municipality' | 'document' | 'other';
  relatedEntityId?: Id;
  visibility: VisibilityPolicy;
}

export interface ContextSnapshot {
  asOf: Rfc3339;
  timezone: string;
  weather: {
    condition: 'sunny' | 'rain' | 'storm';
    temperatureC: number;
    precipitationPercent: number;
    alert?: string;
  };
  holidays: Array<{ date: IsoDate; name: string }>;
  sync: { state: 'synced' | 'offline' | 'syncing'; lastSyncedAt: Rfc3339 };
}

export interface HouseholdSnapshot {
  viewer: ViewerContext;
  permissionOverrides: PermissionOverride[];
  user: User;
  household: Household;
  memberships: HouseholdMembership[];
  events: CalendarEvent[];
  todos: Todo[];
  memos: Memo[];
  expenses: Expense[];
  resources: ResourceLink[];
  context: ContextSnapshot;
}

export interface Insight {
  id: Id;
  title: string;
  summary: string;
  evidence: string;
  actionLabel: string;
  destination: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface HouseholdInvite {
  id: Id;
  householdId: Id;
  role: Exclude<MembershipRole, 'owner'>;
  token: string;
  expiresAt: Rfc3339;
  remainingUses: number;
  revokedAt?: Rfc3339;
}

export interface Authenticator {
  id: Id;
  label: string;
  createdAt: Rfc3339;
  kind: 'passkey';
  demo: boolean;
}

export interface Session {
  id: Id;
  label: string;
  location: string;
  lastSeenAt: Rfc3339;
  current: boolean;
}

export interface SecurityOverview {
  authenticators: Authenticator[];
  sessions: Session[];
}

export interface PrivacySettings {
  defaultAudience: 'household' | 'creator';
  hideNotificationContent: boolean;
}

export interface NotificationPreferences {
  todoDue: boolean;
  eventDeparture: boolean;
  quietHours: boolean;
}

export interface HouseholdNotification {
  id: Id;
  title: string;
  body: string;
  remindAt: Rfc3339;
  read: boolean;
  status: 'active' | 'snoozed' | 'stopped';
}

export interface MutationContext {
  idempotencyKey: string;
  expectedPermissionRevision: number;
}
