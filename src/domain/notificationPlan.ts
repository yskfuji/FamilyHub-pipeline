import { dateKeyFromRfc3339, toJstRfc3339 } from './calendarDate';
import { occurrenceDates, occurrenceStartsAt } from './recurrence';
import { addDateKeyDays } from './calendarDate';
import type { HouseholdNotification, HouseholdSnapshot, Rfc3339 } from './types';

const TASK_LEAD_MS = 30 * 60_000;
const HORIZON_MS = 36 * 3_600_000;

const clock = (value: string) => new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));

/**
 * これから知らせる通知を、閲覧者に見えている記録から作る。
 * ID は記録と回から決まるので、何度作っても同じ通知は増えない。
 */
export function planNotifications(snapshot: HouseholdSnapshot, nowIso: Rfc3339): HouseholdNotification[] {
  const now = Date.parse(nowIso);
  const me = snapshot.viewer.membershipId;
  const today = dateKeyFromRfc3339(nowIso);
  const until = addDateKeyDays(today, 2);
  const inWindow = (at: number) => at >= now && at <= now + HORIZON_MS;
  const plans: HouseholdNotification[] = [];
  for (const todo of snapshot.todos) {
    if (!todo.dueAt || todo.status === 'done' || todo.assigneeMembershipId !== me) continue;
    const due = Date.parse(todo.dueAt);
    if (!inWindow(due - TASK_LEAD_MS)) continue;
    plans.push({ id: `todoDue:${todo.id}:${todo.dueAt}`, kind: 'todoDue', destination: `/tasks/${todo.id}`, title: todo.title, body: `${clock(todo.dueAt)}まで`, remindAt: toJstRfc3339(new Date(due - TASK_LEAD_MS)), read: false, status: 'active' });
  }
  for (const event of snapshot.events) {
    if (event.reminderMinutesBefore === undefined || (event.ownerMembershipId !== me && !event.participantMembershipIds.includes(me))) continue;
    const seriesStart = dateKeyFromRfc3339(event.startsAt);
    const dates = event.recurrence ? occurrenceDates(seriesStart, event.recurrence, today, until) : [seriesStart];
    for (const date of dates) {
      const startsAt = occurrenceStartsAt(event.startsAt, date);
      const remindAt = Date.parse(startsAt) - event.reminderMinutesBefore * 60_000;
      if (!inWindow(remindAt)) continue;
      plans.push({ id: `eventDeparture:${event.id}:${date}`, kind: 'eventDeparture', destination: `/calendar/${event.id}?on=${date}`, title: event.title, body: `${clock(startsAt)}開始${event.location ? `・${event.location}` : ''}`, remindAt: toJstRfc3339(new Date(remindAt)), read: false, status: 'active' });
    }
  }
  return plans;
}

