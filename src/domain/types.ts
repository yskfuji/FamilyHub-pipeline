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
export interface HouseholdMembership {
  id: Id;
  householdId: Id;
  userId: Id;
  displayName: string;
  role: MembershipRole;
  status: 'active' | 'invited' | 'suspended';
  color: string;
}

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
