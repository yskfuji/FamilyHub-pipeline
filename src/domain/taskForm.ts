import { TIMEZONE, isValidLocal, recurrenceChoiceOf, recurrenceProblem, rruleOf, toInstant, toLocal } from './eventForm';
import type { EventDraft } from './eventForm';
import { dateKeyFromRfc3339 } from './calendarDate';
import type { TodoInput, TodoUpdateInput } from './schemas';
import type { HouseholdMembership, Id, RecurrenceRule, Todo, TodoPriority, VisibilityAudience } from './types';
import { visibilityChange, visibilityInput, visibilityProblem } from './visibilityForm';

export interface TaskDraft extends Pick<EventDraft, 'recurrence' | 'intervalDays' | 'until'> {
  title: string;
  note: string;
  /** 日本時間の YYYY-MM-DDTHH:mm。空なら指定なし。 */
  start: string;
  end: string;
  assigneeId: Id;
  /** 空なら確認する人なし。 */
  reviewerId: string;
  priority: TodoPriority;
  colorLabelId: string;
  audience: VisibilityAudience;
  selectedIds: Id[];
}

export function newTaskDraft(date: string, viewerMembershipId: Id, audience: VisibilityAudience): TaskDraft {
  return { title: '', note: '', start: '', end: `${date}T20:00`, assigneeId: viewerMembershipId, reviewerId: '', priority: 'normal', colorLabelId: '', audience, selectedIds: [], recurrence: 'none', intervalDays: 2, until: '' };
}

export function todoToDraft(todo: Todo): TaskDraft {
  return {
    title: todo.title, note: todo.note ?? '', start: todo.dueStartAt ? toLocal(todo.dueStartAt) : '', end: todo.dueAt ? toLocal(todo.dueAt) : '',
    assigneeId: todo.assigneeMembershipId, reviewerId: todo.reviewerMembershipId ?? '', priority: todo.priority ?? 'normal', colorLabelId: todo.colorLabelId ?? '',
    audience: todo.visibility.audience, selectedIds: [...todo.visibility.selectedMembershipIds],
    ...recurrenceChoiceOf(todo.recurrence, todo.dueAt ? dateKeyFromRfc3339(todo.dueAt) : ''),
  };
}

/** 担当と確認に選べる人。ゲストと利用中でない人は除く。今の担当者は、変えずに保存できるように残す。 */
export function assignablePeople(memberships: readonly HouseholdMembership[], keepIds: readonly string[]): HouseholdMembership[] {
  return memberships.filter((member) => (member.status === 'active' && member.role !== 'guest') || keepIds.includes(member.id));
}

/** 担当する人と確認する人のうち、公開範囲の外になる人。タスクが見えなくなるので、保存の前に知らせる。 */
export function peopleOutsideVisibility(draft: Pick<TaskDraft, 'assigneeId' | 'reviewerId' | 'audience' | 'selectedIds'>, memberships: readonly HouseholdMembership[], creatorId: Id): HouseholdMembership[] {
  const sees = (member: HouseholdMembership) => {
    if (member.id === creatorId) return draft.audience !== 'adults' || member.role === 'owner' || member.role === 'adult';
    if (draft.audience === 'adults') return member.role === 'owner' || member.role === 'adult';
    if (draft.audience === 'creator') return false;
    return draft.audience !== 'selected' || draft.selectedIds.includes(member.id);
  };
  const ids = new Set([draft.assigneeId, draft.reviewerId]);
  return memberships.filter((member) => ids.has(member.id) && !sees(member));
}

/** 入力の確認。問題があれば文言を返す。recurrenceEditable が false のときは繰り返しを見ない。 */
export function taskDraftProblem(draft: TaskDraft, recurrenceEditable: boolean): string | null {
  if (!draft.title.trim()) return 'タスク名を入力してください。';
  if (draft.start && !isValidLocal(draft.start)) return '開始の日時を確認してください。';
  if (draft.end && !isValidLocal(draft.end)) return '期限の日時を確認してください。';
  if (draft.start && !draft.end) return '開始を入れたときは、期限も入力してください。';
  if (draft.start && Date.parse(toInstant(draft.start)) > Date.parse(toInstant(draft.end))) return '期限は開始より後にしてください。';
  const shared = visibilityProblem(draft.audience, draft.selectedIds);
  if (shared) return shared;
  if (!recurrenceEditable || draft.recurrence === 'none' || draft.recurrence === 'keep') return null;
  if (!draft.end) return '繰り返すタスクには、期限を入力してください。';
  return recurrenceProblem(draft, draft.end.slice(0, 10), 'タスク');
}

const recurrenceRule = (draft: TaskDraft, exceptions: RecurrenceRule['exceptions']) => {
  const rrule = rruleOf(draft);
  return rrule ? { rrule, timezone: TIMEZONE, exceptions } : null;
};

export function taskDraftToCreateInput(draft: TaskDraft): TodoInput {
  const recurrence = recurrenceRule(draft, []);
  return {
    title: draft.title.trim(), assigneeMembershipId: draft.assigneeId, visibility: visibilityInput(draft.audience, draft.selectedIds),
    ...(draft.end ? { dueAt: toInstant(draft.end) } : {}),
    ...(draft.start ? { dueStartAt: toInstant(draft.start) } : {}),
    ...(draft.reviewerId ? { reviewerMembershipId: draft.reviewerId } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    ...(draft.priority !== 'normal' ? { priority: draft.priority } : {}),
    ...(draft.colorLabelId ? { colorLabelId: draft.colorLabelId } : {}),
    ...(recurrence ? { recurrence } : {}),
  };
}

/** 変更の入力。空にした項目は null で外す。公開範囲と繰り返しは、変えたときだけ送る。 */
export function taskDraftToUpdateInput(draft: TaskDraft, original: Todo, options: { recurrenceEditable: boolean }): TodoUpdateInput {
  const before = todoToDraft(original);
  const recurrenceChanged = options.recurrenceEditable && draft.recurrence !== 'keep' && rruleOf(draft) !== rruleOf(before);
  return {
    title: draft.title.trim(), assigneeMembershipId: draft.assigneeId, reviewerMembershipId: draft.reviewerId || null,
    dueAt: draft.end ? toInstant(draft.end) : null, dueStartAt: draft.start ? toInstant(draft.start) : null,
    note: draft.note.trim() || null, priority: draft.priority === 'normal' ? null : draft.priority, colorLabelId: draft.colorLabelId || null,
    ...visibilityChange(draft.audience, draft.selectedIds, original.visibility),
    ...(recurrenceChanged ? { recurrence: recurrenceRule(draft, original.recurrence?.exceptions ?? []) } : {}),
  };
}
