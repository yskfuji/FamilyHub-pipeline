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
