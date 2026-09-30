import type { HouseholdNotification, HouseholdSnapshot, Insight, NotificationPreferences, PrivacySettings, SecurityOverview } from '../domain/types';

export const fixedNow = '2026-09-30T07:30:00+09:00';

export const baseSnapshot: HouseholdSnapshot = {
  user: { id: 'user-aoi', displayName: '碧', email: 'aoi@example.test', avatarTone: 'indigo' },
  household: { id: 'house-mori', name: '森さんち', timezone: 'Asia/Tokyo' },
  memberships: [
    { id: 'member-aoi', householdId: 'house-mori', userId: 'user-aoi', displayName: '碧', role: 'owner', status: 'active', color: '#315c80', version: 1 },
    { id: 'member-ren', householdId: 'house-mori', userId: 'user-ren', displayName: '蓮', role: 'adult', status: 'active', color: '#a94f38', version: 1 },
    { id: 'member-hana', householdId: 'house-mori', userId: 'user-hana', displayName: '花', role: 'child', status: 'active', color: '#6f7552', version: 1 },
    { id: 'member-sora', householdId: 'house-mori', userId: 'user-sora', displayName: '空', role: 'child', status: 'active', color: '#8a6680', version: 1 },
  ],
  events: [
    { id: 'event-school', householdId: 'house-mori', title: '花｜学校公開', startsAt: '2026-09-30T09:30:00+09:00', endsAt: '2026-09-30T11:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-aoi', participantMembershipIds: ['member-aoi', 'member-hana'], location: '青葉小学校', resourceIds: ['resource-school'], note: '上履きと来校証を忘れずに', version: 1 },
    { id: 'event-piano', householdId: 'house-mori', title: '空｜ピアノ', startsAt: '2026-09-30T16:30:00+09:00', endsAt: '2026-09-30T17:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-ren', participantMembershipIds: ['member-sora'], location: '三宿音楽教室', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=WE', timezone: 'Asia/Tokyo', exceptions: [] }, version: 1 },
    { id: 'event-clean', householdId: 'house-mori', title: '資源回収', startsAt: '2026-10-01T08:00:00+09:00', endsAt: '2026-10-01T08:30:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-aoi', participantMembershipIds: ['member-aoi', 'member-ren'], recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH', timezone: 'Asia/Tokyo', exceptions: [] }, version: 1 },
    { id: 'event-park', householdId: 'house-mori', title: '週末の公園', startsAt: '2026-10-03T10:00:00+09:00', endsAt: '2026-10-03T12:00:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'member-ren', participantMembershipIds: ['member-aoi','member-ren','member-hana','member-sora'], weatherSensitive: true, version: 1 },
  ],
  todos: [
    { id: 'todo-form', householdId: 'house-mori', title: '就学援助の確認票', dueAt: '2026-09-30T20:00:00+09:00', status: 'review', assigneeMembershipId: 'member-aoi', reviewerMembershipId: 'member-ren', creatorMembershipId: 'member-aoi', version: 2, note: '記入済み。提出前の確認をお願いします。' },
    { id: 'todo-library', householdId: 'house-mori', title: '図書館の本を返す', dueAt: '2026-09-30T18:00:00+09:00', status: 'doing', assigneeMembershipId: 'member-aoi', creatorMembershipId: 'member-ren', version: 1 },
    { id: 'todo-garbage', householdId: 'house-mori', title: '資源ごみをまとめる', dueAt: '2026-10-01T07:30:00+09:00', status: 'open', assigneeMembershipId: 'member-ren', creatorMembershipId: 'member-aoi', version: 1, recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=WE', timezone: 'Asia/Tokyo', exceptions: [] } },
    { id: 'todo-practice', householdId: 'house-mori', title: '音読の記録', dueAt: '2026-09-30T19:30:00+09:00', status: 'open', assigneeMembershipId: 'member-hana', reviewerMembershipId: 'member-aoi', creatorMembershipId: 'member-aoi', version: 1 },
    { id: 'todo-done', householdId: 'house-mori', title: '給食費の口座確認', status: 'done', assigneeMembershipId: 'member-ren', reviewerMembershipId: 'member-aoi', creatorMembershipId: 'member-ren', version: 3 },
  ],
  memos: [
    { id: 'memo-school', householdId: 'house-mori', title: '学校公開のお知らせ', body: '受付 9:15〜。来校証を着用。撮影は教室外のみ。', updatedAt: '2026-09-29T21:10:00+09:00', authorMembershipId: 'member-aoi', tags: ['学校', '今週'], attachments: [{ id: 'attachment-school', memoId: 'memo-school', originalName: '学校公開.pdf', mimeType: 'application/pdf', byteSize: 842310, status: 'clean', statusMessage: '検査済み・閲覧できます' }], ocrText: '令和8年度 学校公開のお知らせ…' },
    { id: 'memo-clinic', householdId: 'house-mori', title: '小児科の控え', body: '次回は10月14日。保険証を持参。', updatedAt: '2026-09-28T18:40:00+09:00', authorMembershipId: 'member-ren', tags: ['控え'], attachments: [] },
    { id: 'memo-receipt', householdId: 'house-mori', title: '教材費レシート', body: '家計への登録待ち。', updatedAt: '2026-09-30T06:50:00+09:00', authorMembershipId: 'member-aoi', tags: ['家計'], attachments: [{ id: 'attachment-receipt', memoId: 'memo-receipt', originalName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1284300, status: 'quarantined', statusMessage: '安全確認中です。結果が出るまで開けません' }], ocrText: '青葉書店　教材 2,860円' },
  ],
  expenses: [
    { id: 'expense-books', householdId: 'house-mori', title: '学校教材', amountJpy: 2860, incurredOn: '2026-09-29', payerMembershipId: 'member-aoi', category: 'education', shares: [{ membershipId: 'member-aoi', amountJpy: 1430, settledJpy: 1430 }, { membershipId: 'member-ren', amountJpy: 1430, settledJpy: 0 }], settlements: [], note: '花の図工・理科教材' },
    { id: 'expense-train', householdId: 'house-mori', title: '家族のおでかけ交通費', amountJpy: 3360, incurredOn: '2026-09-27', payerMembershipId: 'member-ren', category: 'transport', shares: [{ membershipId: 'member-aoi', amountJpy: 1680, settledJpy: 0 }, { membershipId: 'member-ren', amountJpy: 1680, settledJpy: 1680 }], settlements: [] },
    { id: 'expense-groceries', householdId: 'house-mori', title: '週末の食材', amountJpy: 5840, incurredOn: '2026-09-26', payerMembershipId: 'member-aoi', category: 'food', shares: [{ membershipId: 'member-aoi', amountJpy: 2920, settledJpy: 2920 }, { membershipId: 'member-ren', amountJpy: 2920, settledJpy: 2920 }], settlements: [{ id: 'settlement-1', amountJpy: 2920, fromMembershipId: 'member-ren', toMembershipId: 'member-aoi', recordedAt: '2026-09-28T20:00:00+09:00' }] },
  ],
  resources: [
    { id: 'resource-school', householdId: 'house-mori', label: '青葉小学校 保護者ページ', url: 'https://example.com/family-hub/school', kind: 'school', relatedEntityId: 'event-school' },
    { id: 'resource-city', householdId: 'house-mori', label: '世田谷区 子育て手続き', url: 'https://example.com/family-hub/city', kind: 'municipality' },
    { id: 'resource-guide', householdId: 'house-mori', label: '家族の連絡ルール', url: 'https://example.com/family-hub/guide', kind: 'document' },
  ],
  context: {
    asOf: fixedNow,
    timezone: 'Asia/Tokyo',
    weather: { condition: 'rain', temperatureC: 22, precipitationPercent: 70, alert: '15時ごろから雨脚が強まる見込み' },
    holidays: [{ date: '2026-10-12', name: 'スポーツの日' }],
    sync: { state: 'synced', lastSyncedAt: '2026-09-30T07:29:00+09:00' },
  },
};

export const insights: Insight[] = [
  { id: 'insight-weather', title: '週末の公園は雨の可能性', summary: '土曜10時の降水確率は80%です。予定の判断材料として確認してください。', evidence: '気象コンテキスト｜9月30日 7:30取得', actionLabel: '予定を確認', destination: '/calendar/event-park', confidence: 'medium' },
  { id: 'insight-review', title: '提出前レビューが1件', summary: '「就学援助の確認票」は蓮さんの確認待ちです。自動提出はしません。', evidence: 'Todoの状態｜担当: 碧・確認: 蓮', actionLabel: 'Todoを開く', destination: '/tasks/todo-form', confidence: 'high' },
  { id: 'insight-settle', title: '未精算は合計3,110円', summary: '学校教材と交通費の記録から算出しています。精算の記録は取り消せます。', evidence: '支出2件の未精算分｜端数なし', actionLabel: '内訳を見る', destination: '/budget', confidence: 'high' },
];

export const baseSecurityOverview: SecurityOverview = {
  authenticators: [{ id: 'authenticator-macbook', label: 'MacBook', createdAt: '2026-09-28T18:00:00+09:00', kind: 'passkey', demo: true }],
  sessions: [
    { id: 'session-current', label: 'このブラウザ', location: '東京', lastSeenAt: fixedNow, current: true },
    { id: 'session-iphone', label: 'iPhone Safari', location: '東京', lastSeenAt: '2026-09-30T05:30:00+09:00', current: false },
  ],
};

export const baseNotifications: HouseholdNotification[] = [
  { id: 'notification-library', title: '図書館の本を返す', body: '18:00まで · 担当は碧さんです', remindAt: '2026-09-30T17:30:00+09:00', read: false, status: 'active' },
];

export const baseNotificationPreferences: NotificationPreferences = { todoDue: true, eventDeparture: true, quietHours: true };
export const basePrivacySettings: PrivacySettings = { defaultAudience: 'household', hideNotificationContent: true };
