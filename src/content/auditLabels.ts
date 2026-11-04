import { AUDIT_RETENTION_MONTHS } from '../domain/auditLog';
import type { AuditGroup, AuditTargetKind } from '../domain/auditLog';

/**
 * 変更の記録に出す操作の名前。OpenAPI のすべての operationId と、運営者の命令（operator.*）、
 * 以前の版が残した名前（signIn・enableTotp）を持つ。足りなければ server/test/auditLabels.test.ts が失敗する。
 */
export const auditActionLabels: Readonly<Record<string, string>> = {
  // 運用と読み取り（記録には残らないが、名前はそろえておく）
  getHealth: '動作の確認', getReadiness: '準備の確認', getVersion: '版の確認', getCsrfToken: '送信の確認用の値の受け取り',
  getHouseholdSnapshot: '家族の記録を開いた', listRecentlyDeleted: '最近削除した項目を開いた', searchHousehold: '検索した', listInsights: '暮らしのヒントを開いた',
  getAccount: 'アカウントを開いた', getSecurityOverview: 'サインインの状況を開いた', getSession: 'サインインの状態の確認',
  getPrivacySettings: '公開の設定を開いた', getPermissionOverrides: '個別の権限を開いた', listHouseholdInvites: '招待の一覧を開いた',
  listAlbums: 'アルバムの一覧を開いた', getAlbum: 'アルバムを開いた', getAlbumItemFile: '写真・動画を開いた', getAlbumItemThumbnail: '縮小画像を開いた',
  getAttachmentLink: '添付を開くリンクを作った', getAttachmentFile: '添付を開いた', getUploadOffset: '送信の続きの確認',
  getAssistantStatus: '読み取りの補助の状態の確認', getAssistantJob: '読み取りの結果の確認',
  listNotifications: '通知を開いた', getNotificationPreferences: '通知の設定を開いた',
  listAuditEvents: '変更の記録を開いた', listAccountAuditEvents: 'アカウントの記録を開いた',
  // アカウント
  signUp: 'アカウントを作った', signInWithPassword: 'パスワードでサインインした', verifyTotp: '確認コードでサインインした', finishPasskey: 'パスキーでサインインした',
  signIn: 'サインインした', beginPasskey: 'パスキーでのサインインを始めた', signOut: 'サインアウトした',
  requestPasswordReset: 'パスワードの再設定を求めた', confirmPasswordReset: 'パスワードを再設定した', reauthenticate: '本人確認をした',
  updateAccount: 'アカウントの設定を変えた', changeEmail: 'メールアドレスを変えた', deleteAccount: 'アカウントを削除した', changePassword: 'パスワードを変えた',
  beginTotpEnrollment: '確認コードの設定を始めた', confirmTotpEnrollment: '確認コードを設定した', enableTotp: '確認コードを設定した', disableTotp: '確認コードを解除した',
  beginPasskeyRegistration: 'パスキーの登録を始めた', finishPasskeyRegistration: 'パスキーを登録した', revokeSession: 'ほかの端末をサインアウトさせた',
  // 家族
  createHousehold: '家族グループを作った', updateHouseholdProfile: '家族グループの名前を変えた', savePrivacySettings: '公開の設定を変えた',
  acceptInvite: '招待で参加した', createHouseholdInvite: '招待を作った', revokeHouseholdInvite: '招待を取り消した',
  updateMembershipRole: 'メンバーの役割を変えた', updatePermissionOverrides: '個別の権限を変えた', resetPermissionOverrides: '個別の権限を元に戻した',
  transferOwnership: '管理者を引き継いだ', leaveHousehold: '家族グループから退出した', setMemberStatus: 'メンバーの利用を止めた・再開した', removeMember: 'メンバーを外した',
  createColorLabel: '色のリストを作った', updateColorLabel: '色のリストを変えた', deleteColorLabel: '色のリストを削除した',
  createItemLink: '記録を関連づけた', deleteItemLink: '関連づけを外した',
  // 予定・タスク・メモ
  createEvent: '予定を追加した', updateRecurringEvent: '予定を変えた', deleteEvent: '予定を削除した', restoreEvent: '予定を元に戻した',
  createTodo: 'タスクを追加した', updateTodoStatus: 'タスクの状態を変えた', updateTodo: 'タスクを変えた', deleteTodo: 'タスクを削除した', restoreTodo: 'タスクを元に戻した',
  createMemo: 'メモを追加した', updateMemo: 'メモを変えた', deleteMemo: 'メモを削除した', restoreMemo: 'メモを元に戻した',
  uploadAttachment: 'メモにファイルを添付した', deleteAttachment: 'メモの添付を削除した',
  // 家計
  createExpense: '家計の記録を追加した', updateExpense: '家計の記録を変えた', deleteExpense: '家計の記録を削除した', restoreExpense: '家計の記録を元に戻した',
  recordSettlement: '精算を記録した', reverseSettlement: '精算を取り消した', settleAll: 'まとめて精算した', reverseBatch: 'まとめた精算を取り消した',
  // アルバム
  createAlbum: 'アルバムを作った', updateAlbum: 'アルバムを変えた', deleteAlbum: 'アルバムを削除した', restoreAlbum: 'アルバムを元に戻した',
  reorderAlbumItems: 'アルバムの並びを変えた', deleteAlbumItem: '写真・動画を削除した', restoreAlbumItem: '写真・動画を元に戻した',
  createUpload: '写真・動画の送信を始めた', appendUpload: '写真・動画を送った', cancelUpload: '写真・動画の送信を取り消した', putAlbumItemThumbnail: '動画の縮小画像を送った',
  // 通知
  markNotificationRead: '通知を読んだ', snoozeNotification: '通知を30分後にした', stopNotification: '通知を止めた', resumeNotification: '通知を再開した',
  updateNotificationPreferences: '通知の設定を変えた',
  // 読み取りの補助
  readReceipt: 'レシートの読み取りを頼んだ', readEventImage: 'チラシの読み取りを頼んだ', readEventUrl: 'ページの読み取りを頼んだ',
  // 運営者の命令
  'operator.grant': '運営者が利用期間を延ばした', 'operator.expire': '運営者が利用を止めた',
  'operator.suspended': '運営者がメンバーの利用を止めた', 'operator.active': '運営者がメンバーの利用を再開した',
  'operator.keysRotate': '運営者が鍵を入れ替えた', 'operator.keysRetire': '運営者が古い鍵を引退させた',
  'operator.totpReset': '運営者が確認コードを解除した', 'operator.auditPrune': '運営者が保持の期間を過ぎた記録を消した',
};

/** 名前のない操作（将来の版が残した名前など）は、そのまま出さずに一般的な言い方にする。 */
export const auditActionLabel = (action: string) => auditActionLabels[action] ?? 'そのほかの操作';

export const auditGroupLabels: Readonly<Record<AuditGroup, string>> = {
  account: 'アカウント', household: '家族グループ', members: 'メンバーと招待', events: '予定', tasks: 'タスク', memos: 'メモ',
  expenses: '家計', albums: 'アルバム', links: '関連づけ', notifications: '通知', assistant: '読み取りの補助', operator: '運営者', other: 'そのほか',
};

export const auditTargetLabels: Readonly<Record<AuditTargetKind, string>> = {
  event: '予定', task: 'タスク', memo: 'メモ', expense: '家計の記録', settlementBatch: 'まとめた精算', album: 'アルバム', member: 'メンバー', invite: '招待', colorLabel: '色のリスト', link: '関連づけ', notification: '通知',
};

/**
 * 記録の detail に残る項目の名前（値は残らない）。変更の入力の形（src/domain/auditLog.ts の fieldSchemas）のすべての項目を持つ。
 * 足りなければ src/content/auditLabels.test.ts が失敗する。
 */
export const auditFieldLabels: Readonly<Record<string, string>> = {
  allDay: '終日', amountJpy: '金額', assigneeMembershipId: '担当', avatar: 'アイコン', bgmPreset: '音楽', birthdate: '誕生日', body: '本文',
  category: '費目', colorLabelId: '色のリスト', coverItemId: '表紙', description: '説明', displayName: '表示名', dueAt: '期限', dueStartAt: '期限の開始',
  endsAt: '終了', idleTimeoutMinutes: '無操作の時間', incurredOn: '日付', kind: '種類', location: '場所', memoDate: 'メモの日付', note: 'メモ',
  ocrText: '読み取った文字', participantMembershipIds: '参加者', payerMembershipId: '支払った人', place: '場所', priority: '優先度', recurrence: '繰り返し',
  reminderMinutesBefore: '通知', reviewerMembershipId: '確認する人', shareAmounts: '負担', shareMembershipIds: '負担', startsAt: '開始', tags: 'タグ',
  timezone: '時間帯', title: '題名', visibility: '公開範囲', weatherSensitive: '天気の影響',
};

/** 変えた項目の名前を並べる。同じ名前（負担など）は1つにする。名前のない項目は「そのほかの項目」。 */
export const auditFieldsText = (fields: readonly string[]) => [...new Set(fields.map((field) => auditFieldLabels[field] ?? 'そのほかの項目'))].join('・');

export const auditCopy = {
  hiddenTarget: '見られない記録',
  operator: '運営者',
  former: 'もう家族にいない人',
  self: '自分',
  chainOk: '記録の改ざんは見つかっていません',
  chainProblem: '記録に食い違いが見つかりました。運営者に連絡してください',
  chainUnchecked: 'まだ確かめていません',
  retention: `変更の記録は${AUDIT_RETENTION_MONTHS}か月残し、その後は消します`,
  tab: '変更の記録',
  description: '家族の記録を誰がいつ変えたかを、新しい順に表示します。記録の中身や入力した値は残していません。',
  views: { household: '家族の記録', mine: '自分の操作' },
  chainHeading: '改ざんの確認',
  chainCheckedAt: (at: string) => `最後に確かめた日時：${at}`,
  filterPerson: '人', filterKind: '種類', filterPeriod: '期間',
  everyone: 'すべての人', everyKind: 'すべての種類',
  periods: { all: 'すべての期間', today: '今日', week: '最近7日間', month: '最近30日間' },
  more: 'もっと見る', loadingMore: '読み込んでいます…',
  empty: 'まだ記録はありません',
  emptyBody: '家族の記録が変わると、ここに表示します。',
  emptyFiltered: 'この条件の記録はありません',
  emptyFilteredBody: '絞り込みを「すべて」に戻すと、ほかの記録を確認できます。',
  emptyMine: 'まだ記録はありません',
  emptyMineBody: 'サインインやパスワードの変更などをすると、ここに表示します。',
  fields: (text: string) => `変えた項目：${text}`,
  hiddenHelp: '今の権限では見られない記録か、すでに消えた記録です。',
  mineHeading: '自分の操作の記録',
  mineDescription: 'サインインやパスワードの変更など、自分のアカウントで行った操作です。',
  failed: '変更の記録を読み込めませんでした。',
  retry: 'もう一度読み込む',
} as const;
