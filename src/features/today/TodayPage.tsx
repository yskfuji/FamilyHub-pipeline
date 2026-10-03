import { useApp, memberName } from '../../app/AppContext';
import { EmptyState, PageHeader, StatusBadge, formatDue, formatTime, formatYen } from '../../design-system/components';
import { AlertIcon, ArrowIcon, CheckIcon, RainIcon, SunIcon } from '../../design-system/icons';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { unsettledSummary } from '../../domain/ledger';
import { occurrenceDates, occurrenceStartsAt } from '../../domain/recurrence';
import type { CalendarEvent } from '../../domain/types';

const monthDay = (asOf: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(asOf));
const greeting = (asOf: string) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(new Date(asOf)));
  return hour < 10 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';
};
/** 今日に当たる回（繰り返しを含む）を、その回の開始日時付きで返す。 */
const todaysEvents = (events: CalendarEvent[], today: string) => events.flatMap((event) => {
  const start = dateKeyFromRfc3339(event.startsAt);
  const hit = event.recurrence ? occurrenceDates(start, event.recurrence, today, today).length > 0 : start === today;
  return hit ? [{ ...event, startsAt: occurrenceStartsAt(event.startsAt, today) }] : [];
});
const weatherTitle = { rain: '雨と予定', storm: '荒天と予定', sunny: '天気と予定' } as const;

export function TodayPage() {
  const { snapshot, loading, can, requestQuickCreate } = useApp();
  const { asOf, weather, sync } = snapshot.context;
  const today = dateKeyFromRfc3339(asOf);
  const me = snapshot.viewer.membershipId;
  const mine = snapshot.todos.filter((todo) => todo.assigneeMembershipId === me && todo.status !== 'done').sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const unsettled = unsettledSummary(snapshot.expenses);
  const reviewTodo = snapshot.todos.find((todo) => todo.status === 'review' && (todo.reviewerMembershipId === me || todo.assigneeMembershipId === me));
  const events = todaysEvents(snapshot.events, today);
  const affected = events.filter((event) => event.weatherSensitive);
  // 「先に確認すること」には、今日の予定に影響する天気だけを出す（影響がなければ下の天気欄で足りる）。
  const showWeather = weather.condition !== 'sunny' && Boolean(weather.alert) && affected.length > 0;
  const timeline = [
    ...events.map((event) => ({ key: `event-${event.id}`, at: event.startsAt, title: event.title, meta: event.location ?? memberName(snapshot, event.ownerMembershipId), href: `/calendar/${event.id}?on=${today}`, id: event.id, kind: '予定' as const })),
    ...snapshot.todos.filter((todo) => todo.status !== 'done' && todo.dueAt && dateKeyFromRfc3339(todo.dueAt) === today).map((todo) => ({ key: `todo-${todo.id}`, at: todo.dueAt!, title: todo.title, meta: `担当：${memberName(snapshot, todo.assigneeMembershipId)}`, href: `/tasks/${todo.id}`, id: todo.id, kind: 'タスク' as const })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const title = `${greeting(asOf)}、${snapshot.user.displayName}さん`;
  // 見出しの番号は、この閲覧者に表示する欄だけで振る（権限で欄が隠れても番号が飛ばないように）。
  const sections = [reviewTodo || showWeather ? 'attention' : '', 'timeline', 'mine', can('expense.read') ? 'settle' : '', 'weather'].filter(Boolean);
  const no = (key: string) => String(sections.indexOf(key) + 1).padStart(2, '0');
  const syncBadge = sync.state === 'synced' ? <span className="badge success"><span className="status-dot"/>最終更新 {formatTime(sync.lastSyncedAt)}</span>
    : sync.state === 'syncing' ? <span className="badge attention">更新しています</span>
      : <span className="badge attention">オフライン（最終更新 {formatTime(sync.lastSyncedAt)}）</span>;

  if (loading) return <div className="page" aria-busy="true" aria-label="今日の情報を読み込んでいます"><PageHeader eyebrow="今日" title={title} description="今日の予定とタスクを読み込んでいます。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div></div>;
  if (snapshot.events.length + snapshot.todos.length + snapshot.expenses.length === 0) return <div className="page"><PageHeader eyebrow={`今日 · ${monthDay(asOf)}`} title={title} description="今日の予定やタスクを確認できます。"/><EmptyState title="今日の予定やタスクはありません" action={can('event.create') ? <button data-control-id="today.event.create" className="button primary" type="button" onClick={() => requestQuickCreate('event')}>予定を追加</button> : undefined}>共有された予定やタスクが追加されると、時刻順に表示されます。</EmptyState></div>;

  return <div className="page"><PageHeader eyebrow={`今日 · ${monthDay(asOf)}`} title={title} description="確認が必要な予定やタスクから順に表示しています。" action={syncBadge}/>
    <div className="stack">
      {(reviewTodo || showWeather) && <section className="card accent" aria-labelledby="attention-title"><div className="section-head"><div><p className="eyebrow">{no('attention')} · 要確認</p><h2 id="attention-title">先に確認すること</h2></div><StatusBadge tone="attention">{Number(Boolean(reviewTodo)) + Number(showWeather)}件</StatusBadge></div><div className="grid two">
        {reviewTodo && <div className="callout"><AlertIcon/><div><strong>{reviewTodo.reviewerMembershipId === me ? '確認を頼まれたタスクがあります' : '確認待ちのタスクがあります'}</strong><p className="muted small">{reviewTodo.title} · 担当：{memberName(snapshot, reviewTodo.assigneeMembershipId)} · 確認する人：{memberName(snapshot, reviewTodo.reviewerMembershipId)}</p></div><a data-control-id={`today.review.open.${reviewTodo.id}`} className="button" href={`/tasks/${reviewTodo.id}`} data-link>タスクを確認 <ArrowIcon width="16"/></a></div>}
        {showWeather && <div className="callout info"><RainIcon/><div><strong>{weather.alert}</strong><p className="muted small">今日の「{affected[0].title}」{affected.length > 1 ? `など${affected.length}件` : ''}に影響する可能性があります</p></div><a data-control-id={`today.weather-event.open.${affected[0].id}`} className="button" href={`/calendar/${affected[0].id}?on=${today}`} data-link>予定を開く <ArrowIcon width="16"/></a></div>}
      </div></section>}

      <section className="card" aria-labelledby="timeline-title"><div className="section-head"><div><p className="eyebrow">{no('timeline')} · 今日の予定とタスク</p><h2 id="timeline-title">時刻順に確認</h2></div><a data-control-id="today.calendar.open" href="/calendar" data-link>カレンダーへ</a></div>
        {timeline.length === 0 ? <p className="muted mb-0">今日の予定と期限のタスクはありません。</p> : <ul className="list timeline">{timeline.map((item) => <li className="list-row" key={item.key}><time className="time">{formatTime(item.at)}</time><div className="row-main"><strong>{item.title}</strong><span className="meta">{item.kind} · {item.meta}</span></div><a data-control-id={item.kind === '予定' ? `today.event.open.${item.id}` : `today.timeline-todo.open.${item.id}`} className="button" href={item.href} data-link aria-label={`${item.title}を開く`}>開く</a></li>)}</ul>}
      </section>

      <div className="grid two"><section className="card" aria-labelledby="mine-title"><div className="section-head"><div><p className="eyebrow">{no('mine')} · 自分の担当</p><h2 id="mine-title">{snapshot.user.displayName}さんのタスク</h2></div><span className="metric">{mine.length}</span></div>
        {mine.length === 0 ? <p className="muted mb-0">担当している未完了のタスクはありません。</p> : <ul className="list">{mine.map((todo) => <li className="list-row" key={todo.id}><CheckIcon width="20"/><div className="row-main"><strong>{todo.title}</strong><span className="meta">{formatDue(todo.dueAt, asOf)}{todo.reviewerMembershipId ? ` · 確認する人 ${memberName(snapshot, todo.reviewerMembershipId)}` : ''}</span></div><a data-control-id={`today.todo.open.${todo.id}`} className="button" href={`/tasks/${todo.id}`} data-link aria-label={`${todo.title}を開く`}>開く</a></li>)}</ul>}
      </section>
        {can('expense.read') && <section className="card" aria-labelledby="settle-title"><div className="section-head"><div><p className="eyebrow">{no('settle')} · 未精算</p><h2 id="settle-title">未精算の合計</h2></div><StatusBadge tone={unsettled.count ? 'attention' : 'success'}>{unsettled.count}件</StatusBadge></div><p className="metric">{formatYen(unsettled.totalJpy)}</p><p className="muted">記録済みの支出から計算しています。支払う相手と金額を確認できます。</p><a data-control-id="today.budget.open" className="button full" href="/budget" data-link>内訳と精算を確認</a></section>}
      </div>

      <section className="card" aria-labelledby="weather-title"><div className="section-head"><div><p className="eyebrow">{no('weather')} · 天気による影響</p><h2 id="weather-title">{weatherTitle[weather.condition]}</h2></div>{weather.condition === 'sunny' ? <SunIcon width="30"/> : <RainIcon width="30"/>}</div><div className="grid three"><div><p className="metric">{weather.precipitationPercent}%</p><p className="meta">降水確率</p></div><div><p className="metric">{weather.temperatureC}℃</p><p className="meta">予想気温（{weather.location}）</p></div><div><strong>予定は自動で変更しません</strong><p className="muted small">天気予報と、影響する可能性がある予定を表示します。</p></div></div></section>
    </div>
  </div>;
}
