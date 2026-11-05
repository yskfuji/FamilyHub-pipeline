import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalRow, chainHash } from '../audit/chain';
import type { Anchor } from '../audit/chain';
import { AuditLog, writeOutbox } from '../audit/log';
import { AuditStore } from '../audit/store';
import { GENESIS_HASH } from '../audit/schema';
import { loadConfig } from '../config';
import { Db } from '../db/db';
import { migrations } from '../db/migrations';
import { runAuditDaily } from '../jobs';
import { readAnchors, retentionCutoff, runOperatorCommand } from '../operator';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';
import { Keyring, LEGACY_KID } from '../auth/keyring';

const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const opened: Array<{ close(): void }> = [];
const worlds: World[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) item.close();
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});

const tempDir = () => mkdtempSync(join(tmpdir(), 'family-hub-audit-'));

interface Setup { dir: string; db: Db; store: AuditStore; log: AuditLog; lines: { info: string[]; error: string[] } }
function setup(dir = tempDir()): Setup {
  const db = new Db(join(dir, 'main.sqlite'));
  const store = new AuditStore(join(dir, 'audit.db'));
  const lines = { info: [] as string[], error: [] as string[] };
  const log = new AuditLog(db, store, { info: (line) => lines.info.push(line), error: (line) => lines.error.push(line) });
  opened.push(store, db);
  return { dir, db, store, log, lines };
}

const at = (day: string) => `${day}T09:00:00+09:00`;
/** 変更の記録を n 件、日付を変えながら書く（outbox を通して audit.db へ移る）。 */
function addRows(log: AuditLog, count: number, from = 1, day = (index: number) => `2026-10-${String(index).padStart(2, '0')}`) {
  for (let index = from; index < from + count; index += 1) log.record({ id: `audit-${index}`, at: at(day(index)), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo', target: `todo-${index}` });
}

/** trigger を外した生の接続。改ざんする人の立場。 */
function tamper(path: string) {
  const raw = new DatabaseSync(path);
  raw.exec('DROP TRIGGER audit_events_no_update; DROP TRIGGER audit_events_prune_only; DROP TRIGGER audit_events_extend_tail; DROP TRIGGER audit_checkpoints_no_delete; DROP TRIGGER audit_checkpoints_match_chain;');
  opened.push(raw);
  return raw;
}

const first = (log: AuditLog, anchors: readonly Anchor[] = log.anchors()) => log.store.verify(anchors).problems[0];

describe('the audit file (A6-1)', () => {
  it('lives in its own file next to the main database, created with mode 0600', () => {
    const dir = tempDir();
    expect(loadConfig({ FAMILY_HUB_DATABASE: join(dir, 'family-hub.sqlite') }).auditDatabasePath).toBe(join(dir, 'audit.db'));
    expect(loadConfig({ FAMILY_HUB_DATABASE: join(dir, 'family-hub.sqlite'), FAMILY_HUB_AUDIT_DB: join(dir, 'elsewhere', 'a.db') }).auditDatabasePath).toBe(join(dir, 'elsewhere', 'a.db'));
    const { log, store } = setup(dir);
    addRows(log, 2);
    expect(statSync(join(dir, 'audit.db')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'audit.db-wal')).mode & 0o777).toBe(0o600);
    expect(store.db.all('SELECT seq FROM audit_events')).toHaveLength(2);
  });

  it('narrows the mode of a file that already exists', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'audit.db'), '', { mode: 0o644 });
    const store = new AuditStore(join(dir, 'audit.db'));
    opened.push(store);
    expect(statSync(join(dir, 'audit.db')).mode & 0o777).toBe(0o600);
  });
});

describe('outbox and mover (A6-2)', () => {
  it('writes the outbox in the same transaction as the change, and moves nothing that was rolled back', () => {
    const { db, store, log } = setup();
    db.transaction(() => { log.record({ id: 'audit-kept', at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' }); expect(store.db.all('SELECT id FROM audit_events')).toEqual([]); });
    db.transaction(() => { log.record({ id: 'audit-rolled-back', at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' }); return false; }, (value) => value);
    expect(store.db.all('SELECT id FROM audit_events')).toEqual([{ id: 'audit-kept' }]);
    expect(db.all('SELECT id FROM audit_outbox')).toEqual([]);
  });

  it('neither duplicates nor loses a row when it stops between appending and clearing the outbox', () => {
    const dir = tempDir();
    const before = setup(dir);
    for (let index = 1; index <= 3; index += 1) writeOutbox(before.db, { id: `audit-${index}`, at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' });
    // 1つ目の段（audit.db への追記）だけを済ませ、outbox を消す前に止まったことにする。
    before.store.append(before.db.all('SELECT id, at, household_id, actor_user_id, action, target, detail FROM audit_outbox ORDER BY seq'));
    before.store.close(); before.db.close(); opened.length = 0;
    const after = setup(dir);
    expect(after.db.all('SELECT id FROM audit_outbox')).toHaveLength(3);
    writeOutbox(after.db, { id: 'audit-4', at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' });
    expect(after.log.flush()).toBe(1);
    expect(after.store.db.all('SELECT seq, id FROM audit_events ORDER BY seq')).toEqual([1, 2, 3, 4].map((seq) => ({ seq, id: `audit-${seq}` })));
    expect(after.db.all('SELECT id FROM audit_outbox')).toEqual([]);
    expect(after.store.verify([]).ok).toBe(true);
  });

  it('keeps the rows in the outbox when the audit file cannot be written, and moves them later', () => {
    const { db, store, log, lines } = setup();
    const raw = new DatabaseSync(store.db.path);
    opened.push(raw);
    raw.exec('BEGIN IMMEDIATE');
    // 別の接続が書き込みの錠を持っている間（busy_timeout を短くして待たない）。
    store.db.run('PRAGMA busy_timeout = 1');
    log.record({ id: 'audit-1', at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' });
    expect(db.all('SELECT id FROM audit_outbox')).toEqual([{ id: 'audit-1' }]);
    expect(lines.error.join('\n')).toContain('stay in the outbox');
    raw.exec('COMMIT');
    expect(log.flush()).toBe(1);
    expect(db.all('SELECT id FROM audit_outbox')).toEqual([]);
  });
});

describe('append-only triggers (A6-3)', () => {
  it('refuses UPDATE, DELETE, a row that does not extend the tail, and a checkpoint that is not in the chain', () => {
    const { store, log } = setup();
    addRows(log, 3);
    expect(() => store.db.run("UPDATE audit_events SET action = 'deleteTodo' WHERE seq = 2")).toThrow(/append-only/);
    expect(() => store.db.run('DELETE FROM audit_events WHERE seq = 3')).toThrow(/audit prune/);
    expect(() => store.db.run("INSERT INTO audit_events (seq, id, at, action, prev_hash, hash) VALUES (2, 'x', 'a', 'b', 'c', 'd')")).toThrow();
    expect(() => store.db.run("INSERT INTO audit_events (seq, id, at, action, prev_hash, hash) VALUES (4, 'x', 'a', 'b', 'not-the-tail', 'd')")).toThrow(/tail/);
    expect(() => store.db.run("INSERT INTO audit_checkpoints (through_seq, hash, pruned_before, pruned_rows, at) VALUES (2, 'forged', '2026-10-03', 2, 'now')")).toThrow(/checkpoint/);
    expect(store.db.all('SELECT seq FROM audit_events')).toHaveLength(3);
  });
});

describe('hash chain (A6-4)', () => {
  it('hashes SHA-256(prev_hash ‖ canonical row) from the genesis value, without a key', () => {
    const { store, log } = setup();
    addRows(log, 2);
    const rows = store.db.all<{ seq: number; id: string; at: string; household_id: string; actor_user_id: string; action: string; target: string; detail: null; prev_hash: string; hash: string }>('SELECT * FROM audit_events ORDER BY seq');
    expect(rows[0].prev_hash).toBe(GENESIS_HASH);
    expect(canonicalRow(rows[0])).toBe(JSON.stringify(['audit-1', at('2026-10-01'), 'house-mori', 'user-aoi', 'createTodo', 'todo-1', null]));
    expect(rows[0].hash).toBe(createHash('sha256').update(GENESIS_HASH + canonicalRow(rows[0])).digest('hex'));
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    expect(rows[1].hash).toBe(chainHash(rows[0].hash, rows[1]));
  });

  it('never forks when the API and several operator processes append at the same time', async () => {
    const dir = tempDir();
    const { db, store, log } = setup(dir);
    db.run("INSERT INTO entitlements (household_id, status, updated_at) VALUES ('house-mori', 'active', '2026-10-01T09:00:00+09:00')");
    const children = ['cli-a', 'cli-b', 'cli-c'].map((name) => spawn(tsx, [resolve(import.meta.dirname, '../testing/auditAppender.ts'), store.db.path, name, '120'], { stdio: ['pipe', 'pipe', 'inherit'] }));
    const output = (child: typeof children[number], marker: string) => new Promise<void>((done) => { let text = ''; child.stdout.on('data', (chunk: Buffer) => { text += String(chunk); if (text.includes(marker)) done(); }); });
    await Promise.all(children.map((child) => output(child, 'ready')));
    const finished = Promise.all(children.map((child) => output(child, 'done')));
    // 実際の運営者の命令も同時に走らせる（outbox に書き、命令の後で audit.db へ移す）。
    const operator = new Promise<number>((done) => spawn(tsx, [resolve(import.meta.dirname, '../cli.ts'), 'grant', 'house-mori', '30'], { env: { ...process.env, FAMILY_HUB_DATABASE: db.path, FAMILY_HUB_AUDIT_DB: store.db.path, FAMILY_HUB_KEYS: `k1=${'k'.repeat(40)}`, FAMILY_HUB_SECRET: '' }, stdio: 'ignore' }).on('exit', (code) => done(code ?? -1)));
    for (const child of children) child.stdin.write('go\n');
    for (let index = 1; index <= 120; index += 1) {
      log.record({ id: `api-${index}`, at: at('2026-10-01'), householdId: 'house-mori', actorUserId: 'user-aoi', action: 'createTodo' });
      await new Promise((next) => setImmediate(next));
    }
    await finished;
    expect(await operator).toBe(0);
    const rows = store.db.all<{ seq: number; prev_hash: string; hash: string; action: string }>('SELECT seq, prev_hash, hash, action FROM audit_events ORDER BY seq');
    expect(rows).toHaveLength(4 * 120 + 1);
    expect(rows.filter((row) => row.action === 'operator.grant')).toHaveLength(1);
    rows.forEach((row, index) => { expect(row.seq).toBe(index + 1); expect(row.prev_hash).toBe(index === 0 ? GENESIS_HASH : rows[index - 1].hash); });
    expect(new Set(rows.map((row) => row.prev_hash)).size).toBe(rows.length);
    expect(store.verify([]).ok).toBe(true);
  }, 60_000);
});

describe('anchors (A6-5)', () => {
  it('leaves one anchor a day in the operational log and the main database, and hands the current one to backups', () => {
    const { log, lines } = setup();
    addRows(log, 3);
    const anchor = log.anchorDaily('2026-11-03T03:00:00+09:00');
    expect(anchor).toEqual(log.currentAnchor());
    expect(anchor?.seq).toBe(3);
    expect(log.anchorDaily('2026-11-03T15:00:00+09:00')).toBeNull();
    addRows(log, 1, 4);
    expect(log.anchorDaily('2026-11-04T03:00:00+09:00')?.seq).toBe(4);
    expect(lines.info).toEqual([`audit anchor day=2026-11-03 seq=3 hash=${anchor?.hash}`, `audit anchor day=2026-11-04 seq=4 hash=${log.currentAnchor().hash}`]);
    expect(readAnchors(`Nov 03 03:00 host node[1]: ${lines.info[0]}\nunrelated\n${lines.info[1]}\n`)).toEqual(log.anchors());
  });
});

describe('tampering is detected with its position (A6-6, A6-9)', () => {
  /** 10行の鎖を作り、8行目で基準点を残す。 */
  function chain() {
    const context = setup();
    addRows(context.log, 8);
    context.log.anchorDaily('2026-11-03T03:00:00+09:00');
    addRows(context.log, 2, 9);
    expect(context.store.verify(context.log.anchors()).ok).toBe(true);
    return { ...context, raw: tamper(context.store.db.path) };
  }

  it('finds a modified row', () => {
    const { log, raw } = chain();
    raw.exec("UPDATE audit_events SET action = 'deleteTodo' WHERE seq = 4");
    expect(first(log)).toMatchObject({ kind: 'modified', seq: 4 });
  });

  it('finds a deleted row, also when the numbers after it are closed up', () => {
    const { log, raw } = chain();
    raw.exec('DELETE FROM audit_events WHERE seq = 6');
    expect(first(log)).toMatchObject({ kind: 'deleted', seq: 6 });
    for (let seq = 7; seq <= 10; seq += 1) raw.prepare('UPDATE audit_events SET seq = ? WHERE seq = ?').run(seq - 1, seq);
    expect(first(log)).toMatchObject({ kind: 'deleted', seq: 6 });
  });

  it('finds rows put in a different order', () => {
    const { log, raw } = chain();
    raw.exec('UPDATE audit_events SET seq = -3 WHERE seq = 3; UPDATE audit_events SET seq = 3 WHERE seq = 4; UPDATE audit_events SET seq = 4 WHERE seq = -3;');
    expect(first(log)).toMatchObject({ kind: 'reordered', seq: 3 });
  });

  it('finds a row inserted into the middle with a well-formed hash', () => {
    const { log, store, raw } = chain();
    const before = store.db.get<{ hash: string }>('SELECT hash FROM audit_events WHERE seq = 5');
    for (let seq = 10; seq >= 6; seq -= 1) raw.prepare('UPDATE audit_events SET seq = ? WHERE seq = ?').run(seq + 1, seq);
    const fake = { id: 'audit-fake', at: at('2026-10-05'), household_id: 'house-mori', actor_user_id: 'user-ren', action: 'deleteExpense', target: 'expense-books', detail: null };
    raw.prepare('INSERT INTO audit_events (seq, id, at, household_id, actor_user_id, action, target, detail, prev_hash, hash) VALUES (6, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(fake.id, fake.at, fake.household_id, fake.actor_user_id, fake.action, fake.target, fake.detail, before?.hash ?? '', chainHash(before?.hash ?? '', fake));
    expect(first(log)).toMatchObject({ kind: 'inserted', seq: 6 });
  });

  it('finds rows cut from the end before the last anchor, and says plainly that a cut after it cannot be seen', () => {
    const { log, raw } = chain();
    raw.exec('DELETE FROM audit_events WHERE seq >= 9');
    // 最後の基準点（8行目）より後の切り捨ては、鎖だけでは気づけない。
    expect(log.store.verify(log.anchors()).ok).toBe(true);
    raw.exec('DELETE FROM audit_events WHERE seq >= 7');
    expect(first(log)).toMatchObject({ kind: 'truncated', seq: 7 });
  });

  it('finds a chain rewritten from scratch by an anchor kept in the operational log', () => {
    const { log, store, raw } = chain();
    const anchor = log.anchors()[0];
    raw.exec('DELETE FROM audit_events');
    log.db.run('DELETE FROM audit_anchors');
    const forged = new AuditStore(store.db.path);
    opened.push(forged);
    forged.append(Array.from({ length: 10 }, (_, index) => ({ id: `forged-${index}`, at: at('2026-10-01'), household_id: 'house-mori', actor_user_id: 'user-ren', action: 'createTodo', target: null, detail: null })));
    expect(forged.verify([]).ok).toBe(true);
    expect(forged.verify([anchor]).problems[0]).toMatchObject({ kind: 'rewritten', seq: 8 });
  });

  it('reports the position from the operator command and exits with 2', () => {
    const { log, raw, db, dir } = chain();
    const out: string[] = []; const err: string[] = [];
    const run = (argv: string[]) => runOperatorCommand(argv, { db, keys: new Keyring({ keys: [{ kid: LEGACY_KID, secret: 'x'.repeat(32) }], activeKid: LEGACY_KID }), now: '2026-11-03T10:00:00+09:00', out: (line) => out.push(line), err: (line) => err.push(line), audit: log });
    expect(run(['audit', 'verify'])).toBe(0);
    expect(out.at(-1)).toMatch(/^ok 10 row\(s\) from seq 1 to 10/);
    raw.exec("UPDATE audit_events SET target = 'todo-x' WHERE seq = 2");
    expect(run(['audit', 'verify'])).toBe(2);
    expect(err[0]).toBe('modified at seq 2: the row no longer matches its hash');
    // 運用ログから写した基準点も使える。
    raw.exec("UPDATE audit_events SET target = 'todo-2' WHERE seq = 2");
    db.run('DELETE FROM audit_anchors');
    raw.exec('DELETE FROM audit_events WHERE seq >= 7');
    expect(run(['audit', 'verify'])).toBe(0);
    const file = join(dir, 'journal.txt');
    writeFileSync(file, `Nov 03 03:00 host node[1]: audit anchor day=2026-11-03 seq=8 hash=${'a'.repeat(64)}\n`);
    err.length = 0;
    expect(run(['audit', 'verify', '--anchors', file])).toBe(2);
    expect(err[0]).toMatch(/^truncated at seq 7/);
    expect(run(['audit', 'verify', '--anchors'])).toBe(1);
  });
});

describe('checking at startup (A6-6)', () => {
  it('starts, keeps /ready up, and shows the problem to owners when the recent part is broken', async () => {
    const dir = tempDir();
    const databasePath = join(dir, 'family-hub.sqlite');
    const auditDatabasePath = join(dir, 'audit.db');
    const before = createWorld('member-aoi', undefined, undefined, undefined, { databasePath, auditDatabasePath });
    for (const title of ['一', '二', '三']) expect((await before.gateway.todos.createTodo({ title, assigneeMembershipId: 'member-aoi' })).ok).toBe(true);
    const healthy = await before.gateway.audit.list();
    expect(healthy.ok && healthy.value.chain).toMatchObject({ state: 'ok' });
    await before.close();
    tamper(auditDatabasePath).exec("UPDATE audit_events SET action = 'deleteTodo' WHERE seq = 2");
    const after = createWorld('member-aoi', undefined, undefined, undefined, { databasePath, auditDatabasePath });
    worlds.push(after);
    const { url } = await after.ready;
    expect((await fetch(`${url}/ready`)).status).toBe(200);
    expect(after.deps.audit.status).toMatchObject({ state: 'problem', problem: { kind: 'modified', seq: 2 } });
    const page = await after.gateway.audit.list();
    expect(page.ok && page.value.chain).toEqual({ state: 'problem', checkedAt: '2026-09-30T07:45:00+09:00' });
  });

  it('writes the failure to the operational log', () => {
    const { log, store, lines } = setup();
    addRows(log, 3);
    tamper(store.db.path).exec('DELETE FROM audit_events WHERE seq = 2');
    expect(log.verifyRecent('2026-11-03T03:00:00+09:00').ok).toBe(false);
    expect(lines.error).toEqual([expect.stringMatching(/^audit: the chain check failed at seq 2 \(deleted/)]);
    expect(log.status).toMatchObject({ state: 'problem', checkedAt: '2026-11-03T03:00:00+09:00' });
  });
});

describe('retention and prune (A6-7)', () => {
  it('keeps 24 months by default', () => {
    expect(retentionCutoff('2026-11-03T03:00:00+09:00', 24)).toBe('2024-11-03');
    expect(loadConfig({}).auditRetentionMonths).toBe(24);
    expect(() => loadConfig({ FAMILY_HUB_AUDIT_RETENTION_MONTHS: '-1' })).toThrow();
  });

  it('counts back whole months and clamps to the last day of a shorter month', () => {
    // setUTCMonth は 3月31日の1か月前を 3月3日にしていた（2月31日が繰り上がる）。
    expect(retentionCutoff('2026-03-31T03:00:00+09:00', 1)).toBe('2026-02-28');
    expect(retentionCutoff('2024-03-31T03:00:00+09:00', 1)).toBe('2024-02-29');
    expect(retentionCutoff('2026-05-31T03:00:00+09:00', 1)).toBe('2026-04-30');
    expect(retentionCutoff('2026-01-31T03:00:00+09:00', 2)).toBe('2025-11-30');
    expect(retentionCutoff('2028-02-29T03:00:00+09:00', 24)).toBe('2026-02-28');
    expect(retentionCutoff('2026-12-31T03:00:00+09:00', 12)).toBe('2025-12-31');
    expect(retentionCutoff('2026-03-15T03:00:00+09:00', 0)).toBe('2026-03-15');
  });

  it('leaves a checkpoint with the tail hash of the pruned range, then deletes it, and verify continues from the checkpoint', () => {
    const { log, store, db } = setup();
    addRows(log, 10);
    log.anchorDaily('2026-10-03T23:00:00+09:00');
    const tailOfRange = store.db.get<{ hash: string }>('SELECT hash FROM audit_events WHERE seq = 4')?.hash;
    const out: string[] = [];
    expect(runOperatorCommand(['audit', 'prune', '--before', '2026-10-05'], { db, keys: new Keyring({ keys: [{ kid: LEGACY_KID, secret: 'x'.repeat(32) }], activeKid: LEGACY_KID }), now: '2026-11-03T10:00:00+09:00', out: (line) => out.push(line), err: () => undefined, audit: log })).toBe(0);
    expect(out).toEqual([`pruned 4 row(s) before 2026-10-05; checkpoint seq 4 hash ${tailOfRange}`]);
    expect(store.latestCheckpoint()).toMatchObject({ through_seq: 4, hash: tailOfRange, pruned_before: '2026-10-05', pruned_rows: 4 });
    expect(store.db.all<{ seq: number }>('SELECT seq FROM audit_events ORDER BY seq').map((row) => row.seq)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(store.db.get('SELECT action FROM audit_events WHERE seq = 11')).toEqual({ action: 'operator.auditPrune' });
    // 基準点（3行目）は消した区間の中なので数えず、鎖は checkpoint から続けて確かめる。
    expect(log.verifyAll('2026-11-03T10:00:00+09:00')).toMatchObject({ ok: true, checked: 7, tailSeq: 11 });
    expect(store.prune('2026-10-05', '2026-11-03T10:00:00+09:00', 'audit-again')).toEqual({ pruned: 0, checkpoint: null });
    // checkpoint の外の行は、prune の道を通らないと消せない。
    expect(() => store.db.run('DELETE FROM audit_events WHERE seq = 5')).toThrow(/audit prune/);
    addRows(log, 1, 11);
    expect(store.verify(log.anchors()).ok).toBe(true);
  });

  it('keeps everything when the retention period is 0: the daily job and a prune without --before delete nothing', () => {
    const { log, store, db } = setup();
    addRows(log, 4, 1, (index) => `2024-0${index}-01`);
    const keys = new Keyring({ keys: [{ kid: LEGACY_KID, secret: 'x'.repeat(32) }], activeKid: LEGACY_KID });
    const errors: string[] = [];
    expect(runOperatorCommand(['audit', 'prune'], { db, keys, now: '2026-11-03T10:00:00+09:00', out: () => undefined, err: (line) => errors.push(line), audit: log, auditRetentionMonths: 0 })).toBe(1);
    expect(errors.join('\n')).toContain('--before');
    runAuditDaily({ db, audit: log, config: { auditRetentionMonths: 0 }, clock: { now: () => '2026-11-03T03:00:00+09:00' }, ids: { next: () => 'audit-prune-0' } } as never);
    expect(store.latestCheckpoint()).toBeNull();
    expect(store.db.all<{ seq: number }>('SELECT seq FROM audit_events ORDER BY seq').map((row) => row.seq).slice(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it('notices a checkpoint planted to cut the head of the chain', () => {
    const { log, store } = setup();
    addRows(log, 10);
    const raw = tamper(store.db.path);
    const hash = store.db.get<{ hash: string }>('SELECT hash FROM audit_events WHERE seq = 4')?.hash ?? '';
    raw.prepare("INSERT INTO audit_checkpoints (through_seq, hash, pruned_before, pruned_rows, at) VALUES (4, ?, '2026-10-05', 4, 'now')").run(hash);
    raw.exec('DELETE FROM audit_events WHERE seq <= 4');
    expect(first(log)).toMatchObject({ kind: 'checkpoint', seq: 4 });
  });

  it('prunes past the retention period every day and anchors the result', () => {
    const { log, store, db } = setup();
    addRows(log, 4, 1, (index) => `2024-0${index}-01`);
    addRows(log, 2, 5, () => '2026-10-01');
    const deps = { db, audit: log, config: { auditRetentionMonths: 24 }, clock: { now: () => '2026-11-03T03:00:00+09:00' }, ids: { next: () => 'audit-prune-1' } };
    runAuditDaily(deps as never);
    expect(store.latestCheckpoint()).toMatchObject({ through_seq: 4, pruned_before: '2024-11-03' });
    expect(log.anchors()).toEqual([{ seq: 7, hash: store.tail().hash }]);
    expect(log.status.state).toBe('ok');
  });
});

describe('the previous audit_events table becomes the origin of the chain (A6-8)', () => {
  it('moves every old row into the outbox in order, drops the table, and starts the chain with them', () => {
    const dir = tempDir();
    const path = join(dir, 'family-hub.sqlite');
    const old = new DatabaseSync(path);
    old.exec('PRAGMA journal_mode = WAL');
    for (const [index, migration] of migrations.slice(0, 6).entries()) { old.exec(migration); old.exec(`PRAGMA user_version = ${index + 1}`); }
    const rows = [
      ['audit-a', 'house-mori', 'user-aoi', 'createTodo', 'todo-1', null, '2026-10-01T09:00:00+09:00'],
      ['audit-b', null, 'user-aoi', 'signIn', null, null, '2026-10-01T08:00:00+09:00'],
      ['audit-c', 'house-mori', 'operator', 'operator.grant', 'house-mori', '2026-12-01T00:00:00.000Z', '2026-10-02T09:00:00+09:00'],
    ] as const;
    for (const row of rows) old.prepare('INSERT INTO audit_events (id, household_id, actor_user_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...row);
    old.close();
    const db = new Db(path);
    const store = new AuditStore(join(dir, 'audit.db'));
    opened.push(store, db);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'audit_events'")).toBeUndefined();
    expect(db.all('SELECT id FROM audit_outbox ORDER BY seq')).toEqual(rows.map((row) => ({ id: row[0] })));
    const log = new AuditLog(db, store, { info: () => undefined, error: () => undefined });
    expect(log.verifyRecent('2026-11-03T03:00:00+09:00').ok).toBe(true);
    const chain = store.db.all<{ seq: number; id: string; prev_hash: string; action: string; detail: string | null }>('SELECT seq, id, prev_hash, action, detail FROM audit_events ORDER BY seq');
    expect(chain.map((row) => [row.seq, row.id, row.action])).toEqual([[1, 'audit-a', 'createTodo'], [2, 'audit-b', 'signIn'], [3, 'audit-c', 'operator.grant']]);
    expect(chain[0].prev_hash).toBe(GENESIS_HASH);
    expect(db.all('SELECT id FROM audit_outbox')).toEqual([]);
  });
});

describe('the record API (A5)', () => {
  it('hides the target of a record another member keeps private, and never returns bodies or secrets', async () => {
    const dir = tempDir();
    const options = { databasePath: join(dir, 'family-hub.sqlite'), auditDatabasePath: join(dir, 'audit.db') };
    const ren = createWorld('member-ren', undefined, undefined, undefined, options);
    worlds.push(ren);
    expect((await ren.gateway.expenses.updateExpense('expense-ren-private', { note: '誰にも見せないメモ' }, 1)).ok).toBe(true);
    const owner = createWorld('member-aoi', undefined, undefined, undefined, options);
    worlds.push(owner);
    // 2つの世界は同じファイルを使うので、記録の ID が重ならないようにする。
    let sequence = 0;
    owner.deps.ids.next = (prefix) => `${prefix}-owner-${++sequence}`;
    expect((await owner.gateway.expenses.updateExpense('expense-books', { title: '教材' }, 1)).ok).toBe(true);
    const page = await owner.gateway.audit.list();
    expect(page.ok && page.value.items.map((item) => [item.actor, item.action, item.target, item.detail])).toEqual([
      [{ kind: 'member', membershipId: 'member-aoi', displayName: '碧' }, 'updateExpense', { kind: 'expense', id: 'expense-books', hidden: false }, { fields: ['title'] }],
      [{ kind: 'member', membershipId: 'member-ren', displayName: '蓮' }, 'updateExpense', { kind: 'expense', id: null, hidden: true }, { fields: ['note'] }],
    ]);
    expect(JSON.stringify(page)).not.toMatch(/expense-ren-private|誰にも見せない|教材/);
    // 本人には自分の支出が見えるので、ID を伏せない（ここでは本人のアカウントの記録に家族の操作は出ない）。
    expect(await ren.gateway.audit.listMine()).toEqual({ ok: true, value: { items: [], nextCursor: null } });
  });

  it('lists sign-in and two-step changes in the account record, field by field, without codes, secrets or addresses', async () => {
    const world = createWorld();
    worlds.push(world);
    expect(await world.gateway.auth.signInWithPassword('aoi@example.test', 'current-password-long-enough')).toMatchObject({ ok: true });
    const begun = await world.gateway.auth.beginTotpEnrollment();
    expect(begun.ok).toBe(true);
    expect((await world.gateway.auth.disableTotp()).ok).toBe(true);
    const mine = await world.gateway.audit.listMine();
    expect(mine.ok && mine.value.items.map((item) => [item.action, item.group, item.actor])).toEqual([['disableTotp', 'account', { kind: 'self' }], ['signInWithPassword', 'account', { kind: 'self' }]]);
    for (const item of mine.ok ? mine.value.items : []) expect(Object.keys(item).sort()).toEqual(['action', 'actor', 'at', 'detail', 'group', 'id']);
    expect(JSON.stringify(mine)).not.toMatch(/otpauth|127\.0\.0\.1|aoi@example/);
    // 家族の記録には、本人のサインインは出ない。
    const household = await world.gateway.audit.list();
    expect(household.ok && household.value.items).toEqual([]);
  });
});
