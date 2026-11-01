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
  reason?: 'CAPABILITY_MISSING' | 'SCOPE_DENIED' | 'MEMBERSHIP_INACTIVE' | 'OWNER_REQUIRED' | 'VERSION' | 'PERMISSION_REVISION' | 'IDEMPOTENCY' | 'CSRF' | 'REAUTH_FAILED' | 'SESSION_EXPIRED';
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
  | 'expense.read' | 'expense.create' | 'expense.update' | 'expense.delete' | 'expense.settle'
  | 'album.read' | 'album.create' | 'album.update' | 'album.delete'
  | 'link.manage' | 'assistant.use'
  | 'place.read'
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
  colorLabelId?: Id;
  /** 開始の何分前に知らせるか。 */
  reminderMinutesBefore?: number;
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

export type TodoStatus = 'open' | 'doing' | 'review' | 'waiting' | 'done';
export type TodoPriority = 'low' | 'normal' | 'high';
export interface Todo {
  id: Id;
  householdId: Id;
  title: string;
  dueAt?: Rfc3339;
  /** 期間で管理するタスクの開始。dueAt を終わりとして扱う。 */
  dueStartAt?: Rfc3339;
  status: TodoStatus;
  priority?: TodoPriority;
  colorLabelId?: Id;
  /** 次の人へ渡すときの一言。 */
  handoffNote?: string;
  /** 完了したときの一言。 */
  completionNote?: string;
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

export type PlaceCaptureSource = 'device' | 'photo' | 'search' | 'manual';
export interface PlaceProvenance {
  provider: 'openpoi';
  source: string;
  licenses: string[];
  attributions: string[];
}
/** 利用者が選んだ場所の記録。端末や写真から得た利用者自身の座標は含めない。 */
export interface PlaceRef {
  name: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  category?: string;
  provenance?: PlaceProvenance;
  capturedVia: PlaceCaptureSource;
  selectedAt: Rfc3339;
}

export interface Memo {
  id: Id;
  householdId: Id;
  title: string;
  body: string;
  updatedAt: Rfc3339;
  /** メモが指す日。作った日と分けて持つ。 */
  memoDate?: IsoDate;
  authorMembershipId: Id;
  tags: string[];
  attachments: Attachment[];
  ocrText?: string;
  place?: PlaceRef;
  visibility: VisibilityPolicy;
  deletedAt?: Rfc3339;
  version: number;
}

export type BgmPreset = 'calm' | 'bright' | 'gentle';
export interface Album {
  id: Id;
  householdId: Id;
  title: string;
  description?: string;
  coverItemId?: Id;
  place?: PlaceRef;
  bgmPreset?: BgmPreset;
  creatorMembershipId: Id;
  visibility: VisibilityPolicy;
  createdAt: Rfc3339;
  version: number;
  deletedAt?: Rfc3339;
}

export type AlbumItemStatus = 'uploading' | 'processing' | 'ready' | 'rejected';
export interface AlbumItem {
  id: Id;
  albumId: Id;
  householdId: Id;
  kind: 'photo' | 'video';
  originalName: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  takenAt?: Rfc3339;
  sha256?: string;
  status: AlbumItemStatus;
  statusMessage?: string;
  /** 撮影場所の情報を残しているか。既定では取り除く。 */
  locationKept: boolean;
  hasThumbnail: boolean;
  uploaderMembershipId: Id;
  position: number;
  createdAt: Rfc3339;
  deletedAt?: Rfc3339;
}

export interface AlbumSummary extends Album {
  itemCount: number;
  coverUrl?: string;
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

export type SpendingCategory = 'food' | 'dining' | 'transport' | 'utilities' | 'home' | 'education' | 'health' | 'entertainment' | 'shopping' | 'savings' | 'other';
export type IncomeCategory = 'income_salary' | 'income_bonus' | 'income_side' | 'income_investment' | 'income_gift' | 'income_other';

export interface Expense {
  id: Id;
  householdId: Id;
  /** expense は支出、income は収入。収入には負担と精算がない。 */
  kind: 'expense' | 'income';
  title: string;
  amountJpy: number;
  incurredOn: IsoDate;
  payerMembershipId: Id;
  creatorMembershipId: Id;
  category: SpendingCategory | IncomeCategory;
  shares: ExpenseShare[];
  settlements: SettlementRecord[];
  note?: string;
  place?: PlaceRef;
  visibility: VisibilityPolicy;
  version: number;
  deletedAt?: Rfc3339;
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

export type LinkedItemKind = 'event' | 'task' | 'memo' | 'expense';
export interface LinkedItemRef { kind: LinkedItemKind; id: Id }
/** 予定・タスク・メモ・支出のあいだの関連づけ。外部の URL を指す ResourceLink とは別のもの。 */
export interface ItemLink {
  id: Id;
  householdId: Id;
  from: LinkedItemRef;
  to: LinkedItemRef;
  createdByMembershipId: Id;
  createdAt: Rfc3339;
}

/** 色に名前を付けたリスト。予定とタスクの分類に使う。 */
export interface ColorLabel {
  id: Id;
  householdId: Id;
  name: string;
  color: string;
}

export interface ContextSnapshot {
  asOf: Rfc3339;
  timezone: string;
  weather: {
    /** 予報の対象地域（表示用）。 */
    location: string;
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
  links: ItemLink[];
  colorLabels: ColorLabel[];
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
  /** 作成時の応答にだけ含まれる。一覧では返さない。 */
  token?: string;
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

export interface PlaceLookupConsent {
  noticeVersion: string;
  grantedAt: Rfc3339;
}

export interface PrivacySettings {
  defaultAudience: 'household' | 'creator';
  hideNotificationContent: boolean;
  placeLookupConsent: PlaceLookupConsent | null;
}

export interface NotificationPreferences {
  todoDue: boolean;
  eventDeparture: boolean;
  quietHours: boolean;
}

export interface HouseholdNotification {
  id: Id;
  /** 通知の種類。通知設定（タスクの期限・予定の出発）による出し分けに使う。 */
  kind: 'todoDue' | 'eventDeparture';
  /** 通知から開く画面。 */
  destination: string;
  title: string;
  body: string;
  remindAt: Rfc3339;
  read: boolean;
  status: 'active' | 'snoozed' | 'stopped';
}

export type SessionStage = 'signed-out' | 'household-setup' | 'suspended' | 'paywall' | 'active';
/** サインインの状態と、本編に入れるかどうか。 */
export interface SessionInfo {
  stage: SessionStage;
  userId?: Id;
  /** 操作がないときにサインアウトするまでの分数。 */
  idleTimeoutMinutes: number;
}

export interface AccountProfile {
  displayName: string;
  email: string;
  avatar: { kind: 'initial' } | { kind: 'preset'; preset: string } | { kind: 'image'; dataUrl: string };
  idleTimeoutMinutes: number;
  birthdateDeclared: boolean;
  adultDeclared: boolean;
  totpEnabled: boolean;
}

export interface MutationContext {
  idempotencyKey: string;
  expectedPermissionRevision: number;
}
