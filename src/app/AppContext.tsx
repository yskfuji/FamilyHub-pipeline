import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { createMockGateway } from '../data/mockGateway';
import { baseSnapshot } from '../data/fixtures';
import type { FamilyHubGateway } from '../data/gateway';
import type { Capability, GatewayError, HouseholdSnapshot, Result, Scenario, Theme } from '../domain/types';
import { useModalTriggerTracking } from '../design-system/components';
import { capabilitiesFor, projectSnapshotForViewer } from '../authz/policy';
import { EncryptedOfflineQueue, IndexedDbQueuePersistence, type QueueableCommand, type QueuedCommand } from '../offline/queue';
import { useControlRegistry } from './controlRegistry';

export type CommandOutcome<T> = { status: 'completed'; value: T } | { status: 'queued' } | { status: 'failed'; error: GatewayError };

interface AppState {
  gateway: FamilyHubGateway; snapshot: HouseholdSnapshot; loading: boolean; error: GatewayError | null;
  scenario: Scenario; setScenario: (scenario: Scenario) => void; refresh: () => Promise<void>;
  theme: Theme; setTheme: (theme: Theme) => void; toast: string | null; announce: (message: string) => void;
  can: (capability: Capability) => boolean;
  requestQuickCreate: (kind?: 'todo' | 'event' | 'expense') => void;
  executeQueueable: <T>(command: QueueableCommand, execute: () => Promise<Result<T>>) => Promise<CommandOutcome<T>>;
  pendingCommands: QueuedCommand[]; retryQueued: (id?: string) => Promise<void>;
  discardQueued: (id: string) => Promise<void>; clearQueued: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

function queryScenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get('scenario');
  const allowed: Scenario[] = ['normal','empty','loading','offline','conflict','expired-invite','expired-session','quarantined','weather'];
  return allowed.includes(value as Scenario) ? value as Scenario : 'normal';
}

function queryActor() {
  const requested = new URLSearchParams(window.location.search).get('actor');
  const auditSurface = import.meta.env.VITE_INCLUDE_AUDIT_SURFACE === 'true';
  return auditSurface && baseSnapshot.memberships.some((item) => item.id === requested) ? requested! : 'member-aoi';
}

function initialSnapshot(actorId: string): HouseholdSnapshot {
  let snapshot = structuredClone(baseSnapshot);
  const member = snapshot.memberships.find((item) => item.id === actorId) ?? snapshot.memberships[0];
  const viewer = { userId: member.userId, membershipId: member.id, role: member.role, status: member.status, capabilities: capabilitiesFor(member.role), permissionRevision: 1 } as HouseholdSnapshot['viewer'];
  snapshot = projectSnapshotForViewer(snapshot, viewer);
  snapshot.user = { ...snapshot.user, id: member.userId, displayName: member.displayName, email: `${member.userId}@example.test` };
  return snapshot;
}

function setQueryScenario(next: Scenario) {
  const url = new URL(window.location.href);
  if (next === 'normal') url.searchParams.delete('scenario'); else url.searchParams.set('scenario', next);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

export function AppProvider({ children }: PropsWithChildren) {
  useModalTriggerTracking();
  useControlRegistry();
  const [actorId] = useState(queryActor);
  const [gateway] = useState(() => createMockGateway(actorId));
  const [queue] = useState(() => new EncryptedOfflineQueue(new IndexedDbQueuePersistence()));
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot>(() => initialSnapshot(actorId));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GatewayError | null>(null);
  const [scenario, setScenarioState] = useState<Scenario>(queryScenario);
  const [theme, setThemeState] = useState<Theme>(() => localStorage.getItem('family-hub-theme') === 'dusk' ? 'dusk' : 'light');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<QueuedCommand[]>([]);

  const loadQueue = useCallback(async () => {
    try {
      const items = await queue.list();
      const mismatched = items.some((item) => item.actorUserId !== snapshot.viewer.userId || item.householdId !== snapshot.household.id);
      if (mismatched) { await queue.clear(); setPendingCommands([]); setToast('別のアカウントで保存された未送信の変更を削除しました。'); return; }
      setPendingCommands(items);
    } catch { setPendingCommands([]); setToast('未送信の変更を読み込めませんでした。ブラウザの保存設定を確認してください。'); }
  }, [queue, snapshot.viewer.userId, snapshot.household.id]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const result = await gateway.household.getSnapshot(scenario);
    if (result.ok) setSnapshot(result.value); else setError(result.error);
    setLoading(false);
  }, [gateway, scenario]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => { queueMicrotask(() => void loadQueue()); }, [loadQueue]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('family-hub-theme', theme); }, [theme]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(id); }, [toast]);

  const setScenario = (next: Scenario) => { setQueryScenario(next); setScenarioState(next); };
  const announce = useCallback((message: string) => setToast(message), []);
  const requestQuickCreate = useCallback((kind?: 'todo' | 'event' | 'expense') => window.dispatchEvent(new CustomEvent('family-hub:quick-create', { detail: { kind } })), []);
  const can = useCallback((capability: Capability) => snapshot.viewer.status === 'active' && snapshot.viewer.capabilities.includes(capability), [snapshot.viewer]);

  const executeQueueable = useCallback(async <T,>(command: QueueableCommand, execute: () => Promise<Result<T>>): Promise<CommandOutcome<T>> => {
    const result = await execute();
    if (result.ok) return { status: 'completed', value: result.value };
    if (result.error.code !== 'OFFLINE') return { status: 'failed', error: result.error };
    try {
      await queue.enqueue(command, { actorUserId: snapshot.viewer.userId, householdId: snapshot.household.id, permissionRevision: snapshot.viewer.permissionRevision });
      await loadQueue(); announce('未送信の変更として、この端末に保存しました。'); return { status: 'queued' };
    } catch (cause) {
      return { status: 'failed', error: { code: 'OFFLINE', message: cause instanceof Error ? cause.message : result.error.message, retryable: true } };
    }
  }, [announce, loadQueue, queue, snapshot]);

  const executeStored = useCallback(async (command: QueuedCommand): Promise<Result<unknown>> => {
    const context = { idempotencyKey: command.clientOperationId, expectedPermissionRevision: command.permissionRevision };
    switch (command.operation) {
      case 'event.create': return gateway.events.createEvent(command.payload.input, context);
      case 'event.update': return gateway.events.updateEvent(command.payload.id, command.payload.scope, command.payload.input, command.payload.expectedVersion, context);
      case 'task.create': return gateway.todos.createTodo(command.payload.input, context);
      case 'task.update': return gateway.todos.updateTodo(command.payload.id, command.payload.scope, command.payload.input, command.payload.expectedVersion, context);
      case 'memo.create': return gateway.memos.createMemo(command.payload.input, context);
      case 'memo.update': return gateway.memos.updateMemo(command.payload.id, command.payload.input, command.payload.expectedVersion, context);
    }
  }, [gateway]);

  const retryQueued = useCallback(async (id?: string) => {
    const probe = await gateway.household.getSnapshot('normal');
    if (!probe.ok) { announce(`${probe.error.message} 接続を確認してから、もう一度お試しください。`); return; }
    setQueryScenario('normal'); setScenarioState('normal'); setSnapshot(probe.value); setError(null);
    const targets = (await queue.list()).filter((item) => !id || item.id === id);
    let sent = 0;
    for (const item of targets) {
      const result = await executeStored(item);
      if (result.ok) { await queue.remove(item.id); sent += 1; }
      else if (result.error.code === 'CONFLICT') await queue.mark(item.id, 'conflicted');
      else if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') await queue.mark(item.id, 'blocked');
      else { announce(`${item.summary}を送信できませんでした。${result.error.message}`); break; }
    }
    await loadQueue(); const updated = await gateway.household.getSnapshot('normal'); if (updated.ok) setSnapshot(updated.value);
    announce(sent ? `${sent}件を送信しました。` : '送信できる変更はありません。最新の内容と権限を確認してください。');
  }, [announce, executeStored, gateway, loadQueue, queue]);

  const discardQueued = useCallback(async (id: string) => { await queue.remove(id); await loadQueue(); announce('未送信の変更を削除しました。'); }, [announce, loadQueue, queue]);
  const clearQueued = useCallback(async () => { await queue.clear(); setPendingCommands([]); announce('未送信の変更をすべて削除しました。'); }, [announce, queue]);

  const value = useMemo(() => ({ gateway, snapshot, loading, error, scenario, setScenario, refresh, theme, setTheme: setThemeState, toast, announce, can, requestQuickCreate, executeQueueable, pendingCommands, retryQueued, discardQueued, clearQueued }), [gateway, snapshot, loading, error, scenario, refresh, theme, toast, announce, can, requestQuickCreate, executeQueueable, pendingCommands, retryQueued, discardQueued, clearQueued]);
  return <AppContext.Provider value={value}>{children}<div className="sr-only" role="status" aria-live="polite">{toast}</div>{toast && <div className="toast-visible" role="status">{toast}</div>}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be inside AppProvider');
  return value;
}

export function memberName(snapshot: HouseholdSnapshot, id?: string) {
  return snapshot.memberships.find((member) => member.id === id)?.displayName ?? '非公開';
}
