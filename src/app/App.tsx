import type { ReactNode } from 'react';
import { Shell } from './Shell';
import { usePath } from './router';
import { WelcomePage } from '../features/auth/WelcomePage';
import { AuthPage } from '../features/auth/AuthPage';
import { OnboardingPage } from '../features/auth/OnboardingPage';
import { TodayPage } from '../features/today/TodayPage';
import { CalendarPage } from '../features/calendar/CalendarPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { NotesPage } from '../features/notes/NotesPage';
import { BudgetPage } from '../features/budget/BudgetPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { EmptyState } from '../design-system/components';
import { useApp } from './AppContext';
import type { Capability } from '../domain/types';
import { AuditPage, auditPath } from '@audit-surface';

function PermissionBoundary({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useApp();
  if (can(capability)) return children;
  return <div className="page"><EmptyState title="このページは表示できません" action={<a data-control-id="route.today.permission-denied" className="button primary" href="/today" data-link>今日の画面に戻る</a>}>現在の役割では利用できません。必要な場合は、管理者に権限を確認してください。</EmptyState></div>;
}

export default function App() {
  const path = usePath();
  if (path === '/' || path === '/welcome') return <WelcomePage/>;
  if (path === '/auth') return <AuthPage/>;
  if (path === '/onboarding') return <OnboardingPage/>;
  let page;
  if (path.startsWith('/today')) page = <TodayPage/>;
  else if (path.startsWith('/calendar')) page = <PermissionBoundary capability="event.read"><CalendarPage path={path}/></PermissionBoundary>;
  else if (path.startsWith('/tasks')) page = <PermissionBoundary capability="task.read"><TasksPage path={path}/></PermissionBoundary>;
  else if (path.startsWith('/notes')) page = <PermissionBoundary capability="memo.read"><NotesPage path={path}/></PermissionBoundary>;
  else if (path.startsWith('/budget')) page = <PermissionBoundary capability="expense.read"><BudgetPage/></PermissionBoundary>;
  else if (path.startsWith('/insights')) page = <PermissionBoundary capability="insight.read"><InsightsPage/></PermissionBoundary>;
  else if (path.startsWith('/settings/location')) page = <PermissionBoundary capability="place.read"><SettingsPage path={path}/></PermissionBoundary>;
  else if (path.startsWith('/settings/household')) page = <PermissionBoundary capability="household.members.read"><SettingsPage path={path}/></PermissionBoundary>;
  else if (path.startsWith('/settings')) page = <PermissionBoundary capability="settings.own"><SettingsPage path={path}/></PermissionBoundary>;
  else if (auditPath && path.startsWith(auditPath)) page = <AuditPage/>;
  else page = <div className="page"><EmptyState title="ページが見つかりません" action={<a data-control-id="route.today.not-found" className="button primary" href="/today" data-link>今日の画面に戻る</a>}>URLが正しいか確認してください。</EmptyState></div>;
  return <Shell path={path}>{page}</Shell>;
}
