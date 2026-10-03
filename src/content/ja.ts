import type {
  AttachmentStatus,
  Capability,
  GatewayError,
  HouseholdMembership,
  HouseholdNotification,
  MembershipRole,
  PlaceCaptureSource,
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
    'place.read': '記録した場所を見る・付ける',
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
  place: {
    legend: '場所',
    add: '場所を追加（任意）',
    change: '場所を変更',
    remove: '場所を外す',
    sourceSwitcher: '場所の探し方',
    sources: {
      device: '現在地',
      photo: '写真から',
      search: '名前で探す',
      manual: '手入力',
    } satisfies Record<PlaceCaptureSource, string>,
    recordedVia: {
      device: '現在地の近くから選択',
      photo: '写真の位置の近くから選択',
      search: '名前で検索して選択',
      manual: '手入力',
    } satisfies Record<PlaceCaptureSource, string>,
    transmission: '近くのお店は外部の検索サービス（OpenPOI API）で探します。送るのは約100m単位に丸めた位置か検索語だけで、写真は送信しません。',
    consent: {
      title: '外部の検索サービスを使います',
      points: [
        '送信先: OpenPOI API（日本国内のお店や施設のデータ）',
        '送る内容: 約100m単位に丸めた位置、または入力した検索語。通信の仕組み上、IPアドレスとブラウザの種類も相手に届きます。',
        '送らないもの: 正確な現在地、写真そのもの、名前やメールアドレス',
        '送信先は受け取った情報を記録すると公表しており、保存期間は示されていません。',
      ],
      accept: '同意して続ける',
      decline: '手入力にする',
      revokeHint: '同意は「設定」の「位置情報」からいつでもやめられます。',
    },
    device: {
      action: '現在地から探す',
      busy: '現在地を確認しています…',
      help: 'ボタンを押すと、端末が位置情報の利用を確認します。正確な現在地は端末の中だけで使います。',
    },
    photo: {
      action: '写真を選ぶ',
      input: '位置を読み取る写真を選択',
      busy: '写真の位置情報を読み取っています…',
      help: '写真に記録された位置情報だけを端末の中で読み取ります。写真そのものは送信も保存もしません。',
      takenAt: '撮影日時',
    },
    search: {
      label: 'お店や場所の名前',
      help: '例: スーパー、ドラッグストア、お店の名前。入力を確定してから検索します。',
      submit: '検索',
      busy: '検索しています…',
    },
    manual: {
      name: '場所の名前',
      address: '住所（任意）',
      apply: 'この場所にする',
    },
    resultCount: (count: number) => `${count}件の候補があります。近い順に並べています。`,
    searchResultCount: (count: number) => `${count}件の候補があります。`,
    approximate: '位置の誤差が大きめのため、候補が実際の場所とずれている可能性があります。',
    nationwide: '近くでは見つからなかったため、全国から探した結果です。',
    empty: {
      device: '近くに候補が見つかりませんでした。名前で探すか、手入力してください。',
      photo: '写真の位置の近くに候補が見つかりませんでした。名前で探すか、手入力してください。',
      search: '該当する場所が見つかりませんでした。別の言葉で探すか、手入力してください。',
    },
    failures: {
      'geo-unsupported': 'この端末やブラウザでは現在地を使えません。名前で探すか、手入力してください。',
      'geo-denied': '位置情報の利用が許可されていません。端末やブラウザの設定で許可するか、名前で探してください。',
      'geo-unavailable': '現在地を特定できませんでした。屋外や窓の近くでもう一度試すか、名前で探してください。',
      'geo-timeout': '現在地の確認に時間がかかっています。もう一度探すか、名前で探してください。',
      'geo-coarse': 'おおよその位置しか分からないため、近くの候補を出せません。iPhoneでは位置情報の設定で「正確な位置情報」がオフになっている可能性があります。名前で探してください。',
      'photo-unsupported': 'この形式の写真からは位置情報を読み取れません。JPEGまたはHEICの写真を選んでください。',
      'photo-too-large': '写真が大きすぎます。30MB以内の写真を選んでください。',
      'photo-no-gps': 'この写真には位置情報が残っていません。iPhoneでは写真を選ぶ画面の「オプション」で位置情報を含められます。カメラで撮ってすぐ選んだ写真や、多くのAndroid端末では位置情報が取り除かれます。',
      'photo-malformed': '写真の情報を読み取れませんでした。別の写真を選んでください。',
      OFFLINE: 'インターネットに接続できないため検索できません。手入力なら記録できます。',
      RATE_LIMITED: '検索が混み合っています。しばらく待ってから、もう一度探してください。',
      UPSTREAM_FAILURE: '場所の検索サービスから応答がありません。時間をおいて探すか、手入力してください。',
      'consent-failed': '同意を記録できませんでした。もう一度お試しください。',
    },
    collapse: {
      keep: '場所を変えずに戻る',
      skip: '場所を付けずに戻る',
    },
    retry: 'もう一度探す',
    switchToSearch: '名前で探す',
    switchToManual: '手入力にする',
    selected: (name: string) => `「${name}」を場所に設定しました。`,
    removed: '場所を外しました。',
    attributionPrefix: '出典',
    attributionLabel: 'OpenPOI API',
    categories: {
      restaurant: '飲食店',
      bar_izakaya: '居酒屋・バー',
      cafe: 'カフェ',
      bakery: 'パン屋',
      grocery: '食料品店',
      supermarket: 'スーパー',
      convenience_store: 'コンビニ',
      drugstore: 'ドラッグストア',
      pharmacy: '薬局',
      retail_other: 'お店',
      service_other: 'サービス',
      medical: '医療機関',
      public_facility: '公共施設',
      education: '教育施設',
      tourism: '観光',
    } as Record<string, string>,
    settings: {
      tab: '位置情報',
      title: '位置情報と外部への送信',
      description: '支出やメモに場所を付けるときの、位置情報の使い方と外部への送信についての説明です。',
      rows: [
        ['送信先', 'OpenPOI API（日本国内のお店や施設のデータを提供する外部サービス）'],
        ['送る内容', '約100m単位に丸めた位置、または入力した検索語。通信の仕組み上、IPアドレス、ブラウザの種類、このアプリのアドレスも届きます。'],
        ['目的', '近くのお店や場所の候補を表示するため'],
        ['送信先での扱い', '送信先は、アクセス元の情報とリクエストの内容を取得すると公表しています。保存期間は公表されていません。サービスは予告なく変更・終了することがあります。'],
        ['送らないもの', '正確な現在地、写真そのものと写真のほかの情報、名前やメールアドレス'],
        ['記録するもの', '選んだ場所の名前・住所・場所の座標・出典だけです。現在地は記録しません。'],
        ['見られる人', '管理者と大人のメンバーだけです。子どもメンバーとゲストには表示しません。'],
      ] as Array<[string, string]>,
      consentLabel: '外部の検索サービスを使う',
      consentOn: '同意しています',
      consentOff: '同意していません',
      consentGranted: '外部の検索サービスの利用に同意しました。',
      consentRevoked: '外部の検索サービスの利用をやめました。記録済みの場所は残ります。',
      revokeNote: '同意をやめても、記録済みの場所は消えません。手入力はいつでも使えます。',
      terms: '送信先の利用規約',
      attribution: '出典と権利表示',
    },
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

export function placeDistanceLabel(meters: number): string {
  if (meters < 30) return 'すぐ近く';
  const tens = Math.round(meters / 10) * 10;
  if (tens < 1000) return `約${tens}m`;
  return `約${(meters / 1000).toFixed(1)}km`;
}

export function placeCategoryLabel(category?: string): string | undefined {
  return category && Object.hasOwn(ja.place.categories, category) ? ja.place.categories[category] : undefined;
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
