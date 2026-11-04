import type { CSSProperties, ReactNode } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { EmptyState, PageHeader, StatusBadge, formatDue, formatTime, formatYen } from '../../design-system/components';
import { AlertIcon, ArrowIcon, CheckIcon, ClockIcon, RainIcon, SunIcon } from '../../design-system/icons';
import { EmptyDone } from '../../design-system/illustrations/EmptyDone';
import { EmptyEvents } from '../../design-system/illustrations/EmptyEvents';
import { SeasonScene } from '../../design-system/illustrations/SeasonScene';
import { useSizeClass, type SizeClass } from '../../design-system/sizeClass';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { monthSummary, unsettledSummary } from '../../domain/ledger';
import { occurrenceDates, occurrenceStartsAt } from '../../domain/recurrence';
import { seasonOf, type Season } from '../../domain/season';
import type { CalendarEvent } from '../../domain/types';
import { MemberScopeSelect } from '../shared/MemberScopeSelect';
import { SyncStatus } from '../shared/SyncStatus';
import { stripLanes } from '../../domain/timeStrip';

// 日付と時刻は家族の時間帯（日本時間。household.timezone は 'Asia/Tokyo' だけ）で読む。
const monthDay = (asOf: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(asOf));
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' });
/** 0時からの分。 */
const minutesOf = (value: string) => {
  const parts = clock.formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return read('hour') * 60 + read('minute');
};
const greeting = (asOf: string) => {
  const hour = Math.floor(minutesOf(asOf) / 60);
  return hour < 10 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';
};
/** 今日に当たる回（繰り返しを含む）を、その回の開始日時と長さ付きで返す。 */
const todaysEvents = (events: CalendarEvent[], today: string) => events.flatMap((event) => {
  const start = dateKeyFromRfc3339(event.startsAt);
  const hit = event.recurrence ? occurrenceDates(start, event.recurrence, today, today).length > 0 : start === today;
  return hit ? [{ ...event, startsAt: occurrenceStartsAt(event.startsAt, today), minutes: Math.max(0, (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000) }] : [];
});
const weatherTitle = { rain: '雨と予定', storm: '荒天と予定', sunny: '天気と予定' } as const;

/**
 * 季節の場面。ふだんは家族の時間帯での今日の日付から決める（SeasonMark と同じ seasonOf）。
 * 内部監査のビルドだけ、?season= で選べる（4つの場面を撮影と濃さの確かめに入れるため）。
 */
const seasonFor = (today: string): Season => {
  if (import.meta.env.VITE_INCLUDE_AUDIT_SURFACE === 'true') {
    const requested = new URLSearchParams(window.location.search).get('season');
    if (requested === 'spring' || requested === 'summer' || requested === 'autumn' || requested === 'winter') return requested;
  }
  return seasonOf(today);
};

interface TimelineItem { key: string; at: string; minutes: number; title: string; meta: string; href: string; id: string; kind: '予定' | 'タスク' }

/**
 * 時刻の帯。今日の予定（長さのある帯）と期限のタスク（点）を、朝から夜の目盛りの上に置き、今の時刻に線を引く。
 * 同じ内容は下の一覧が文で伝えるので、帯は読み上げない（aria-hidden）。目盛りの文字は濃さの確かめの対象。
 */
function TimeStrip({ items, now }: { items: TimelineItem[]; now: number }) {
  const starts = items.map((item) => minutesOf(item.at));
  const first = Math.min(6 * 60, ...starts);
  const last = Math.max(22 * 60, ...items.map((item, index) => starts[index] + item.minutes), now);
  const from = Math.floor(first / 180) * 180;
  const to = Math.min(24 * 60, Math.ceil(last / 180) * 180);
  const at = (minutes: number) => String((Math.min(to, Math.max(from, minutes)) - from) / (to - from));
  const ticks: number[] = [];
  // 最後の目盛り（帯の右の端）は字を出さない（手前の目盛りと重ならないように）。
  for (let minute = from; minute < to; minute += 180) ticks.push(minute);
  const place = (start: string, span = 0, lane = 0) => ({ '--strip-at': start, '--strip-span': String(span / (to - from)), '--strip-lane': String(lane) }) as CSSProperties;
  const lanes = stripLanes(items.map((item, index) => ({ start: starts[index], minutes: item.minutes })), to - from);
  const laneCount = Math.max(1, ...lanes.map((lane) => lane + 1));
  return <div className="time-strip" aria-hidden="true">
    <div className="time-strip-track" style={{ '--strip-lanes': String(laneCount) } as CSSProperties}>
      {items.map((item, index) => <span key={item.key} className="time-strip-mark" data-kind={item.kind === '予定' ? 'event' : 'task'} data-lane={lanes[index]} data-past={starts[index] + item.minutes < now ? 'true' : undefined} style={place(at(starts[index]), Math.min(item.minutes, to - starts[index]), lanes[index])}/>)}
      {now >= from && now <= to && <span className="time-strip-now" style={place(at(now))}/>}
    </div>
    <div className="time-strip-ticks">{ticks.map((minute) => <span key={minute} style={place(at(minute))}>{minute / 60}時</span>)}</div>
  </div>;
}

type BlockKey = 'next' | 'timeline' | 'due' | 'weather' | 'budget';
/**
 * 段階ごとの並び。narrow は1列で次にすることから。medium は次にすることと時刻の帯を全幅にし、期限・天気・家計を2列に。
 * wide は3列（次にすることと天気／時刻の帯／期限と家計）。どの段階でも、読む順（DOM の順）と見た目の順が一致する。
 */
const layouts: Record<SizeClass, Array<{ span?: boolean; keys: BlockKey[] }>> = {
  narrow: [{ keys: ['next', 'timeline', 'due', 'weather', 'budget'] }],
  medium: [{ span: true, keys: ['next', 'timeline'] }, { keys: ['due'] }, { keys: ['weather', 'budget'] }],
  wide: [{ keys: ['next', 'weather'] }, { keys: ['timeline'] }, { keys: ['due', 'budget'] }],
};

export function TodayPage() {
  const { snapshot, loading, can, requestQuickCreate } = useApp();
  const sizeClass = useSizeClass();
  const { asOf, weather } = snapshot.context;
  const scoped = useMemberScope();
  const today = dateKeyFromRfc3339(asOf);
  const now = minutesOf(asOf);
  const me = snapshot.viewer.membershipId;
  const mine = scoped.todos.filter((todo) => todo.assigneeMembershipId === me && todo.status !== 'done').sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const unsettled = unsettledSummary(scoped.expenses);
  const spentThisMonth = monthSummary(scoped.expenses, today.slice(0, 7));
  const reviewTodo = scoped.todos.find((todo) => todo.status === 'review' && (todo.reviewerMembershipId === me || todo.assigneeMembershipId === me));
  const events = todaysEvents(scoped.events, today);
  const affected = events.filter((event) => event.weatherSensitive);
  // 「次にすること」には、今日の予定に影響する天気だけを出す（影響がなければ天気の欄で足りる）。
  const showWeather = weather.condition !== 'sunny' && Boolean(weather.alert) && affected.length > 0;
  const timeline: TimelineItem[] = [
    ...events.map((event) => ({ key: `event-${event.id}`, at: event.startsAt, minutes: event.minutes, title: event.title, meta: event.location ?? memberName(snapshot, event.ownerMembershipId), href: `/calendar/${event.id}?on=${today}`, id: event.id, kind: '予定' as const })),
    ...scoped.todos.filter((todo) => todo.status !== 'done' && todo.dueAt && dateKeyFromRfc3339(todo.dueAt) === today).map((todo) => ({ key: `todo-${todo.id}`, at: todo.dueAt!, minutes: 0, title: todo.title, meta: `担当：${memberName(snapshot, todo.assigneeMembershipId)}`, href: `/tasks/${todo.id}`, id: todo.id, kind: 'タスク' as const })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // 次の1件: 今の時刻より後の、今日の予定か期限のタスク。なければ自分の担当で期限の近いもの。確認の欄に出したタスクは除く。
  const upcoming = timeline.find((item) => Date.parse(item.at) >= Date.parse(asOf) && item.id !== reviewTodo?.id);
  const nextTask = upcoming ? undefined : mine.find((todo) => todo.id !== reviewTodo?.id);
  const attention = Number(Boolean(reviewTodo)) + Number(showWeather);
  const title = `${greeting(asOf)}、${snapshot.user.displayName}さん`;
  const scene = <SeasonScene season={seasonFor(today)}/>;

  if (loading) return <div className="page" aria-busy="true" aria-label="今日の情報を読み込んでいます"><PageHeader eyebrow="今日" title={title} description="今日の予定とタスクを読み込んでいます。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div></div>;
  if (snapshot.events.length + snapshot.todos.length + snapshot.expenses.length === 0) return <div className="page"><PageHeader eyebrow={`今日 · ${monthDay(asOf)}`} title={title} description="今日の予定やタスクを確認できます。" art={scene}/><EmptyState title="今日の予定やタスクはありません" illustration={<EmptyEvents/>} action={can('event.create') ? <button data-control-id="today.event.create" className="button primary" type="button" onClick={() => requestQuickCreate('event')}>予定を追加</button> : undefined}>共有された予定やタスクが追加されると、時刻順に表示されます。</EmptyState></div>;

  // 見出しの番号は、この閲覧者に表示する欄だけで、読む順に振る（権限で欄が隠れても番号が飛ばないように）。
  const shown = (key: BlockKey) => key !== 'budget' || can('expense.read');
  const columns = layouts[sizeClass].map((column) => ({ ...column, keys: column.keys.filter(shown) })).filter((column) => column.keys.length);
  const order = columns.flatMap((column) => column.keys);
  const no = (key: BlockKey) => String(order.indexOf(key) + 1).padStart(2, '0');

  const blocks: Record<BlockKey, () => ReactNode> = {
    next: () => <section className={attention ? 'card accent today-next' : 'card today-next'} aria-labelledby="next-title"><div className="section-head"><div><p className="eyebrow">{no('next')} · {attention ? '要確認' : '次の予定'}</p><h2 id="next-title">次にすること</h2></div>{attention > 0 && <StatusBadge tone="attention">{attention}件</StatusBadge>}</div>
      {attention + Number(Boolean(upcoming || nextTask)) === 0
        ? <EmptyState compact headingLevel={3} title="今日することは全部済みました" illustration={<EmptyDone/>}>新しい予定やタスクが追加されると、ここに表示します。</EmptyState>
        : <div className="stack today-next-list">
          {reviewTodo && <div className="callout"><AlertIcon/><div><strong>{reviewTodo.reviewerMembershipId === me ? '確認を頼まれたタスクがあります' : '確認待ちのタスクがあります'}</strong><p className="muted small">{reviewTodo.title} · <span className="keep-together">担当：{memberName(snapshot, reviewTodo.assigneeMembershipId)}</span> · <span className="keep-together">確認する人：{memberName(snapshot, reviewTodo.reviewerMembershipId)}</span></p></div><a data-control-id={`today.review.open.${reviewTodo.id}`} className="button" href={`/tasks/${reviewTodo.id}`} data-link>タスクを確認 <ArrowIcon width="16"/></a></div>}
          {showWeather && <div className="callout info"><RainIcon/><div><strong>{weather.alert}</strong><p className="muted small">今日の「{affected[0].title}」{affected.length > 1 ? `など${affected.length}件` : ''}に影響する可能性があります</p></div><a data-control-id={`today.weather-event.open.${affected[0].id}`} className="button" href={`/calendar/${affected[0].id}?on=${today}`} data-link>予定を開く <ArrowIcon width="16"/></a></div>}
          {upcoming && <div className="callout next-item"><ClockIcon/><div><strong>{formatTime(upcoming.at)} {upcoming.title}</strong><p className="muted small">次の{upcoming.kind} · {upcoming.meta}</p></div><a data-control-id={`today.next.open.${upcoming.id}`} className="button" href={upcoming.href} data-link aria-label={`次の${upcoming.kind}「${upcoming.title}」を開く`}>開く <ArrowIcon width="16"/></a></div>}
          {nextTask && <div className="callout next-item"><CheckIcon/><div><strong>{nextTask.title}</strong><p className="muted small">次のタスク · 期限 {formatDue(nextTask.dueAt, asOf)}</p></div><a data-control-id={`today.next.open.${nextTask.id}`} className="button" href={`/tasks/${nextTask.id}`} data-link aria-label={`次のタスク「${nextTask.title}」を開く`}>開く <ArrowIcon width="16"/></a></div>}
        </div>}
    </section>,
    timeline: () => <section className="card" aria-labelledby="timeline-title"><div className="section-head"><div><p className="eyebrow">{no('timeline')} · 今日の予定とタスク</p><h2 id="timeline-title">時刻順に確認</h2></div><a data-control-id="today.calendar.open" className="standalone-link" href="/calendar" data-link>カレンダーへ</a></div>
      {timeline.length === 0 ? <p className="muted mb-0">今日の予定と期限のタスクはありません。</p> : <><TimeStrip items={timeline} now={now}/><ul className="list timeline">{timeline.map((item) => <li className="list-row" key={item.key} data-past={Date.parse(item.at) + item.minutes * 60_000 < Date.parse(asOf) ? 'true' : undefined}><time className="time">{formatTime(item.at)}</time><div className="row-main"><strong>{item.title}</strong><span className="meta">{item.kind} · {item.meta}</span></div><a data-control-id={item.kind === '予定' ? `today.event.open.${item.id}` : `today.timeline-todo.open.${item.id}`} className="button" href={item.href} data-link aria-label={`${item.title}を開く`}>開く</a></li>)}</ul></>}
    </section>,
    due: () => <section className="card" aria-labelledby="mine-title"><div className="section-head"><div><p className="eyebrow">{no('due')} · 期限 · 自分の担当</p><h2 id="mine-title">{snapshot.user.displayName}さんのタスク</h2></div><span className="metric">{mine.length}</span></div>
      {mine.length === 0 ? <p className="muted mb-0">担当している未完了のタスクはありません。</p> : <ul className="list">{mine.map((todo) => <li className="list-row" key={todo.id}><CheckIcon width="20"/><div className="row-main"><strong>{todo.title}</strong><span className="meta">{todo.dueAt && Date.parse(todo.dueAt) < Date.parse(asOf) ? <StatusBadge tone="danger">期限切れ</StatusBadge> : null}{formatDue(todo.dueAt, asOf)}{todo.reviewerMembershipId ? ` · 確認する人 ${memberName(snapshot, todo.reviewerMembershipId)}` : ''}</span></div><a data-control-id={`today.todo.open.${todo.id}`} className="button" href={`/tasks/${todo.id}`} data-link aria-label={`${todo.title}を開く`}>開く</a></li>)}</ul>}
    </section>,
    weather: () => <section className="card" aria-labelledby="weather-title"><div className="section-head"><div><p className="eyebrow">{no('weather')} · 天気</p><h2 id="weather-title">{weatherTitle[weather.condition]}</h2></div>{weather.condition === 'sunny' ? <SunIcon width="30"/> : <RainIcon width="30"/>}</div><div className="today-weather"><div><p className="metric">{weather.precipitationPercent}%</p><p className="meta">降水確率</p></div><div><p className="metric">{weather.temperatureC}℃</p><p className="meta">予想気温（{weather.location}）</p></div><div className="today-weather-note"><strong>予定は自動で変更しません</strong><p className="muted small">天気予報と、影響する可能性がある予定を表示します。</p></div></div></section>,
    budget: () => <section className="card" aria-labelledby="settle-title"><div className="section-head"><div><p className="eyebrow">{no('budget')} · 家計の一目</p><h2 id="settle-title">未精算の合計</h2></div><StatusBadge tone={unsettled.count ? 'attention' : 'success'}>{unsettled.count}件</StatusBadge></div><p className="metric">{formatYen(unsettled.totalJpy)}</p><p className="meta">今月の支出 {formatYen(spentThisMonth.totalJpy)}（{spentThisMonth.count}件）</p><p className="muted">記録済みの支出から計算しています。支払う相手と金額を確認できます。</p><a data-control-id="today.budget.open" className="button full" href="/budget" data-link>内訳と精算を確認</a></section>,
  };

  return <div className="page"><PageHeader eyebrow={`今日 · ${monthDay(asOf)}`} title={title} description="確認が必要な予定やタスクから順に表示しています。" art={scene} action={<div className="page-head-actions"><MemberScopeSelect/><SyncStatus/></div>}/>
    <div className="today-layout" data-layout={sizeClass}>
      {columns.map((column) => <div className={column.span ? 'today-col today-span' : 'today-col'} key={column.keys.join('-')}>{column.keys.map((key) => <div className="today-block" data-block={key} key={key}>{blocks[key]()}</div>)}</div>)}
    </div>
  </div>;
}
