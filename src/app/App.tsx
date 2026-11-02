import type { ReactNode } from 'react';
import { Shell } from './Shell';
import { usePath } from './router';
import { WelcomePage } from '../features/auth/WelcomePage';
import { AuthPage } from '../features/auth/AuthPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { OnboardingPage } from '../features/auth/OnboardingPage';
import { TodayPage } from '../features/today/TodayPage';
import { CalendarPage } from '../features/calendar/CalendarPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { NotesPage } from '../features/notes/NotesPage';
import { BudgetPage } from '../features/budget/BudgetPage';
import { AlbumsPage } from '../features/albums/AlbumsPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { SettingsPage, settingsTabFor, settingsTabs } from '../features/settings/SettingsPage';
import { PlacesPage } from '../features/places/PlacesPage';
import { PublicLegalPage } from '../features/settings/PublicLegalPage';
import { navigate } from './router';
import { useEffect } from 'react';
import { EmptyState } from '../design-system/components';
import { useApp } from './AppContext';
import { IdleGuard } from './IdleGuard';
import { StageScreen } from './StageScreens';
import type { Capability } from '../domain/types';
import { AuditPage, auditPath } from '@audit-surface';

function PermissionBoundary({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useApp();
  if (can(capability)) return children;
  return <div className="page"><EmptyState title="このページは表示できません" action={<a data-control-id="route.today.permission-denied" className="button primary" href="/today" data-link>今日の画面に戻る</a>}>現在の役割では利用できません。必要な場合は、管理者に権限を確認してください。</EmptyState></div>;
}

function NotFound() {
  return <div className="page"><EmptyState title="ページが見つかりません" action={<a data-control-id="route.today.not-found" className="button primary" href="/today" data-link>今日の画面に戻る</a>}>URLが正しいか確認してください。</EmptyState></div>;
}

/** `/settings` だけを開いたとき、利用できる最初のタブへ置き換える（家族タブへ黙って落とさない）。 */
function SettingsIndex() {
  const { can } = useApp();
  const first = settingsTabs.find((tab) => can(tab.capability));
  useEffect(() => { if (first) navigate(first.href, true); }, [first]);
  return first ? null : <PermissionBoundary capability="settings.own"><NotFound/></PermissionBoundary>;
}

export default function App() {
  const path = usePath();
  const { appStage } = useApp();
  // 接頭辞だけで一致させると /todayx なども通るため、区切りまで確認する。
  const at = (base: string) => path === base || path.startsWith(`${base}/`);
  const settingsTab = settingsTabFor(path);
  if (path === '/' || path === '/welcome') return <WelcomePage/>;
  if (path === '/auth') return <AuthPage/>;
  if (path === '/sign-up') return <SignUpPage/>;
  if (path === '/reset-password') return <ResetPasswordPage/>;
  if (path === '/onboarding') return <OnboardingPage/>;
  // 規約は登録の前に読めるようにする。
  if (path === '/settings/legal' && appStage !== 'ready') return <PublicLegalPage/>;
  if (appStage !== 'ready') return <StageScreen stage={appStage}/>;
  let page;
  if (at('/today')) page = <TodayPage/>;
  else if (at('/calendar')) page = <PermissionBoundary capability="event.read"><CalendarPage path={path}/></PermissionBoundary>;
  else if (at('/tasks')) page = <PermissionBoundary capability="task.read"><TasksPage path={path}/></PermissionBoundary>;
  else if (at('/notes')) page = <PermissionBoundary capability="memo.read"><NotesPage path={path}/></PermissionBoundary>;
  else if (at('/budget')) page = <PermissionBoundary capability="expense.read"><BudgetPage path={path}/></PermissionBoundary>;
  else if (at('/albums')) page = <PermissionBoundary capability="album.read"><AlbumsPage path={path}/></PermissionBoundary>;
  else if (at('/places')) page = <PermissionBoundary capability="place.read"><PlacesPage path={path}/></PermissionBoundary>;
  else if (at('/insights')) page = <PermissionBoundary capability="insight.read"><InsightsPage/></PermissionBoundary>;
  else if (path === '/settings' || path === '/settings/') page = <SettingsIndex/>;
  else if (settingsTab) page = <PermissionBoundary capability={settingsTab.capability}><SettingsPage path={path}/></PermissionBoundary>;
  else if (auditPath && at(auditPath)) page = <AuditPage path={path}/>;
  else page = <NotFound/>;
  return <><Shell path={path}>{page}</Shell><IdleGuard/></>;
}
