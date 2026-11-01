import type { HouseholdAggregate } from '../../src/domain/commands';
import type { HouseholdSnapshot, Id } from '../../src/domain/types';
import type { Db } from './db';

/** 配列で持つ記録と、1つだけ持つ記録の保存先。 */
const lists = ['memberships', 'events', 'todos', 'memos', 'expenses', 'resources', 'links', 'colorLabels', 'invites', 'notifications', 'permissionOverrides'] as const;
const mediaLists = ['albums', 'albumItems'] as const;
const archives = ['events', 'todos', 'memos', 'expenses'] as const;
type ListName = typeof lists[number] | typeof mediaLists[number];

interface RecordRow { collection: string; id: string; seq: number; body: string }

const keyOf = (collection: ListName, item: { id?: Id; membershipId?: Id; capability?: string }) => collection === 'permissionOverrides' ? `${item.membershipId}:${item.capability}` : item.id as Id;

/** 通知と個人の設定は人ごとに持ち、読み込むときに本人の分だけを取り出す。 */
const personal = (membershipId: Id) => ({ privacy: `privacy:${membershipId}`, preferences: `notificationPreferences:${membershipId}` });

function read(rows: RecordRow[], collection: string) {
  return rows.filter((row) => row.collection === collection).sort((a, b) => a.seq - b.seq).map((row) => JSON.parse(row.body));
}

export interface LoadedAggregate {
  aggregate: HouseholdAggregate;
  /** 読み込んだ時点の本文。保存のときに変わった記録だけを書くために比べる。 */
  loaded: Map<string, RecordRow>;
}

export interface LoadOptions { media?: boolean }

export function loadAggregate(db: Db, householdId: Id, actorMembershipId: Id, defaults: Pick<HouseholdAggregate, 'privacy' | 'notificationPreferences'>, options: LoadOptions = {}): LoadedAggregate {
  // アルバムの記録は件数が多くなるので、使わない操作では読み込まない。
  const rows = options.media
    ? db.all<RecordRow>('SELECT collection, id, seq, body FROM records WHERE household_id = ?', householdId)
    : db.all<RecordRow>("SELECT collection, id, seq, body FROM records WHERE household_id = ? AND collection NOT IN ('albums', 'albumItems')", householdId);
  const loaded = new Map(rows.map((row) => [`${row.collection}\u0000${row.id}`, row]));
  const single = <T,>(id: string, fallback: T): T => { const row = loaded.get(`meta\u0000${id}`); return row ? JSON.parse(row.body) as T : fallback; };
  const keys = personal(actorMembershipId);
  const state: HouseholdSnapshot = {
    ...single<Pick<HouseholdSnapshot, 'household' | 'context'>>('household', { household: { id: householdId, name: '', timezone: 'Asia/Tokyo' }, context: { asOf: '', timezone: 'Asia/Tokyo', weather: { location: '', condition: 'sunny', temperatureC: 0, precipitationPercent: 0 }, holidays: [], sync: { state: 'synced', lastSyncedAt: '' } } }),
    viewer: { userId: '', membershipId: actorMembershipId, role: 'guest', status: 'active', capabilities: [], permissionRevision: 0 },
    permissionOverrides: [],
    user: { id: '', displayName: '', email: '', avatarTone: 'indigo' },
    memberships: read(rows, 'memberships'),
    events: read(rows, 'events'),
    todos: read(rows, 'todos'),
    memos: read(rows, 'memos'),
    expenses: read(rows, 'expenses'),
    resources: read(rows, 'resources'),
    links: read(rows, 'links'),
    colorLabels: read(rows, 'colorLabels'),
  };
  const archive = <T,>(name: string): Record<Id, T> => Object.fromEntries(rows.filter((row) => row.collection === `archive.${name}`).map((row) => [row.id, JSON.parse(row.body) as T]));
  const aggregate: HouseholdAggregate = {
    state,
    permissionOverrides: read(rows, 'permissionOverrides'),
    permissionRevision: single<number>('permissionRevision', 1),
    invites: read(rows, 'invites'),
    notifications: read(rows, 'notifications').filter((item: { recipientMembershipId?: Id }) => item.recipientMembershipId === actorMembershipId),
    notificationPreferences: single(keys.preferences, defaults.notificationPreferences),
    privacy: single(keys.privacy, defaults.privacy),
    archives: { events: archive('events'), todos: archive('todos'), memos: archive('memos'), expenses: archive('expenses') },
    albums: read(rows, 'albums'),
    albumItems: read(rows, 'albumItems'),
    occurrenceDeletions: single('occurrenceDeletions', []),
  };
  return { aggregate, loaded };
}

export function saveAggregate(db: Db, householdId: Id, actorMembershipId: Id, { aggregate, loaded }: LoadedAggregate, options: LoadOptions = {}) {
  const { state } = aggregate;
  const wanted = new Map<string, { collection: string; id: string; body: string; order?: number }>();
  const put = (collection: string, id: string, value: unknown, order?: number) => wanted.set(`${collection}\u0000${id}`, { collection, id, body: JSON.stringify(value), order });
  const sources: Record<typeof lists[number], ReadonlyArray<object>> = {
    memberships: state.memberships, events: state.events, todos: state.todos, memos: state.memos, expenses: state.expenses, resources: state.resources,
    links: state.links, colorLabels: state.colorLabels, invites: aggregate.invites,
    notifications: aggregate.notifications.map((item) => ({ recipientMembershipId: actorMembershipId, ...item })), permissionOverrides: aggregate.permissionOverrides,
  };
  for (const collection of lists) sources[collection].forEach((item, index) => put(collection, keyOf(collection, item), item, index));
  if (options.media) for (const collection of mediaLists) aggregate[collection].forEach((item, index) => put(collection, item.id, item, index));
  for (const name of archives) for (const [id, value] of Object.entries(aggregate.archives[name])) put(`archive.${name}`, id, value);
  const keys = personal(actorMembershipId);
  put('meta', 'household', { household: state.household, context: state.context });
  put('meta', 'permissionRevision', aggregate.permissionRevision);
  put('meta', 'occurrenceDeletions', aggregate.occurrenceDeletions);
  put('meta', keys.privacy, aggregate.privacy);
  put('meta', keys.preferences, aggregate.notificationPreferences);

  const seqs = new Map<string, { min: number; max: number }>();
  for (const row of loaded.values()) {
    const range = seqs.get(row.collection) ?? { min: 0, max: 0 };
    seqs.set(row.collection, { min: Math.min(range.min, row.seq), max: Math.max(range.max, row.seq) });
  }
  for (const [key, entry] of wanted) {
    const current = loaded.get(key);
    if (current?.body === entry.body) continue;
    if (current) { db.run('UPDATE records SET body = ? WHERE household_id = ? AND collection = ? AND id = ?', entry.body, householdId, entry.collection, entry.id); continue; }
    // 先頭に足した記録は小さい番号、末尾に足した記録は大きい番号にして、配列の順を保つ。
    const range = seqs.get(entry.collection) ?? { min: 0, max: 0 };
    const seq = entry.order === 0 && range.max > range.min ? range.min - 1 : range.max + 1;
    seqs.set(entry.collection, { min: Math.min(range.min, seq), max: Math.max(range.max, seq) });
    db.run('INSERT INTO records (household_id, collection, id, seq, body) VALUES (?, ?, ?, ?, ?)', householdId, entry.collection, entry.id, seq, entry.body);
  }
  for (const [key, row] of loaded) {
    if (wanted.has(key) || row.collection === 'meta') continue;
    // 通知は本人の分だけを読み込むので、ほかの人の通知を消さない。
    if (row.collection === 'notifications' && (JSON.parse(row.body) as { recipientMembershipId?: Id }).recipientMembershipId !== actorMembershipId) continue;
    db.run('DELETE FROM records WHERE household_id = ? AND collection = ? AND id = ?', householdId, row.collection, row.id);
  }
}
