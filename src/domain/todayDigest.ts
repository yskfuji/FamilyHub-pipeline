import { dateKeyFromRfc3339 } from './calendarDate';
import { monthSummary, unsettledSummary } from './ledger';
import { memberName } from './memberName';
import { occurrenceDates, occurrenceStartsAt } from './recurrence';
import type { CalendarEvent, Expense, HouseholdSnapshot, Todo } from './types';

/**
 * 今日の画面に出す中身の計算（src/features/today/TodayPage.tsx）。画面の部品から分けて、iOS のアプリと同じ答えを確かめる
 * （scripts/ios/export-vectors.ts が答えを書き出し、Swift の TodayDigest が同じになるかを試験する）。
 * 日付と時刻は家族の時間帯（日本時間。household.timezone は 'Asia/Tokyo' だけ）で読む。
 */
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' });

/** 0時からの分。 */
export const minutesOfDay = (value: string) => {
  const parts = clock.formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return read('hour') * 60 + read('minute');
};

export const greetingFor = (asOf: string) => {
  const hour = Math.floor(minutesOfDay(asOf) / 60);
  return hour < 10 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';
};

export type TodayEvent = CalendarEvent & { minutes: number };

/** 今日に当たる回（繰り返しを含む）を、その回の開始日時と長さ付きで返す。 */
export const todaysEvents = (events: CalendarEvent[], today: string): TodayEvent[] => events.flatMap((event) => {
  const start = dateKeyFromRfc3339(event.startsAt);
  const hit = event.recurrence ? occurrenceDates(start, event.recurrence, today, today).length > 0 : start === today;
  return hit ? [{ ...event, startsAt: occurrenceStartsAt(event.startsAt, today), minutes: Math.max(0, (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000) }] : [];
});

export interface TimelineItem { key: string; at: string; minutes: number; title: string; meta: string; href: string; id: string; kind: '予定' | 'タスク' }

export interface TodayDigest {
  today: string;
  /** 0時からの分（今の時刻）。 */
  now: number;
  greeting: string;
  /** 自分の担当で未完了のタスク。期限の近い順。 */
  mine: Todo[];
  unsettled: { totalJpy: number; count: number };
  spentThisMonth: { totalJpy: number; count: number };
  /** 確認を頼まれた、または確認を待っているタスク。 */
  reviewTodo: Todo | undefined;
  events: TodayEvent[];
  /** 天気の影響を受ける今日の予定。 */
  affected: TodayEvent[];
  /** 「次にすること」に天気を出すか（今日の予定に影響するときだけ）。 */
  showWeather: boolean;
  timeline: TimelineItem[];
  /** 今の時刻より後の、今日の予定か期限のタスク。 */
  upcoming: TimelineItem | undefined;
  /** upcoming がないときの、自分の担当で期限の近いタスク。 */
  nextTask: Todo | undefined;
  /** 要確認の数（確認待ちのタスクと天気）。 */
  attention: number;
  /** 家族の記録が1件もないか（空の状態を出す）。 */
  empty: boolean;
}

/** scoped は「表示する人」で絞った記録（src/app/useMemberScope.ts）。 */
export function todayDigest(snapshot: HouseholdSnapshot, scoped: { events: CalendarEvent[]; todos: Todo[]; expenses: Expense[] }): TodayDigest {
  const { asOf, weather } = snapshot.context;
  const today = dateKeyFromRfc3339(asOf);
  const now = minutesOfDay(asOf);
  const me = snapshot.viewer.membershipId;
  const mine = scoped.todos.filter((todo) => todo.assigneeMembershipId === me && todo.status !== 'done').sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
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
  return {
    today, now, greeting: greetingFor(asOf), mine, reviewTodo, events, affected, showWeather, timeline, upcoming, nextTask,
    unsettled: unsettledSummary(scoped.expenses),
    spentThisMonth: monthSummary(scoped.expenses, today.slice(0, 7)),
    attention: Number(Boolean(reviewTodo)) + Number(showWeather),
    empty: snapshot.events.length + snapshot.todos.length + snapshot.expenses.length === 0,
  };
}
