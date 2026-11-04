import { addDateKeyDays, dateKeyFromRfc3339 } from '../calendarDate';
import { occurrencesBetween, occursOn, todosOn } from '../calendarLayout';
import type { HouseholdSnapshot } from '../types';
import { allRecords, openTodos, type ReviewScope } from './review';

/** 数える日数。今日から7日。 */
export const WEEK_DAYS = 7;

export interface DayLoad {
  /** YYYY-MM-DD（家族の時間帯の日付）。 */
  date: string;
  /** その日にかかる予定の回の数。繰り返しは回ごと、日をまたぐ予定はかかる日ごとに数える。 */
  events: number;
  /** その日が期限（または期限の期間）にあたる、終わっていないタスクの数。 */
  tasks: number;
}

export interface WeekLoad {
  days: DayLoad[];
  /** 数えた記録の種類。見られない種類と、外した種類は数えない。 */
  counted: { events: boolean; tasks: boolean };
  /** 7日の予定とタスクの合計。0 なら図表を描かない。 */
  total: number;
}

/**
 * 今日から7日の、日ごとの予定とタスクの件数。振り返り（reviewRecords）と同じく、見ている人に投影された記録だけを、
 * 選んだ種類だけ数える。期限のないタスクと期限を過ぎたタスクは、どの日にもあたらないので入らない。
 * 件数だけで、時間の長さや負担の重さは表さない。
 */
export function weekLoad(snapshot: HouseholdSnapshot, scope: ReviewScope = allRecords): WeekLoad {
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const dates = Array.from({ length: WEEK_DAYS }, (_, index) => addDateKeyDays(today, index));
  const can = (capability: 'event.read' | 'task.read') => snapshot.viewer.capabilities.includes(capability);
  const counted = { events: scope.events && can('event.read'), tasks: scope.tasks && can('task.read') };
  const occurrences = counted.events ? occurrencesBetween(snapshot.events.filter((event) => !event.deletedAt), dates[0], dates[WEEK_DAYS - 1]) : [];
  const todos = counted.tasks ? openTodos(snapshot) : [];
  const days = dates.map((date) => ({ date, events: occurrences.filter((occurrence) => occursOn(occurrence, date)).length, tasks: todosOn(todos, date).length }));
  return { days, counted, total: days.reduce((sum, day) => sum + day.events + day.tasks, 0) };
}
