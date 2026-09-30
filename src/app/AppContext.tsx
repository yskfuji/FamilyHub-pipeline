import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { createMockGateway } from '../data/mockGateway';
import { baseSnapshot } from '../data/fixtures';
import type { FamilyHubGateway } from '../data/gateway';
import type { GatewayError, HouseholdSnapshot, Scenario, Theme } from '../domain/types';
import { useModalTriggerTracking } from '../design-system/components';

interface AppState {
  gateway: FamilyHubGateway;
  snapshot: HouseholdSnapshot;
  loading: boolean;
  error: GatewayError | null;
  scenario: Scenario;
  setScenario: (scenario: Scenario) => void;
  refresh: () => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toast: string | null;
  announce: (message: string) => void;
}

const AppContext = createContext<AppState | null>(null);
const gateway = createMockGateway();

function queryScenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get('scenario');
  const allowed: Scenario[] = ['normal','empty','loading','offline','conflict','expired-invite','expired-session','quarantined','weather'];
  return allowed.includes(value as Scenario) ? value as Scenario : 'normal';
}

export function AppProvider({ children }: PropsWithChildren) {
  useModalTriggerTracking();
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot>(structuredClone(baseSnapshot));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GatewayError | null>(null);
  const [scenario, setScenarioState] = useState<Scenario>(queryScenario);
  const [theme, setThemeState] = useState<Theme>(() => localStorage.getItem('family-hub-theme') === 'dusk' ? 'dusk' : 'light');
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const result = await gateway.household.getSnapshot(scenario);
    if (result.ok) setSnapshot(result.value);
    else setError(result.error);
    setLoading(false);
  }, [scenario]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('family-hub-theme', theme); }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const setScenario = (next: Scenario) => {
    const url = new URL(window.location.href);
    if (next === 'normal') url.searchParams.delete('scenario'); else url.searchParams.set('scenario', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    setScenarioState(next);
  };
  const setTheme = (next: Theme) => setThemeState(next);
  const announce = (message: string) => setToast(message);
  const value = useMemo(() => ({ gateway, snapshot, loading, error, scenario, setScenario, refresh, theme, setTheme, toast, announce }), [snapshot, loading, error, scenario, refresh, theme, toast]);
  return <AppContext.Provider value={value}>{children}<div className="sr-only" role="status" aria-live="polite">{toast}</div>{toast && <div className="toast-visible" role="status">{toast}</div>}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be inside AppProvider');
  return value;
}

export function memberName(snapshot: HouseholdSnapshot, id?: string) {
  return snapshot.memberships.find((member) => member.id === id)?.displayName ?? '未設定';
}
