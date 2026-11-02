import type { ConsoleState, RecordCollection, SectionId } from './model';
import { SAMPLE_OPERATOR } from './model';

/** すべて架空の値。実在の接続先、人、家族、設定値を入れない。 */
export const sections: readonly { id: SectionId; label: string; href: string }[] = [
  { id: 'overview', label: '概要', href: '/showcase/management' },
  { id: 'services', label: 'サービスの状態', href: '/showcase/management/services' },
  { id: 'jobs', label: 'ジョブ', href: '/showcase/management/jobs' },
  { id: 'backups', label: 'バックアップ', href: '/showcase/management/backups' },
  { id: 'audit-log', label: '操作の記録', href: '/showcase/management/audit-log' },
  { id: 'households', label: '家族グループ', href: '/showcase/management/households' },
  { id: 'records', label: '記録の閲覧', href: '/showcase/management/records' },
];

export const collectionLabels: Record<RecordCollection, string> = { events: '予定', tasks: 'タスク', memos: 'メモ', expenses: '支出' };

export const initialConsoleState: ConsoleState = {
  now: '2026-09-28T09:00:00+09:00',
  nextId: 100,
  services: [
    { id: 'api', name: 'API（見本）', status: 'ok', summary: '応答しています', measure: '応答 42ミリ秒', checkedAt: '2026-09-28T08:55:00+09:00' },
    { id: 'database', name: 'データベース（見本）', status: 'ok', summary: '読み書きできます', measure: '容量 1.2GB', checkedAt: '2026-09-28T08:55:00+09:00' },
    { id: 'files', name: 'ファイルの確認（見本）', status: 'warning', summary: '待ち行列が増えています', measure: '待ち 18件', checkedAt: '2026-09-28T08:54:00+09:00' },
    { id: 'mail', name: 'メール送信（見本）', status: 'ok', summary: '送信できます', measure: '今日 12通', checkedAt: '2026-09-28T08:50:00+09:00' },
    { id: 'reading', name: '読み取りの補助（見本）', status: 'ok', summary: '既定で使いません', measure: '今日 0回', checkedAt: '2026-09-28T08:50:00+09:00' },
    { id: 'weather', name: '天気の取得（見本）', status: 'ok', summary: '取得できます', measure: '30分前に更新', checkedAt: '2026-09-28T08:30:00+09:00' },
  ],
  jobs: [
    { id: 'retention', title: '保存期間を過ぎた記録の消去', description: '削除から30日を過ぎた記録を数え、実行すると消します。', pending: 14, changesRecords: true },
    { id: 'invites', title: '期限切れの招待の片付け', description: '期限が過ぎた招待を数え、実行すると一覧から外します。', pending: 3, changesRecords: true },
    { id: 'storage', title: '添付ファイルの整合性の確認', description: '記録とファイルの対応を読み取って確かめます。何も変更しません。', pending: 2, changesRecords: false },
  ],
  runs: [
    { id: 'sample-run-3', jobId: 'retention', mode: 'run', status: 'succeeded', at: '2026-09-27T03:00:00+09:00', count: 22, actor: '見本の自動実行' },
    { id: 'sample-run-2', jobId: 'storage', mode: 'dry-run', status: 'failed', at: '2026-09-26T03:10:00+09:00', count: 0, actor: '見本の自動実行' },
    { id: 'sample-run-1', jobId: 'invites', mode: 'dry-run', status: 'succeeded', at: '2026-09-25T10:20:00+09:00', count: 1, actor: SAMPLE_OPERATOR },
  ],
  backups: [
    { id: 'sample-backup-3', name: '見本のバックアップ3', sizeMb: 123, checksum: '見本0003', status: 'unverified', createdAt: '2026-09-28T02:00:00+09:00' },
    { id: 'sample-backup-2', name: '見本のバックアップ2', sizeMb: 122, checksum: '見本0002', status: 'verified', createdAt: '2026-09-27T02:00:00+09:00' },
    { id: 'sample-backup-1', name: '見本のバックアップ1', sizeMb: 121, checksum: '見本0001', status: 'verified', createdAt: '2026-09-26T02:00:00+09:00' },
  ],
  audit: [
    { id: 'sample-audit-4', at: '2026-09-27T17:40:00+09:00', actor: SAMPLE_OPERATOR, category: 'household', action: '利用の停止', target: '見本の家族D' },
    { id: 'sample-audit-3', at: '2026-09-27T03:00:00+09:00', actor: '見本の自動実行', category: 'job', action: '見本の実行', target: '保存期間を過ぎた記録の消去' },
    { id: 'sample-audit-2', at: '2026-09-27T02:00:00+09:00', actor: '見本の自動実行', category: 'backup', action: '作成', target: '見本のバックアップ2' },
    { id: 'sample-audit-1', at: '2026-09-26T09:15:00+09:00', actor: SAMPLE_OPERATOR, category: 'service', action: '状態の再確認', target: 'メール送信（見本）' },
  ],
  households: [
    { id: 'sample-household-a', name: '見本の家族A', status: 'active', members: 4, endsAt: null },
    { id: 'sample-household-b', name: '見本の家族B', status: 'trial', members: 2, endsAt: '2026-10-05T23:59:00+09:00' },
    { id: 'sample-household-c', name: '見本の家族C', status: 'active', members: 6, endsAt: '2026-12-31T23:59:00+09:00' },
    { id: 'sample-household-d', name: '見本の家族D', status: 'stopped', members: 3, endsAt: '2026-09-20T23:59:00+09:00' },
  ],
  records: [
    { id: 'sample-event-1', collection: 'events', title: '見本の予定1', household: '見本の家族A', updatedAt: '2026-09-27T20:00:00+09:00', waitingForDeletion: false, fields: [['開始', '10月3日 9:30'], ['公開範囲', '大人のメンバー'], ['メモ', '（見本では伏せています）']] },
    { id: 'sample-event-2', collection: 'events', title: '見本の予定2', household: '見本の家族C', updatedAt: '2026-09-21T08:00:00+09:00', waitingForDeletion: true, fields: [['開始', '9月30日 14:00'], ['公開範囲', '作成した人だけ'], ['削除まで', 'あと23日']] },
    { id: 'sample-task-1', collection: 'tasks', title: '見本のタスク1', household: '見本の家族A', updatedAt: '2026-09-26T12:10:00+09:00', waitingForDeletion: false, fields: [['状態', '進行中'], ['優先度', '高'], ['担当', '（見本では伏せています）']] },
    { id: 'sample-task-2', collection: 'tasks', title: '見本のタスク2', household: '見本の家族B', updatedAt: '2026-09-25T18:30:00+09:00', waitingForDeletion: false, fields: [['状態', '未着手'], ['優先度', '中'], ['担当', '（見本では伏せています）']] },
    { id: 'sample-memo-1', collection: 'memos', title: '見本のメモ1', household: '見本の家族B', updatedAt: '2026-09-24T07:45:00+09:00', waitingForDeletion: false, fields: [['添付', '1件'], ['本文', '（見本では伏せています）']] },
    { id: 'sample-expense-1', collection: 'expenses', title: '見本の支出1', household: '見本の家族C', updatedAt: '2026-09-23T19:05:00+09:00', waitingForDeletion: false, fields: [['金額', '（見本では伏せています）'], ['費目', '食費']] },
    { id: 'sample-expense-2', collection: 'expenses', title: '見本の支出2', household: '見本の家族D', updatedAt: '2026-09-15T11:20:00+09:00', waitingForDeletion: true, fields: [['金額', '（見本では伏せています）'], ['費目', '教育'], ['削除まで', 'あと17日']] },
  ],
};
