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
import { ShowcasePage } from '../features/showcase/ShowcasePage';
import { EmptyState } from '../design-system/components';

export default function App() {
  const path = usePath();
  if (path === '/' || path === '/welcome') return <WelcomePage/>;
  if (path === '/auth') return <AuthPage/>;
  if (path === '/onboarding') return <OnboardingPage/>;
  let page;
  if (path.startsWith('/today')) page = <TodayPage/>;
  else if (path.startsWith('/calendar')) page = <CalendarPage path={path}/>;
  else if (path.startsWith('/tasks')) page = <TasksPage path={path}/>;
  else if (path.startsWith('/notes')) page = <NotesPage path={path}/>;
  else if (path.startsWith('/budget')) page = <BudgetPage/>;
  else if (path.startsWith('/insights')) page = <InsightsPage/>;
  else if (path.startsWith('/settings')) page = <SettingsPage path={path}/>;
  else if (path.startsWith('/showcase')) page = <ShowcasePage/>;
  else page = <div className="page"><EmptyState title="ページが見つかりません" action={<a className="button primary" href="/today" data-link>今日へ戻る</a>}>URLを確認してください。</EmptyState></div>;
  return <Shell path={path}>{page}</Shell>;
}
