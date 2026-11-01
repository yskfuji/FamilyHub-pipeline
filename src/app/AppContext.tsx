import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { FamilyHubGateway } from '../data/gateway';
import type { Capability, GatewayError, HouseholdSnapshot, PrivacySettings, Result, Scenario, SessionInfo, Theme } from '../domain/types';
import { useModalTriggerTracking } from '../design-system/components';
import { EncryptedOfflineQueue, IndexedDbQueuePersistence, type QueueableCommand, type QueuedCommand } from '../offline/queue';

import type { AppRuntime } from './runtime';

export type AppStage = 'restoring' | 'unreachable' | 'signed-out' | 'household-setup' | 'suspended' | 'paywall' | 'ready';
export type QuickCreateKind = 'todo' | 'event' | 'memo' | 'expense';
export type CommandOutcome<T> = { status: 'completed'; value: T } | { status: 'queued' } | { status: 'failed'; error: GatewayError };

interface AppState {
  gateway: FamilyHubGateway; runtimeMode: AppRuntime['mode']; appStage: AppStage; session: SessionInfo | null;
  /** サインインの後に状態を読み直し、次に開くパスを返す。 */
  finishSignIn: (fallback: string) => Promise<string>;
  endSession: () => Promise<Result<void>>;
  snapshot: HouseholdSnapshot; loading: boolean; refreshing: boolean; error: GatewayError | null;
  scenario: Scenario; setScenario: (scenario: Scenario) => void; refresh: () => Promise<void>;
  theme: Theme; setTheme: (theme: Theme) => void; toast: string | null; announce: (message: string) => void;
  can: (capability: Capability) => boolean;
  /** 本人のプライバシー設定。読み込み前は null。 */
  privacy: PrivacySettings | null;
  /** 最新の設定を取り直してから、渡した項目だけを変えて保存する（別の画面での変更を上書きしない）。 */
  updatePrivacy: (patch: Partial<PrivacySettings>) => Promise<Result<PrivacySettings>>;
  requestQuickCreate: (kind?: QuickCreateKind) => void;
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

function setQueryScenario(next: Scenario) {
  const url = new URL(window.location.href);
  if (next === 'normal') url.searchParams.delete('scenario'); else url.searchParams.set('scenario', next);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

export function AppProvider({ runtime, children }: PropsWithChildren<{ runtime: AppRuntime }>) {
  useModalTriggerTracking();
  const { gateway } = runtime;
  const [session, setSession] = useState<SessionInfo | null>(runtime.initialSession);
  const [unreachable, setUnreachable] = useState(false);
  const [queue] = useState(() => new EncryptedOfflineQueue(new IndexedDbQueuePersistence()));
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot>(runtime.initialSnapshot);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 最初の読み込みと表示状態の切り替えだけ画面全体を待機表示にする。それ以外の再取得では画面と操作中の状態（取り消し・復元の案内など）を保つ。
  const blockingLoad = useRef(true);
  const [error, setError] = useState<GatewayError | null>(null);
  const [scenario, setScenarioState] = useState<Scenario>(queryScenario);
  const [theme, setThemeState] = useState<Theme>(() => localStorage.getItem('family-hub-theme') === 'dusk' ? 'dusk' : 'light');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<QueuedCommand[]>([]);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const items = await queue.list();
      const mismatched = items.some((item) => item.actorUserId !== snapshot.viewer.userId || item.householdId !== snapshot.household.id);
      if (mismatched) { await queue.clear(); setPendingCommands([]); setToast('別のアカウントで保存された未送信の変更を削除しました。'); return; }
      setPendingCommands(items);
    } catch { setPendingCommands([]); setToast('未送信の変更を読み込めませんでした。ブラウザの保存設定を確認してください。'); }
  }, [queue, snapshot.viewer.userId, snapshot.household.id]);

  const refresh = useCallback(async () => {
    const blocking = blockingLoad.current;
    blockingLoad.current = false;
    if (blocking) setLoading(true); else setRefreshing(true);
    setError(null);
    if (runtime.mode === 'http') {
      const current = await gateway.auth.getSession();
      setUnreachable(!current.ok);
      if (current.ok) setSession(current.value);
      if (!current.ok || current.value.stage !== 'active') {
        if (blocking) setLoading(false); else setRefreshing(false);
        return;
      }
    }
    const result = await gateway.household.getSnapshot(scenario);
    if (result.ok) { setSnapshot(result.value); runtime.setPermissionRevision(result.value.viewer.permissionRevision); } else setError(result.error);
    if (blocking) setLoading(false); else setRefreshing(false);
  }, [gateway, runtime, scenario]);

  const finishSignIn = useCallback(async (fallback: string) => {
    if (runtime.mode === 'mock') return fallback;
    blockingLoad.current = true;
    const current = await gateway.auth.getSession();
    if (current.ok) setSession(current.value);
    await refresh();
    return current.ok && current.value.stage === 'household-setup' ? '/onboarding' : '/today';
  }, [gateway, refresh, runtime.mode]);
  const endSession = useCallback(async () => {
    const result = await gateway.auth.signOut();
    if (result.ok && runtime.mode === 'http') { setSession({ stage: 'signed-out', idleTimeoutMinutes: 30 }); setSnapshot(runtime.initialSnapshot); setPrivacy(null); }
    return result;
  }, [gateway, runtime]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => {
    if (!snapshot.viewer.capabilities.includes('settings.own')) return;
    let mounted = true;
    void gateway.household.getPrivacySettings().then((result) => { if (mounted && result.ok) { setPrivacy(result.value); privacyBefore.current = result.value; } });
    return () => { mounted = false; };
  }, [gateway, snapshot.viewer.capabilities]);
  // 読み込みと保存の組を順に処理する。続けて操作しても、先の保存が後の変更を上書きしないようにする。
  const privacyQueue = useRef<Promise<unknown>>(Promise.resolve());
  const privacyBefore = useRef<PrivacySettings | null>(null);
  const updatePrivacy = useCallback((patch: Partial<PrivacySettings>): Promise<Result<PrivacySettings>> => {
    // 同意の取り消しなどは保存を待たずに全画面へ反映する。保存できなければ記録された内容へ戻す。
    setPrivacy((current) => current && { ...current, ...patch });
    const run = async (): Promise<Result<PrivacySettings>> => {
      const latest = await gateway.household.getPrivacySettings();
      if (!latest.ok) { setPrivacy((current) => current && { ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, privacyBefore.current?.[key as keyof PrivacySettings]])) }); return latest; }
      const result = await gateway.household.savePrivacySettings({ ...latest.value, ...patch });
      setPrivacy(result.ok ? result.value : latest.value);
      if (result.ok) privacyBefore.current = result.value;
      return result;
    };
    const next = privacyQueue.current.then(run, run);
    privacyQueue.current = next;
    return next;
  }, [gateway]);
  useEffect(() => { queueMicrotask(() => void loadQueue()); }, [loadQueue]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('family-hub-theme', theme); }, [theme]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(id); }, [toast]);

  const setScenario = (next: Scenario) => { blockingLoad.current = true; setQueryScenario(next); setScenarioState(next); };
  const announce = useCallback((message: string) => setToast(message), []);
  const requestQuickCreate = useCallback((kind?: QuickCreateKind) => window.dispatchEvent(new CustomEvent('family-hub:quick-create', { detail: { kind } })), []);
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
      case 'event.update': return gateway.events.updateEvent(command.payload.id, command.payload.scope, command.payload.input, command.payload.expectedVersion, context, command.payload.occurrenceDate);
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

  const appStage: AppStage = unreachable ? 'unreachable' : session === null ? 'restoring'
    : session.stage === 'active' ? 'ready' : session.stage;
  const value = useMemo(() => ({ gateway, runtimeMode: runtime.mode, appStage, session, finishSignIn, endSession, snapshot, loading, refreshing, error, scenario, setScenario, refresh, theme, setTheme: setThemeState, toast, announce, can, privacy, updatePrivacy, requestQuickCreate, executeQueueable, pendingCommands, retryQueued, discardQueued, clearQueued }), [appStage, endSession, finishSignIn, runtime.mode, session, gateway, snapshot, loading, refreshing, error, scenario, refresh, theme, toast, announce, can, privacy, updatePrivacy, requestQuickCreate, executeQueueable, pendingCommands, retryQueued, discardQueued, clearQueued]);
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
