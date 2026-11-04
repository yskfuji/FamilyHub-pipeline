/** 管理コンソールの見本の型と規則。すべてこの画面の中で完結し、外へは何も送らない。 */
export type SectionId = 'overview' | 'services' | 'jobs' | 'backups' | 'audit-log' | 'households' | 'records';

export type ServiceStatus = 'ok' | 'warning';
export interface SampleService { id: string; name: string; status: ServiceStatus; summary: string; measure: string; checkedAt: string }

export interface SampleJob { id: string; title: string; description: string; pending: number; /** false は読み取りだけの確認で、実行の操作を持たない。 */ changesRecords: boolean }
export interface SampleJobRun { id: string; jobId: string; mode: 'dry-run' | 'run'; status: 'succeeded' | 'failed'; at: string; count: number; actor: string }

export interface SampleBackup { id: string; name: string; sizeMb: number; checksum: string; status: 'verified' | 'unverified'; createdAt: string }

export type AuditCategory = 'service' | 'job' | 'backup' | 'household';
export interface SampleAuditEntry { id: string; at: string; actor: string; category: AuditCategory; action: string; target: string }

export type HouseholdStatus = 'trial' | 'active' | 'stopped';
export interface SampleHousehold { id: string; name: string; status: HouseholdStatus; members: number; endsAt: string | null }

export type RecordCollection = 'events' | 'tasks' | 'memos' | 'expenses';
export interface SampleRecord { id: string; collection: RecordCollection; title: string; household: string; updatedAt: string; waitingForDeletion: boolean; fields: readonly (readonly [string, string])[] }

export interface ConsoleState {
  now: string;
  nextId: number;
  services: readonly SampleService[];
  jobs: readonly SampleJob[];
  runs: readonly SampleJobRun[];
  backups: readonly SampleBackup[];
  audit: readonly SampleAuditEntry[];
  households: readonly SampleHousehold[];
  records: readonly SampleRecord[];
}

export type ConsoleAction =
  | { type: 'service.recheck'; id: string }
  | { type: 'job.dry-run'; id: string }
  | { type: 'job.run'; id: string }
  | { type: 'backup.create' }
  | { type: 'backup.verify'; id: string }
  | { type: 'household.extend'; id: string }
  | { type: 'household.stop'; id: string }
  | { type: 'household.resume'; id: string };

export const SAMPLE_OPERATOR = '見本の運営者A';
const EXTEND_DAYS = 30;

const addMinutes = (value: string, minutes: number) => shiftTime(value, minutes * 60_000);
function shiftTime(value: string, milliseconds: number) {
  const shifted = new Date(Date.parse(value) + milliseconds + 9 * 3_600_000).toISOString();
  return `${shifted.slice(0, 19)}+09:00`;
}

/** 操作のたびに1分進める。見本の表示は実際の時計に頼らない。 */
function withEntry(state: ConsoleState, category: AuditCategory, action: string, target: string): ConsoleState {
  const at = addMinutes(state.now, 1);
  const entry: SampleAuditEntry = { id: `sample-audit-${state.nextId}`, at, actor: SAMPLE_OPERATOR, category, action, target };
  return { ...state, now: at, nextId: state.nextId + 1, audit: [entry, ...state.audit] };
}

function runJob(state: ConsoleState, id: string, mode: SampleJobRun['mode']): ConsoleState {
  const job = state.jobs.find((item) => item.id === id);
  if (!job || (mode === 'run' && !job.changesRecords)) return state;
  const next = withEntry(state, 'job', mode === 'run' ? '見本の実行' : '試算', job.title);
  const run: SampleJobRun = { id: `sample-run-${state.nextId}`, jobId: id, mode, status: 'succeeded', at: next.now, count: job.pending, actor: SAMPLE_OPERATOR };
  const jobs = mode === 'run' ? next.jobs.map((item) => item.id === id ? { ...item, pending: 0 } : item) : next.jobs;
  return { ...next, jobs, runs: [run, ...next.runs] };
}

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'service.recheck': {
      const service = state.services.find((item) => item.id === action.id);
      if (!service) return state;
      const next = withEntry(state, 'service', '状態の再確認', service.name);
      return { ...next, services: next.services.map((item) => item.id === action.id ? { ...item, checkedAt: next.now } : item) };
    }
    case 'job.dry-run': return runJob(state, action.id, 'dry-run');
    case 'job.run': return runJob(state, action.id, 'run');
    case 'backup.create': {
      const number = state.backups.length + 1;
      const name = `見本のバックアップ${number}`;
      const next = withEntry(state, 'backup', '作成', name);
      const backup: SampleBackup = { id: `sample-backup-${state.nextId}`, name, sizeMb: 120 + number, checksum: `見本${String(number).padStart(4, '0')}`, status: 'unverified', createdAt: next.now };
      return { ...next, backups: [backup, ...next.backups] };
    }
    case 'backup.verify': {
      const backup = state.backups.find((item) => item.id === action.id);
      if (!backup || backup.status === 'verified') return state;
      const next = withEntry(state, 'backup', '検証', backup.name);
      return { ...next, backups: next.backups.map((item) => item.id === action.id ? { ...item, status: 'verified' as const } : item) };
    }
    case 'household.extend': {
      const household = state.households.find((item) => item.id === action.id);
      if (!household || household.status === 'stopped') return state;
      const next = withEntry(state, 'household', `利用期間を${EXTEND_DAYS}日延長`, household.name);
      const base = household.endsAt && household.endsAt > next.now ? household.endsAt : next.now;
      return { ...next, households: next.households.map((item) => item.id === action.id ? { ...item, status: 'active' as const, endsAt: shiftTime(base, EXTEND_DAYS * 86_400_000) } : item) };
    }
    case 'household.stop':
    case 'household.resume': {
      const household = state.households.find((item) => item.id === action.id);
      const stopping = action.type === 'household.stop';
      if (!household || (household.status === 'stopped') === stopping) return state;
      const next = withEntry(state, 'household', stopping ? '利用の停止' : '利用の再開', household.name);
      return { ...next, households: next.households.map((item) => item.id === action.id ? { ...item, status: stopping ? 'stopped' as const : 'active' as const } : item) };
    }
  }
}

const includes = (query: string, ...values: readonly string[]) => {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => value.toLowerCase().includes(needle));
};

export function consoleSummary(state: ConsoleState) {
  const healthy = state.services.filter((item) => item.status === 'ok').length;
  const activeRecords = state.records.filter((item) => !item.waitingForDeletion).length;
  const countHouseholds = (status: HouseholdStatus) => state.households.filter((item) => item.status === status).length;
  return {
    healthy,
    services: state.services.length,
    households: state.households.length,
    active: countHouseholds('active'),
    trial: countHouseholds('trial'),
    stopped: countHouseholds('stopped'),
    activeRecords,
    waitingForDeletion: state.records.length - activeRecords,
    failedRuns: state.runs.filter((item) => item.status === 'failed').length,
    unverifiedBackups: state.backups.filter((item) => item.status === 'unverified').length,
    latestBackup: state.backups[0]?.createdAt ?? null,
  };
}

export const filterAudit = (entries: readonly SampleAuditEntry[], category: AuditCategory | 'all', query: string) =>
  entries.filter((entry) => (category === 'all' || entry.category === category) && includes(query, entry.action, entry.target, entry.actor));

export const filterHouseholds = (households: readonly SampleHousehold[], query: string) =>
  households.filter((household) => includes(query, household.name, household.id));

export const filterRecords = (records: readonly SampleRecord[], collection: RecordCollection, query: string, showWaiting: boolean) =>
  records.filter((record) => record.collection === collection && (showWaiting || !record.waitingForDeletion) && includes(query, record.title, record.household, record.id));
