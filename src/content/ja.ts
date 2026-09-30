import type {
  AttachmentStatus,
  Capability,
  GatewayError,
  HouseholdMembership,
  HouseholdNotification,
  MembershipRole,
  RecurrenceScope,
  ResourceLink,
  Scenario,
  TodoStatus,
  VisibilityAudience,
} from '../domain/types';

const recurrence = {
  event: {
    this: 'この予定だけ',
    future: 'これ以降の予定',
    series: 'すべての予定',
  },
  task: {
    this: 'このタスクだけ',
    future: 'これ以降のタスク',
    series: 'すべてのタスク',
  },
} satisfies Record<'event' | 'task', Record<RecurrenceScope, string>>;

export const ja = {
  brand: {
    name: 'よりどころ',
    markLabel: 'よりどころのロゴ',
    tagline: '家族の暮らしをひとつに',
  },
  navigation: {
    today: '今日',
    calendar: '予定',
    tasks: 'タスク',
    notes: 'メモ',
    budget: '家計',
    insights: 'ヒント',
    settings: '設定',
    more: 'その他',
    relatedLinks: '関連リンク',
  },
  roles: {
    owner: '管理者',
    adult: '大人のメンバー',
    child: '子どもメンバー',
    guest: 'ゲスト',
  } satisfies Record<MembershipRole, string>,
  membershipStatus: {
    active: '利用中',
    invited: '招待中',
    suspended: '利用停止',
  } satisfies Record<HouseholdMembership['status'], string>,
  taskStatus: {
    open: '未着手',
    doing: '進行中',
    review: '確認待ち',
    done: '完了',
  } satisfies Record<TodoStatus, string>,
  attachmentStatus: {
    selected: '選択済み',
    validating: '確認中',
    quarantined: '確認中',
    clean: '確認済み',
    rejected: '添付できません',
  } satisfies Record<AttachmentStatus, string>,
  notificationStatus: {
    active: '通知予定',
    snoozed: '延期済み',
    stopped: '停止中',
  } satisfies Record<HouseholdNotification['status'], string>,
  scenario: {
    normal: '通常',
    empty: 'データなし',
    loading: '読み込み中',
    offline: 'オフライン',
    conflict: '変更の競合',
    'expired-invite': '招待の期限切れ',
    'expired-session': 'サインインの期限切れ',
    quarantined: '添付ファイルの確認中',
    weather: '荒天',
  } satisfies Record<Scenario, string>,
  visibility: {
    household: '家族全員',
    adults: '大人のメンバー',
    participants: '参加者',
    creator: '作成した本人',
    selected: '選択したメンバー',
  } satisfies Record<VisibilityAudience, string>,
  recurrence,
  resourceKinds: {
    school: '学校',
    municipality: '自治体',
    document: '文書',
    other: 'その他',
  } satisfies Record<ResourceLink['kind'], string>,
  capability: {
    'household.members.read': '家族のメンバーを見る',
    'household.members.manage': 'メンバーと役割を管理する',
    'household.invites.manage': '招待を管理する',
    'event.read': '予定を見る',
    'event.create': '予定を追加する',
    'event.update': '予定を変更する',
    'event.delete': '予定を削除する',
    'task.read': 'タスクを見る',
    'task.create': 'タスクを追加する',
    'task.update': 'タスクを変更する',
    'task.delete': 'タスクを削除する',
    'task.transition': 'タスクの状態を変更する',
    'memo.read': 'メモを見る',
    'memo.create': 'メモを追加する',
    'memo.update': 'メモを変更する',
    'memo.delete': 'メモを削除する',
    'memo.attach': 'メモにファイルを添付する',
    'expense.read': '家計を見る',
    'expense.create': '支出を追加する',
    'expense.settle': '精算を記録する',
    'insight.read': '暮らしのヒントを見る',
    'resource.read': '関連リンクを見る',
    'settings.own': '自分の設定を変更する',
    'notification.manage': '通知を管理する',
  } satisfies Record<Capability, string>,
  actions: {
    add: '追加する',
    cancel: 'キャンセル',
    close: '閉じる',
    delete: '削除する',
    edit: '編集する',
    open: '開く',
    restore: '元に戻す',
    retry: 'もう一度試す',
    saveChanges: '変更を保存',
    saving: '保存中…',
  },
  states: {
    loading: '読み込み中',
    noDueDate: '期限なし',
    unread: '未読',
  },
  errors: {
    UNAUTHENTICATED: 'サインインの有効期限が切れました。もう一度サインインしてください。',
    FORBIDDEN: 'この操作は利用できません。',
    NOT_FOUND: '指定された情報を表示できません。',
    REAUTH_REQUIRED: '続けるには、もう一度本人確認が必要です。',
    INVALID_INPUT: '入力内容を確認してください。',
    CONFLICT: 'ほかの端末で内容が変更されました。最新の内容を確認してください。',
    OFFLINE: 'インターネットに接続できません。',
    RATE_LIMITED: '短時間に操作が集中しました。しばらく待ってから、もう一度お試しください。',
    UPSTREAM_FAILURE: '現在、一部の情報を取得できません。しばらくしてから、もう一度お試しください。',
    ATTACHMENT_REJECTED: 'このファイルは添付できません。形式とサイズを確認してください。',
  } satisfies Record<GatewayError['code'], string>,
};

export const roleLabels = ja.roles;
export const membershipStatusLabels = ja.membershipStatus;
export const taskStatusLabels = ja.taskStatus;
export const attachmentStatusLabels = ja.attachmentStatus;
export const notificationStatusLabels = ja.notificationStatus;

export function recurrenceLabel(kind: 'event' | 'task', scope: RecurrenceScope): string {
  return ja.recurrence[kind][scope];
}

export function externalLinkLabel(label: string): string {
  return `${label}を開く（新しいタブ）`;
}

export function errorGuidance(error: GatewayError): string {
  if (error.code === 'OFFLINE') return '入力した内容は残っています。接続を確認してから、もう一度お試しください。';
  if (error.code === 'CONFLICT') return '最新の内容を確認してから、もう一度変更してください。';
  if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') return '必要な場合は、管理者に共有設定を確認してください。';
  if (error.retryable) return '入力した内容は残っています。しばらくしてから、もう一度お試しください。';
  return '表示された項目を確認して、入力内容を修正してください。';
}
