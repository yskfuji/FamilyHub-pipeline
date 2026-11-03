import type { EventCandidate, ReceiptProposal } from '../domain/assistant';
import { capabilitiesFor } from '../authz/policy';
import type { Album, AlbumItem, Expense, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, NotificationPreferences, PrivacySettings, SecurityOverview, VisibilityPolicy } from '../domain/types';

export const fixedNow = '2026-09-30T07:30:00+09:00';
const visibleTo = (creatorMembershipId: string, audience: VisibilityPolicy['audience'] = 'household', selectedMembershipIds: string[] = []): VisibilityPolicy => ({ audience, creatorMembershipId, selectedMembershipIds });

/** 確認用の読み取りが返す見本。実際の画像やページは読まない。 */
export const sampleReceipt: ReceiptProposal = { amountJpy: 2480, date: '2026-09-29', merchant: '見本スーパー 青葉店', category: 'food' };
export const sampleEventCandidates: EventCandidate[] = [
  { title: '見本の区民まつり', date: '2026-10-27', startTime: '10:00', endTime: '15:30', allDay: false, location: '中央公園' },
  { title: '見本の区民まつり（予備日）', date: '2026-11-03', startTime: null, endTime: null, allDay: true, location: null },
];

export const baseSnapshot: HouseholdSnapshot = {
  viewer: { userId: 'user-aoi', membershipId: 'member-aoi', role: 'owner', status: 'active', capabilities: capabilitiesFor('owner'), permissionRevision: 1 },
  permissionOverrides: [],
  user: { id: 'user-aoi', displayName: '碧', email: 'aoi@example.test', avatarTone: 'indigo' },
  household: { id: 'house-mori', name: '森さんち', timezone: 'Asia/Tokyo' },
  memberships: [
    { id: 'member-aoi', householdId: 'house-mori', userId: 'user-aoi', displayName: '碧', role: 'owner', status: 'active', color: '#315c80', version: 1 },
    { id: 'member-ren', householdId: 'house-mori', userId: 'user-ren', displayName: '蓮', role: 'adult', status: 'active', color: '#a94f38', version: 1 },
    { id: 'member-hana', householdId: 'house-mori', userId: 'user-hana', displayName: '花', role: 'child', status: 'active', color: '#6f7552', version: 1 },
    { id: 'member-sora', householdId: 'house-mori', userId: 'user-sora', displayName: '空', role: 'child', status: 'active', color: '#8a6680', version: 1 },
    { id: 'member-yui', householdId: 'house-mori', userId: 'user-yui', displayName: '結衣', role: 'guest', status: 'active', color: '#796a55', version: 1 },
  ],
  events: [
    { id: 'event-school', householdId: 'house-mori', title: '学校公開', startsAt: '2026-09-30T09:30:00+09:00', endsAt: '2026-09-30T11:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-aoi', participantMembershipIds: ['member-aoi', 'member-hana'], location: '青葉小学校', resourceIds: ['resource-school'], note: '上履きと来校証を忘れずに', version: 1, visibility: visibleTo('member-aoi', 'participants') },
    { id: 'event-piano', householdId: 'house-mori', title: 'ピアノ', startsAt: '2026-09-30T16:30:00+09:00', endsAt: '2026-09-30T17:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-ren', participantMembershipIds: ['member-sora'], location: '三宿音楽教室', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=WE', timezone: 'Asia/Tokyo', exceptions: [] }, version: 1, visibility: visibleTo('member-ren', 'participants') },
    { id: 'event-clean', householdId: 'house-mori', title: '資源回収', startsAt: '2026-10-01T08:00:00+09:00', endsAt: '2026-10-01T08:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-aoi', participantMembershipIds: ['member-aoi', 'member-ren'], recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH', timezone: 'Asia/Tokyo', exceptions: [] }, version: 1, visibility: visibleTo('member-aoi') },
    { id: 'event-park', householdId: 'house-mori', title: '週末の公園', startsAt: '2026-10-03T10:00:00+09:00', endsAt: '2026-10-03T12:00:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-ren', participantMembershipIds: ['member-aoi','member-ren','member-hana','member-sora'], weatherSensitive: true, version: 1, visibility: visibleTo('member-ren', 'selected', ['member-aoi','member-ren','member-hana','member-sora','member-yui']) },
  ],
  todos: [
    { id: 'todo-form', householdId: 'house-mori', title: '就学援助の確認票', dueAt: '2026-09-30T20:00:00+09:00', status: 'review', assigneeMembershipId: 'member-aoi', reviewerMembershipId: 'member-ren', creatorMembershipId: 'member-aoi', version: 2, note: '記入済み。提出前の確認をお願いします。', visibility: visibleTo('member-aoi', 'participants') },
    { id: 'todo-library', householdId: 'house-mori', title: '図書館の本を返す', dueAt: '2026-09-30T18:00:00+09:00', status: 'doing', assigneeMembershipId: 'member-aoi', creatorMembershipId: 'member-ren', version: 1, visibility: visibleTo('member-ren', 'participants') },
    { id: 'todo-garbage', householdId: 'house-mori', title: '資源ごみをまとめる', dueAt: '2026-10-01T07:30:00+09:00', status: 'open', assigneeMembershipId: 'member-ren', creatorMembershipId: 'member-aoi', version: 1, recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH', timezone: 'Asia/Tokyo', exceptions: [] }, visibility: visibleTo('member-aoi', 'adults') },
    { id: 'todo-practice', householdId: 'house-mori', title: '音読の記録', dueAt: '2026-09-30T19:30:00+09:00', status: 'open', assigneeMembershipId: 'member-hana', reviewerMembershipId: 'member-aoi', creatorMembershipId: 'member-aoi', version: 1, visibility: visibleTo('member-aoi', 'participants') },
    { id: 'todo-done', householdId: 'house-mori', title: '給食費の口座確認', status: 'done', assigneeMembershipId: 'member-ren', reviewerMembershipId: 'member-aoi', creatorMembershipId: 'member-ren', version: 3, visibility: visibleTo('member-ren', 'adults') },
  ],
  memos: [
    { id: 'memo-school', householdId: 'house-mori', title: '学校公開のお知らせ', body: '受付 9:15〜。来校証を着用。撮影は教室外のみ。', updatedAt: '2026-09-29T21:10:00+09:00', authorMembershipId: 'member-aoi', tags: ['学校', '今週'], attachments: [{ id: 'attachment-school', memoId: 'memo-school', originalName: '学校公開.pdf', mimeType: 'application/pdf', byteSize: 842310, status: 'clean', statusMessage: '確認が終わり、開ける状態です' }], ocrText: '令和8年度 学校公開のお知らせ…', place: { name: '青葉小学校 体育館', capturedVia: 'manual', selectedAt: '2026-09-29T21:10:00+09:00' }, visibility: visibleTo('member-aoi', 'selected', ['member-aoi','member-ren','member-hana']), version: 1 },
    { id: 'memo-clinic', householdId: 'house-mori', title: '小児科の控え', body: '次回は10月14日。保険証を持参。', updatedAt: '2026-09-28T18:40:00+09:00', authorMembershipId: 'member-ren', tags: ['控え'], attachments: [], visibility: visibleTo('member-ren', 'adults'), version: 1 },
    { id: 'memo-receipt', householdId: 'house-mori', title: '教材費レシート', body: '家計への登録待ち。', updatedAt: '2026-09-30T06:50:00+09:00', authorMembershipId: 'member-aoi', tags: ['家計'], attachments: [{ id: 'attachment-receipt', memoId: 'memo-receipt', originalName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1284300, status: 'quarantined', statusMessage: 'ファイルを確認しています。完了するまで開けません' }, { id: 'attachment-receipt-photo', memoId: 'memo-receipt', originalName: '教材の写真.jpg', mimeType: 'image/jpeg', byteSize: 2259, status: 'clean', statusMessage: '確認が終わり、開ける状態です' }, { id: 'attachment-receipt-clip', memoId: 'memo-receipt', originalName: '教材の使い方.mp4', mimeType: 'video/mp4', byteSize: 2836, status: 'clean', statusMessage: '確認が終わり、開ける状態です' }], ocrText: '青葉書店　教材 2,860円', visibility: visibleTo('member-aoi', 'adults'), version: 1 },
  ],
  expenses: [
    { id: 'expense-books', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-aoi', visibility: visibleTo('member-aoi'), title: '学校教材', amountJpy: 2860, incurredOn: '2026-09-29', payerMembershipId: 'member-aoi', category: 'education', shares: [{ membershipId: 'member-aoi', amountJpy: 1430, settledJpy: 1430 }, { membershipId: 'member-ren', amountJpy: 1430, settledJpy: 0 }], settlements: [], note: '花の図工・理科教材', place: { name: '青葉書店', address: '東京都世田谷区', capturedVia: 'manual', selectedAt: '2026-09-29T18:20:00+09:00' }, version: 1 },
    { id: 'expense-train', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-aoi', visibility: visibleTo('member-aoi'), title: '家族のおでかけ交通費', amountJpy: 3360, incurredOn: '2026-09-27', payerMembershipId: 'member-ren', category: 'transport', shares: [{ membershipId: 'member-aoi', amountJpy: 1680, settledJpy: 0 }, { membershipId: 'member-ren', amountJpy: 1680, settledJpy: 1680 }], settlements: [], version: 1 },
    { id: 'expense-groceries', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-aoi', visibility: visibleTo('member-aoi'), title: '週末の食材', amountJpy: 5840, incurredOn: '2026-09-26', payerMembershipId: 'member-aoi', category: 'food', shares: [{ membershipId: 'member-aoi', amountJpy: 2920, settledJpy: 2920 }, { membershipId: 'member-ren', amountJpy: 2920, settledJpy: 2920 }], settlements: [{ id: 'settlement-1', amountJpy: 2920, fromMembershipId: 'member-ren', toMembershipId: 'member-aoi', recordedAt: '2026-09-28T20:00:00+09:00' }], version: 1 },
    { id: 'income-salary', householdId: 'house-mori', kind: 'income', creatorMembershipId: 'member-aoi', visibility: visibleTo('member-aoi'), title: '9月の給与', amountJpy: 320000, incurredOn: '2026-09-25', payerMembershipId: 'member-aoi', category: 'income_salary', shares: [], settlements: [], version: 1 },
    { id: 'expense-august-utilities', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-ren', visibility: visibleTo('member-ren'), title: '8月の電気代', amountJpy: 9800, incurredOn: '2026-08-20', payerMembershipId: 'member-ren', category: 'utilities', shares: [{ membershipId: 'member-ren', amountJpy: 9800, settledJpy: 9800 }], settlements: [], version: 1 },
  ],
  settlementBatches: [],
  resources: [
    { id: 'resource-school', householdId: 'house-mori', label: '青葉小学校の保護者向けページ', url: 'https://example.com/family-hub/school', kind: 'school', relatedEntityId: 'event-school', visibility: visibleTo('member-aoi', 'selected', ['member-aoi','member-ren','member-hana','member-yui']) },
    { id: 'resource-city', householdId: 'house-mori', label: '世田谷区の子育て手続き', url: 'https://example.com/family-hub/city', kind: 'municipality', visibility: visibleTo('member-aoi') },
    { id: 'resource-guide', householdId: 'house-mori', label: '家族の連絡ルール', url: 'https://example.com/family-hub/guide', kind: 'document', visibility: visibleTo('member-aoi', 'selected', ['member-aoi','member-ren','member-hana','member-sora','member-yui']) },
  ],
  links: [
    { id: 'link-school', householdId: 'house-mori', from: { kind: 'event', id: 'event-school' }, to: { kind: 'memo', id: 'memo-school' }, createdByMembershipId: 'member-aoi', createdAt: '2026-09-29T21:12:00+09:00' },
  ],
  colorLabels: [
    { id: 'label-school', householdId: 'house-mori', name: '学校', color: '#315c80' },
    { id: 'label-home', householdId: 'house-mori', name: '家のこと', color: '#6f7552' },
    { id: 'label-lesson', householdId: 'house-mori', name: '習いごと', color: '#a94f38' },
  ],
  context: {
    asOf: fixedNow,
    timezone: 'Asia/Tokyo',
    weather: { location: '東京', condition: 'rain', temperatureC: 22, precipitationPercent: 70, alert: '15時ごろから雨脚が強まる見込み' },
    holidays: [{ date: '2026-10-12', name: 'スポーツの日' }],
    sync: { state: 'synced', lastSyncedAt: '2026-09-30T07:29:00+09:00' },
  },
};

/**
 * 蓮さんだけが見られる支出。碧さんは負担する人や支払った人に入っていても、見ることも変えることもできない。
 * 確認用データと試験の家族にだけ入れる。集計の試験は baseSnapshot の支出だけを使う。
 */
export const restrictedExpenses: Expense[] = [
  { id: 'expense-ren-private', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-ren', visibility: visibleTo('member-ren', 'creator'), title: '贈り物の下見', amountJpy: 3000, incurredOn: '2026-09-28', payerMembershipId: 'member-ren', category: 'other', shares: [{ membershipId: 'member-aoi', amountJpy: 1500, settledJpy: 500 }, { membershipId: 'member-ren', amountJpy: 1500, settledJpy: 1500 }], settlements: [{ id: 'settlement-private', amountJpy: 500, fromMembershipId: 'member-aoi', toMembershipId: 'member-ren', recordedAt: '2026-09-29T08:00:00+09:00' }], version: 1 },
  { id: 'expense-ren-deleted', householdId: 'house-mori', kind: 'expense', creatorMembershipId: 'member-ren', visibility: visibleTo('member-ren', 'creator'), title: '取り消した下見', amountJpy: 800, incurredOn: '2026-09-28', payerMembershipId: 'member-aoi', category: 'other', shares: [{ membershipId: 'member-aoi', amountJpy: 800, settledJpy: 800 }], settlements: [], deletedAt: '2026-09-29T20:00:00+09:00', version: 2 },
];

/** 成人を申告した利用者。管理者にできるのはこの人たちだけ。試験の家族（server/testing/seed.ts）も同じ一覧を使う。 */
export const adultDeclaredUsers: readonly string[] = ['user-aoi', 'user-ren'];

/** 確認用データと試験の家族に入れる記録の全体。 */
export const seededSnapshot = (): HouseholdSnapshot => ({ ...structuredClone(baseSnapshot), expenses: structuredClone([...baseSnapshot.expenses, ...restrictedExpenses]) });

export const baseSecurityOverview: SecurityOverview = {
  authenticators: [{ id: 'authenticator-macbook', label: 'MacBook', createdAt: '2026-09-28T18:00:00+09:00', kind: 'passkey', demo: true }],
  sessions: [
    { id: 'session-current', label: 'このブラウザ', location: '東京', lastSeenAt: fixedNow, current: true },
    { id: 'session-iphone', label: 'iPhone Safari', location: '東京', lastSeenAt: '2026-09-30T05:30:00+09:00', current: false },
  ],
};

export const baseNotifications: HouseholdNotification[] = [
  { id: 'notification-library', kind: 'todoDue', destination: '/tasks/todo-library', title: '図書館の本を返す', body: '18:00まで・担当：碧さん', remindAt: '2026-09-30T17:30:00+09:00', read: false, status: 'active' },
  { id: 'notification-school', kind: 'eventDeparture', destination: '/calendar/event-school', title: '学校公開に出発', body: '9:30開始・青葉小学校', remindAt: '2026-09-30T09:00:00+09:00', read: true, status: 'active' },
];

/** 確認用の有効な招待（1回だけ使える、24時間有効）。初期設定の「招待コードで参加」を試すためのもの。 */
export const baseInvites: HouseholdInvite[] = [
  { id: 'invite-demo', householdId: 'house-mori', role: 'adult', token: 'FAMILY-2026-DEMO-0001', expiresAt: '2026-10-01T07:30:00+09:00', remainingUses: 1 },
];

export const baseNotificationPreferences: NotificationPreferences = { todoDue: true, eventDeparture: true, quietHours: true };
export const basePrivacySettings: PrivacySettings = { defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null };

export const baseAlbums: Album[] = [
  { id: 'album-sports', householdId: 'house-mori', title: '運動会', description: '花の徒競走とお弁当', coverItemId: 'item-sports-1', place: { name: '青葉小学校 校庭', capturedVia: 'manual', selectedAt: '2026-09-20T17:00:00+09:00' }, bgmPreset: 'bright', creatorMembershipId: 'member-aoi', visibility: visibleTo('member-aoi', 'selected', ['member-aoi', 'member-ren', 'member-hana', 'member-sora']), createdAt: '2026-09-20T17:00:00+09:00', version: 1 },
  { id: 'album-park', householdId: 'house-mori', title: '週末の公園', creatorMembershipId: 'member-ren', visibility: visibleTo('member-ren', 'adults'), createdAt: '2026-09-13T12:00:00+09:00', version: 1 },
];

/** 撮影日時は、時差つきの EXIF（exif-offset）と、時差のない EXIF を家族の時間帯で読んだもの（exif-local）を混ぜる。 */
const fixtureItem = (id: string, albumId: string, position: number, uploaderMembershipId: string, takenAt: string, takenAtSource: AlbumItem['takenAtSource']): AlbumItem => ({ id, albumId, householdId: 'house-mori', kind: 'photo', originalName: `${id}.jpg`, mimeType: 'image/jpeg', byteSize: 2_400_000 + position * 1000, width: 1600, height: 1200, takenAt, takenAtSource, status: 'ready', locationKept: false, hasThumbnail: true, uploaderMembershipId, position, createdAt: '2026-09-20T17:00:00+09:00' });

export const baseAlbumItems: AlbumItem[] = [
  fixtureItem('item-sports-1', 'album-sports', 0, 'member-aoi', '2026-09-20T09:12:30+09:00', 'exif-offset'),
  fixtureItem('item-sports-2', 'album-sports', 1, 'member-aoi', '2026-09-20T10:05:00+09:00', 'exif-local'),
  fixtureItem('item-sports-3', 'album-sports', 2, 'member-ren', '2026-09-20T11:40:12+09:00', 'exif-offset'),
  fixtureItem('item-park-1', 'album-park', 0, 'member-ren', '2026-09-13T10:20:00+09:00', 'exif-offset'),
];
