import { addDateKeyDays, dateKeyFromRfc3339, shiftMonthKey } from '../calendarDate';
import { occurrencesBetween } from '../calendarLayout';
import type { Occurrence } from '../calendarLayout';
import type { EventDraft } from '../eventForm';
import { expenseCategories, remainingTotal, unsettledSummary } from '../ledger';
import type { TaskDraft } from '../taskForm';
import type { Expense, HouseholdSnapshot, Id, SpendingCategory, Todo } from '../types';
import { ja } from '../../content/ja';

export interface ReviewScope { events: boolean; tasks: boolean; expenses: boolean }
export const allRecords: ReviewScope = { events: true, tasks: true, expenses: true };

export interface Citation { kind: 'event' | 'task' | 'expense'; id: Id; label: string; href: string }

/** 利用者が開いて確かめる下書き。保存はしない。 */
export type DraftProposal =
  | { kind: 'task'; label: string; task: Partial<TaskDraft> }
  | { kind: 'event'; label: string; event: Partial<EventDraft> };

export type FindingKind = 'load' | 'conflict' | 'overdue' | 'no-due' | 'unsettled' | 'spending';

export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  summary: string;
  citations: Citation[];
  /** 表示しきれなかった記録の数。 */
  moreCitations: number;
  proposal: DraftProposal;
}

export interface PersonLoad { membershipId: Id; name: string; events: number; openTasks: number; overdueTasks: number }

export interface Review {
  /** 数えた範囲の最後の日。 */
  until: string;
  load: PersonLoad[];
  findings: Finding[];
  counted: { events: number; tasks: number; expenses: number };
}

/** 今後を数える日数。 */
export const REVIEW_DAYS = 14;
const MAX_CITATIONS = 5;
const MAX_CONFLICTS = 5;
const MAX_SPENDING = 3;
/** 先月より多いと数える倍率と差額。少額の揺れは挙げない。 */
const SPENDING_RATIO = 1.5;
const SPENDING_MIN_INCREASE_JPY = 3000;
/** 件数を挙げ始める数。 */
const LOAD_MIN_ITEMS = 3;

const yen = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
const clockOf = (iso: string) => new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(iso));
const dayOf = (dateKey: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(`${dateKey}T12:00:00+09:00`));
const weekdayOf = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();

const eventCitation = (event: Occurrence): Citation => ({ kind: 'event', id: event.id, label: event.title, href: `/calendar/${event.id}?on=${event.occurrenceDate}` });
const taskCitation = (todo: Todo): Citation => ({ kind: 'task', id: todo.id, label: todo.title, href: `/tasks/${todo.id}` });
const expenseCitation = (expense: Expense): Citation => ({ kind: 'expense', id: expense.id, label: expense.title, href: `/budget/${expense.id}` });

/** 同じ記録は1度だけ挙げる。繰り返しの予定は回の数だけ数えるが、記録としては1つ。 */
function limited(citations: Citation[]) {
  const unique = [...new Map(citations.map((citation) => [`${citation.kind}-${citation.id}`, citation])).values()];
  return { citations: unique.slice(0, MAX_CITATIONS), moreCitations: Math.max(0, unique.length - MAX_CITATIONS) };
}

/** 次の日曜日。今日が日曜日なら1週間後。 */
const nextSunday = (today: string) => addDateKeyDays(today, 7 - weekdayOf(today));

function nameOf(snapshot: HouseholdSnapshot, id: Id) {
  return snapshot.memberships.find((member) => member.id === id)?.displayName ?? '非公開';
}

export const openTodos = (snapshot: HouseholdSnapshot) => snapshot.todos.filter((todo) => todo.status !== 'done' && !todo.deletedAt);
const isOverdue = (todo: Todo, asOf: string) => Boolean(todo.dueAt) && Date.parse(todo.dueAt as string) < Date.parse(asOf);

function upcoming(snapshot: HouseholdSnapshot, today: string, until: string) {
  const asOf = Date.parse(snapshot.context.asOf);
  return occurrencesBetween(snapshot.events.filter((event) => !event.deletedAt), today, until).filter((event) => Date.parse(event.endsAt) >= asOf);
}

function personLoads(snapshot: HouseholdSnapshot, events: readonly Occurrence[], scope: ReviewScope): PersonLoad[] {
  const todos = scope.tasks ? openTodos(snapshot) : [];
  return snapshot.memberships.filter((member) => member.status === 'active').map((member) => {
    const mine = todos.filter((todo) => todo.assigneeMembershipId === member.id);
    return {
      membershipId: member.id, name: member.displayName,
      events: scope.events ? events.filter((event) => event.participantMembershipIds.includes(member.id)).length : 0,
      openTasks: mine.length,
      overdueTasks: mine.filter((todo) => isOverdue(todo, snapshot.context.asOf)).length,
    };
  });
}

function loadFinding(snapshot: HouseholdSnapshot, loads: readonly PersonLoad[], events: readonly Occurrence[], today: string): Finding[] {
  const total = (load: PersonLoad) => load.events + load.openTasks;
  const top = [...loads].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name, 'ja'))[0];
  if (!top || total(top) < LOAD_MIN_ITEMS) return [];
  const citations = [
    ...events.filter((event) => event.participantMembershipIds.includes(top.membershipId)).map(eventCitation),
    ...openTodos(snapshot).filter((todo) => todo.assigneeMembershipId === top.membershipId).map(taskCitation),
  ];
  return [{
    id: `load-${top.membershipId}`, kind: 'load',
    title: `${top.name}さんの記録がいちばん多く、${total(top)}件`,
    summary: `今後${REVIEW_DAYS}日の予定${top.events}件と、終わっていないタスク${top.openTasks}件を数えました。件数だけの比較で、負担の重さは表しません。`,
    ...limited(citations),
    proposal: { kind: 'task', label: '分担を話す時間をタスクにする', task: { title: `${top.name}さんの予定とタスクを一緒に見直す`, end: `${nextSunday(today)}T20:00` } },
  }];
}

interface Conflict { first: Occurrence; second: Occurrence; people: Id[] }

/** 同じ人の、時間の重なる2つの予定。終日の予定は一日の枠なので数えない。 */
export function scheduleConflicts(events: readonly Occurrence[]): Conflict[] {
  const timed = events.filter((event) => !event.allDay).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const conflicts: Conflict[] = [];
  timed.forEach((first, index) => {
    const end = Date.parse(first.endsAt);
    for (const second of timed.slice(index + 1)) {
      if (Date.parse(second.startsAt) >= end) break;
      const people = first.participantMembershipIds.filter((id) => second.participantMembershipIds.includes(id));
      if (people.length && first.id !== second.id) conflicts.push({ first, second, people });
    }
  });
  return conflicts;
}

function conflictFindings(snapshot: HouseholdSnapshot, events: readonly Occurrence[]): Finding[] {
  return scheduleConflicts(events).slice(0, MAX_CONFLICTS).map(({ first, second, people }) => {
    const date = first.occurrenceDate;
    return {
      id: `conflict-${first.id}-${second.id}-${date}`, kind: 'conflict' as const,
      title: `${dayOf(date)}に予定が重なっています`,
      summary: `${people.map((id) => `${nameOf(snapshot, id)}さん`).join('、')}の「${first.title}」（${clockOf(first.startsAt)}〜${clockOf(first.endsAt)}）と「${second.title}」（${clockOf(second.startsAt)}〜${clockOf(second.endsAt)}）の時間が重なります。`,
      citations: [eventCitation(first), eventCitation(second)], moreCitations: 0,
      proposal: { kind: 'task', label: '調整のタスクを下書きする', task: { title: `「${first.title}」と「${second.title}」の時間を調整する`, end: `${date}T09:00`, assigneeId: people[0] } },
    };
  });
}

function overdueFinding(todos: readonly Todo[], asOf: string, today: string): Finding[] {
  const overdue = todos.filter((todo) => isOverdue(todo, asOf)).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  if (!overdue.length) return [];
  return [{
    id: 'overdue', kind: 'overdue',
    title: `期限を過ぎたタスクが${overdue.length}件`,
    summary: `いちばん古いものは「${overdue[0].title}」です。`,
    ...limited(overdue.map(taskCitation)),
    proposal: { kind: 'task', label: '見直すタスクを下書きする', task: { title: `期限を過ぎたタスク${overdue.length}件の期限を決め直す`, end: `${addDateKeyDays(today, 1)}T20:00` } },
  }];
}

function noDueFinding(todos: readonly Todo[], today: string): Finding[] {
  const undated = todos.filter((todo) => !todo.dueAt);
  if (!undated.length) return [];
  return [{
    id: 'no-due', kind: 'no-due',
    title: `期限のないタスクが${undated.length}件`,
    summary: '期限がないと、通知や今日の一覧に出てきません。',
    ...limited(undated.map(taskCitation)),
    proposal: { kind: 'task', label: '見直すタスクを下書きする', task: { title: `期限のないタスク${undated.length}件に期限を付ける`, end: `${nextSunday(today)}T20:00` } },
  }];
}

function unsettledFinding(snapshot: HouseholdSnapshot, expenses: readonly Expense[], today: string): Finding[] {
  const summary = unsettledSummary([...expenses]);
  if (summary.totalJpy <= 0) return [];
  const date = nextSunday(today);
  return [{
    id: 'unsettled', kind: 'unsettled',
    title: `未精算の合計は${yen(summary.totalJpy)}`,
    summary: `精算の終わっていない支出${summary.count}件の、残りの額を足しました。`,
    ...limited(expenses.filter((expense) => expense.kind === 'expense' && remainingTotal(expense) > 0).sort((a, b) => remainingTotal(b) - remainingTotal(a)).map(expenseCitation)),
    proposal: { kind: 'event', label: '精算の予定を下書きする', event: { title: '家計の精算', start: `${date}T20:00`, end: `${date}T20:30`, participantIds: [snapshot.viewer.membershipId] } },
  }];
}

const spendingIn = (expenses: readonly Expense[], month: string) => expenses.filter((expense) => expense.kind === 'expense' && expense.incurredOn.startsWith(month));
const sum = (expenses: readonly Expense[]) => expenses.reduce((total, expense) => total + expense.amountJpy, 0);

/** 費目ごとに、今月のここまでの合計を先月1か月の合計と比べる。先月の記録がない費目は比べない。 */
function spendingFindings(expenses: readonly Expense[], today: string): Finding[] {
  const month = today.slice(0, 7);
  const lastMonth = shiftMonthKey(month, -1);
  const current = spendingIn(expenses, month);
  const previous = spendingIn(expenses, lastMonth);
  const high = (now: number, before: number) => before > 0 && now >= before * SPENDING_RATIO && now - before >= SPENDING_MIN_INCREASE_JPY;
  const compared = (expenseCategories as readonly SpendingCategory[]).flatMap((category) => {
    const items = current.filter((expense) => expense.category === category);
    const now = sum(items);
    const before = sum(previous.filter((expense) => expense.category === category));
    return high(now, before) ? [{ category, items, now, before }] : [];
  }).sort((a, b) => (b.now - b.before) - (a.now - a.before)).slice(0, MAX_SPENDING);
  return compared.map(({ category, items, now, before }) => {
    const name = ja.expenseCategory[category];
    return {
      id: `spending-${category}`, kind: 'spending' as const,
      title: `${name}が先月より${yen(now - before)}多い`,
      summary: `今月のここまでの${name}は${yen(now)}で、先月1か月の${yen(before)}を超えています。`,
      ...limited([...items].sort((a, b) => b.amountJpy - a.amountJpy).map(expenseCitation)),
      proposal: { kind: 'task', label: '確認のタスクを下書きする', task: { title: `今月の${name}の内訳を確認する`, end: `${nextSunday(today)}T20:00` } },
    };
  });
}

/**
 * 見ている人に投影された記録だけを数える。文章を読み取ったり推測したりせず、件数と金額と時刻の比較だけで作る。
 * 記録は変えず、下書きも画面で開くだけで保存しない。
 */
export function reviewRecords(snapshot: HouseholdSnapshot, scope: ReviewScope = allRecords): Review {
  const { asOf } = snapshot.context;
  const today = dateKeyFromRfc3339(asOf);
  const until = addDateKeyDays(today, REVIEW_DAYS);
  const can = (capability: 'event.read' | 'task.read' | 'expense.read') => snapshot.viewer.capabilities.includes(capability);
  const use = { events: scope.events && can('event.read'), tasks: scope.tasks && can('task.read'), expenses: scope.expenses && can('expense.read') };
  const events = use.events ? upcoming(snapshot, today, until) : [];
  const todos = use.tasks ? openTodos(snapshot) : [];
  const expenses = use.expenses ? snapshot.expenses.filter((expense) => !expense.deletedAt) : [];
  const load = personLoads(snapshot, events, use);
  return {
    until, load,
    findings: [
      ...conflictFindings(snapshot, events),
      ...overdueFinding(todos, asOf, today),
      ...noDueFinding(todos, today),
      ...unsettledFinding(snapshot, expenses, today),
      ...spendingFindings(expenses, today),
      ...loadFinding(snapshot, load, events, today),
    ],
    counted: { events: events.length, tasks: todos.length, expenses: expenses.length },
  };
}
