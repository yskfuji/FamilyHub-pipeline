import { Suspense, type ReactNode } from 'react';
import { Shell } from './Shell';
import { usePath } from './router';
import { settingsTabFor, settingsTabs } from '../features/settings/settingsTabs';
import { navigate } from './router';
import { useEffect } from 'react';
import { EmptyState } from '../design-system/components';
import { useApp } from './AppContext';
import { IdleGuard } from './IdleGuard';
import { StageScreen } from './StageScreens';
import type { Capability } from '../domain/types';
import { AuditPage, auditPath } from '@audit-surface';
import { PageLoading, RouteErrorBoundary, RouteReady, lazyRoute } from './routeLoading';

/**
 * 画面ごとに分けて読む。最初の表示では、開いた画面の分だけを読む（docs/acceptance/criteria.md の B「性能」）。
 * 名前つきの書き出しを default にそろえて React.lazy に渡す。
 */
const WelcomePage = lazyRoute(() => import('../features/auth/WelcomePage'), 'WelcomePage');
const AuthPage = lazyRoute(() => import('../features/auth/AuthPage'), 'AuthPage');
const ResetPasswordPage = lazyRoute(() => import('../features/auth/ResetPasswordPage'), 'ResetPasswordPage');
const SignUpPage = lazyRoute(() => import('../features/auth/SignUpPage'), 'SignUpPage');
const OnboardingPage = lazyRoute(() => import('../features/auth/OnboardingPage'), 'OnboardingPage');
const TodayPage = lazyRoute(() => import('../features/today/TodayPage'), 'TodayPage');
const CalendarPage = lazyRoute(() => import('../features/calendar/CalendarPage'), 'CalendarPage');
const TasksPage = lazyRoute(() => import('../features/tasks/TasksPage'), 'TasksPage');
const NotesPage = lazyRoute(() => import('../features/notes/NotesPage'), 'NotesPage');
const BudgetPage = lazyRoute(() => import('../features/budget/BudgetPage'), 'BudgetPage');
const AlbumsPage = lazyRoute(() => import('../features/albums/AlbumsPage'), 'AlbumsPage');
const InsightsPage = lazyRoute(() => import('../features/insights/InsightsPage'), 'InsightsPage');
const SettingsPage = lazyRoute(() => import('../features/settings/SettingsPage'), 'SettingsPage');
const PlacesPage = lazyRoute(() => import('../features/places/PlacesPage'), 'PlacesPage');
const PublicLegalPage = lazyRoute(() => import('../features/settings/PublicLegalPage'), 'PublicLegalPage');

/**
 * 経路ごとにエラー境界を置き、その中で読み込みを待つ。読み終えて描いたら RouteReady が印を書く。
 * 境界は path が変わると元に戻る。
 */
const loading = (node: ReactNode, path: string) => <RouteErrorBoundary resetKey={path}><Suspense fallback={<PageLoading/>}><RouteReady/>{node}</Suspense></RouteErrorBoundary>;

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
  if (path === '/' || path === '/welcome') return loading(<WelcomePage/>, path);
  if (path === '/auth') return loading(<AuthPage/>, path);
  if (path === '/sign-up') return loading(<SignUpPage/>, path);
  if (path === '/reset-password') return loading(<ResetPasswordPage/>, path);
  if (path === '/onboarding') return loading(<OnboardingPage/>, path);
  // 規約は登録の前に読めるようにする。
  if (path === '/settings/legal' && appStage !== 'ready') return loading(<PublicLegalPage/>, path);
  if (appStage !== 'ready') return loading(<StageScreen stage={appStage}/>, path);
  let content;
  if (at('/today')) content = <TodayPage/>;
  else if (at('/calendar')) content = <PermissionBoundary capability="event.read"><CalendarPage path={path}/></PermissionBoundary>;
  else if (at('/tasks')) content = <PermissionBoundary capability="task.read"><TasksPage path={path}/></PermissionBoundary>;
  else if (at('/notes')) content = <PermissionBoundary capability="memo.read"><NotesPage path={path}/></PermissionBoundary>;
  else if (at('/budget')) content = <PermissionBoundary capability="expense.read"><BudgetPage path={path}/></PermissionBoundary>;
  else if (at('/albums')) content = <PermissionBoundary capability="album.read"><AlbumsPage path={path}/></PermissionBoundary>;
  else if (at('/places')) content = <PermissionBoundary capability="place.read"><PlacesPage path={path}/></PermissionBoundary>;
  else if (at('/insights')) content = <PermissionBoundary capability="insight.read"><InsightsPage/></PermissionBoundary>;
  else if (path === '/settings' || path === '/settings/') content = <SettingsIndex/>;
  else if (settingsTab) content = <PermissionBoundary capability={settingsTab.capability}><SettingsPage path={path}/></PermissionBoundary>;
  else if (auditPath && at(auditPath)) content = <AuditPage path={path}/>;
  else content = <NotFound/>;
  return <><Shell path={path}>{loading(content, path)}</Shell><IdleGuard/></>;
}
