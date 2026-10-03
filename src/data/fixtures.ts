import { capabilitiesFor } from '../authz/policy';
import type { HouseholdInvite, HouseholdNotification, HouseholdSnapshot, NotificationPreferences, PrivacySettings, SecurityOverview, VisibilityPolicy } from '../domain/types';

export const fixedNow = '2026-09-30T07:30:00+09:00';
const visibleTo = (creatorMembershipId: string, audience: VisibilityPolicy['audience'] = 'household', selectedMembershipIds: string[] = []): VisibilityPolicy => ({ audience, creatorMembershipId, selectedMembershipIds });

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
    { id: 'memo-receipt', householdId: 'house-mori', title: '教材費レシート', body: '家計への登録待ち。', updatedAt: '2026-09-30T06:50:00+09:00', authorMembershipId: 'member-aoi', tags: ['家計'], attachments: [{ id: 'attachment-receipt', memoId: 'memo-receipt', originalName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1284300, status: 'quarantined', statusMessage: 'ファイルを確認しています。完了するまで開けません' }], ocrText: '青葉書店　教材 2,860円', visibility: visibleTo('member-aoi', 'adults'), version: 1 },
  ],
  expenses: [
    { id: 'expense-books', householdId: 'house-mori', title: '学校教材', amountJpy: 2860, incurredOn: '2026-09-29', payerMembershipId: 'member-aoi', category: 'education', shares: [{ membershipId: 'member-aoi', amountJpy: 1430, settledJpy: 1430 }, { membershipId: 'member-ren', amountJpy: 1430, settledJpy: 0 }], settlements: [], note: '花の図工・理科教材', place: { name: '青葉書店', address: '東京都世田谷区', capturedVia: 'manual', selectedAt: '2026-09-29T18:20:00+09:00' }, version: 1 },
    { id: 'expense-train', householdId: 'house-mori', title: '家族のおでかけ交通費', amountJpy: 3360, incurredOn: '2026-09-27', payerMembershipId: 'member-ren', category: 'transport', shares: [{ membershipId: 'member-aoi', amountJpy: 1680, settledJpy: 0 }, { membershipId: 'member-ren', amountJpy: 1680, settledJpy: 1680 }], settlements: [], version: 1 },
    { id: 'expense-groceries', householdId: 'house-mori', title: '週末の食材', amountJpy: 5840, incurredOn: '2026-09-26', payerMembershipId: 'member-aoi', category: 'food', shares: [{ membershipId: 'member-aoi', amountJpy: 2920, settledJpy: 2920 }, { membershipId: 'member-ren', amountJpy: 2920, settledJpy: 2920 }], settlements: [{ id: 'settlement-1', amountJpy: 2920, fromMembershipId: 'member-ren', toMembershipId: 'member-aoi', recordedAt: '2026-09-28T20:00:00+09:00' }], version: 1 },
  ],
  resources: [
    { id: 'resource-school', householdId: 'house-mori', label: '青葉小学校の保護者向けページ', url: 'https://example.com/family-hub/school', kind: 'school', relatedEntityId: 'event-school', visibility: visibleTo('member-aoi', 'selected', ['member-aoi','member-ren','member-hana','member-yui']) },
    { id: 'resource-city', householdId: 'house-mori', label: '世田谷区の子育て手続き', url: 'https://example.com/family-hub/city', kind: 'municipality', visibility: visibleTo('member-aoi') },
    { id: 'resource-guide', householdId: 'house-mori', label: '家族の連絡ルール', url: 'https://example.com/family-hub/guide', kind: 'document', visibility: visibleTo('member-aoi', 'selected', ['member-aoi','member-ren','member-hana','member-sora','member-yui']) },
  ],
  context: {
    asOf: fixedNow,
    timezone: 'Asia/Tokyo',
    weather: { location: '東京', condition: 'rain', temperatureC: 22, precipitationPercent: 70, alert: '15時ごろから雨脚が強まる見込み' },
    holidays: [{ date: '2026-10-12', name: 'スポーツの日' }],
    sync: { state: 'synced', lastSyncedAt: '2026-09-30T07:29:00+09:00' },
  },
};

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
