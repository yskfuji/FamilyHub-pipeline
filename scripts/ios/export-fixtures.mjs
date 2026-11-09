#!/usr/bin/env node
/**
 * iOS の型（FHModel）が Web と同じ形を読めるかを確かめるための見本の JSON を書き出す。
 * アプリに入れる見本の仕組み（sample-engine.js、中身は src/data/mockGateway.ts）に、人ごとに問い合わせた応答をそのまま残す。
 * Swift の試験は、これを読んで書き戻し、同じ JSON になることを確かめる（欄の落ちや名前の違いを見つける）。
 *
 *   node scripts/ios/export-fixtures.mjs [--check]     （先に build-sample-engine.mjs）
 */
import { loadSampleEngine } from './sample-engine-node.mjs';
import { writeGenerated } from './generated.mjs';

const target = 'ios/Packages/FamilyHubKit/Tests/FHModelTests/Fixtures';
const write = (name, data) => writeGenerated(`${target}/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
const engine = loadSampleEngine();

/** 管理者・大人・子ども・ゲスト。見える記録が人ごとに違う。 */
for (const actor of ['member-aoi', 'member-ren', 'member-hana', 'member-yui']) {
  engine.reset(actor, { auditHistory: true });
  write(`snapshot.${actor}`, await engine.value('household', 'getSnapshot'));
}

engine.reset('member-aoi', { auditHistory: true });
write('albums', await engine.value('albums', 'listAlbums'));
write('album.album-sports', await engine.value('albums', 'getAlbum', 'album-sports'));
write('notifications', await engine.value('notifications', 'list'));
write('notificationPreferences', await engine.value('notifications', 'getPreferences'));
write('privacy', await engine.value('household', 'getPrivacySettings'));
write('security', await engine.value('auth', 'getSecurityOverview'));
write('invites', await engine.value('household', 'listInvites'));
write('account', await engine.value('auth', 'getAccount'));
write('session', await engine.value('auth', 'getSession'));
write('insights', await engine.value('insights', 'list'));
write('search', await engine.value('resources', 'search', '学校'));
write('audit', await engine.value('audit', 'list', {}));
write('auditMine', await engine.value('audit', 'listMine', {}));
write('assistantStatus', await engine.value('assistant', 'getStatus'));
// 消した記録が入った「最近削除」。
await engine.value('todos', 'deleteTodo', 'todo-library', 1);
write('trash', await engine.value('trash', 'list'));
// 失敗の形（版の競合）。
const failure = await engine.call('events', 'updateEvent', 'event-school', 'series', { title: '学校公開' }, 99);
if (failure.ok) throw new Error('version conflict expected');
write('error.version', failure.error);

// 段階 S3: タスクとメモの変更の応答。
engine.reset('member-aoi', { auditHistory: true });
write('todo.created', await engine.value('todos', 'createTodo', { title: '上履きを洗う', dueAt: '2026-10-02T20:00:00+09:00', dueStartAt: '2026-10-02T09:00:00+09:00', assigneeMembershipId: 'member-aoi', reviewerMembershipId: 'member-ren', note: '乾かす', priority: 'high', colorLabelId: 'label-school', visibility: { audience: 'household', selectedMembershipIds: [] } }));
write('todo.waiting', await engine.value('todos', 'updateTodoStatus', 'todo-library', 'waiting', 1, '返却ポストに入れます'));
// 繰り返しのタスクを完了にすると、完了した写しが返る。
write('todo.recurringDone', await engine.value('todos', 'updateTodoStatus', 'todo-garbage', 'done', 1, '出しました'));
const memo = await engine.value('memos', 'createMemo', { title: '持ち物', body: '体操服', tags: ['学校'], memoDate: '2026-10-01', visibility: { audience: 'selected', selectedMembershipIds: ['member-ren'] } });
write('memo.created', memo);
write('memo.attached', await engine.value('memos', 'uploadAttachment', memo.id, { name: '持ち物.pdf', type: 'application/pdf', size: 1200 }, 'fixture-key'));
write('memo.ocr', await engine.value('memos', 'updateMemo', 'memo-school', { ocrText: '令和8年度 学校公開' }, 1));
write('attachment.link', await engine.value('memos', 'getAttachmentLink', 'memo-school', 'attachment-school', 'inline'));

// 段階 S4: 家計の変更の応答（蓮さんは家計のすべての負担が見えるので、まとめた精算もできる）。
engine.reset('member-ren', { auditHistory: true });
write('expense.created', await engine.value('expenses', 'createExpense', { kind: 'expense', title: '上履き', amountJpy: 1001, incurredOn: '2026-09-30', payerMembershipId: 'member-ren', category: 'shopping', shareAmounts: [{ membershipId: 'member-ren', amountJpy: 601 }, { membershipId: 'member-aoi', amountJpy: 400 }], note: '2足', visibility: { audience: 'household', selectedMembershipIds: [] } }, 'fixture-expense'));
write('expense.settled', await engine.value('expenses', 'recordSettlement', 'expense-books', 'member-ren', 715));
const renSnapshot = await engine.value('household', 'getSnapshot');
const openShares = renSnapshot.expenses.flatMap((expense) => expense.shares.filter((share) => share.membershipId !== expense.payerMembershipId && share.amountJpy > share.settledJpy).map((share) => ({ expenseId: expense.id, membershipId: share.membershipId, remainingJpy: share.amountJpy - share.settledJpy, payer: expense.payerMembershipId })));
const net = new Map();
for (const share of openShares) { net.set(share.membershipId, (net.get(share.membershipId) ?? 0) - share.remainingJpy); net.set(share.payer, (net.get(share.payer) ?? 0) + share.remainingJpy); }
const debtor = [...net].find(([, value]) => value < 0);
const creditor = [...net].find(([, value]) => value > 0);
const batch = await engine.value('expenses', 'settleAll', { shares: openShares.map(({ expenseId, membershipId, remainingJpy }) => ({ expenseId, membershipId, remainingJpy })), transfers: [{ from: debtor[0], to: creditor[0], amountJpy: creditor[1] }] }, 'fixture-batch');
write('settlementBatch', batch);
write('settlementBatch.reversed', await engine.value('expenses', 'reverseBatch', batch.id, 'fixture-undo'));
write('snapshot.afterBatch', await engine.value('household', 'getSnapshot'));
