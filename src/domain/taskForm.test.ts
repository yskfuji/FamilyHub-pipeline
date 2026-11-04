import { describe, expect, it } from 'vitest';
import { assignablePeople, newTaskDraft, peopleOutsideVisibility, taskDraftProblem, taskDraftToCreateInput, taskDraftToUpdateInput, todoToDraft } from './taskForm';
import { todoUpdateSchema } from './schemas';
import type { HouseholdMembership, Todo } from './types';

const draft = (changes = {}) => ({ ...newTaskDraft('2026-09-30', 'me', 'household'), title: '提出物', ...changes });
const member = (id: string, role: HouseholdMembership['role'], status: HouseholdMembership['status'] = 'active') => ({ id, role, status }) as HouseholdMembership;
const todo = (changes: Partial<Todo> = {}): Todo => ({
  id: 't', householdId: 'h', title: '元の名前', status: 'open', assigneeMembershipId: 'a', creatorMembershipId: 'a', version: 1,
  visibility: { audience: 'household', creatorMembershipId: 'a', selectedMembershipIds: [] }, ...changes,
});

describe('task drafts', () => {
  it('starts with the viewer as assignee and a due time today', () => {
    expect(draft()).toMatchObject({ assigneeId: 'me', end: '2026-09-30T20:00', start: '', reviewerId: '', priority: 'normal' });
  });

  it('reads a stored task in Japan time, whatever offset it was saved with', () => {
    const value = todoToDraft(todo({ dueAt: '2026-09-30T11:00:00Z', dueStartAt: '2026-09-30T09:00:00+09:00', priority: 'high', colorLabelId: 'l', reviewerMembershipId: 'r', note: 'メモ' }));
    expect(value).toMatchObject({ end: '2026-09-30T20:00', start: '2026-09-30T09:00', priority: 'high', colorLabelId: 'l', reviewerId: 'r', note: 'メモ' });
  });

  it('turns a recurrence it cannot show into keep instead of rewriting it', () => {
    expect(todoToDraft(todo({ dueAt: '2026-10-01T07:30:00+09:00', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH', timezone: 'Asia/Tokyo', exceptions: [] } })).recurrence).toBe('weekly');
    expect(todoToDraft(todo({ dueAt: '2026-10-01T07:30:00+09:00', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', timezone: 'Asia/Tokyo', exceptions: [] } })).recurrence).toBe('keep');
  });
});

describe('taskDraftProblem', () => {
  it('accepts a plain task and one with no due date', () => {
    expect(taskDraftProblem(draft(), true)).toBeNull();
    expect(taskDraftProblem(draft({ end: '' }), true)).toBeNull();
  });

  it('checks the title, the range and the audience', () => {
    expect(taskDraftProblem(draft({ title: '  ' }), true)).toContain('タスク名');
    expect(taskDraftProblem(draft({ start: '2026-09-30T21:00' }), true)).toContain('期限は開始より後');
    expect(taskDraftProblem(draft({ start: '2026-09-30T20:00' }), true)).toBeNull();
    expect(taskDraftProblem(draft({ start: '2026-09-30T09:00', end: '' }), true)).toContain('期限も入力');
    expect(taskDraftProblem(draft({ audience: 'selected' }), true)).toContain('公開する人');
  });

  it('needs a due date to repeat, and an end that leaves room for one', () => {
    expect(taskDraftProblem(draft({ recurrence: 'daily', end: '' }), true)).toContain('繰り返すタスク');
    expect(taskDraftProblem(draft({ recurrence: 'daily', end: '' }), false)).toBeNull();
    expect(taskDraftProblem(draft({ recurrence: 'daily', until: '2026-09-01' }), true)).toContain('タスクが入りません');
    expect(taskDraftProblem(draft({ recurrence: 'every-n-days', intervalDays: 0 }), true)).toContain('間隔');
  });
});

describe('task inputs', () => {
  it('leaves out what was not filled in', () => {
    expect(taskDraftToCreateInput(draft({ title: ' 提出物 ', end: '' }))).toEqual({ title: '提出物', assigneeMembershipId: 'me', visibility: { audience: 'household', selectedMembershipIds: [] } });
  });

  it('sends every field that was filled in', () => {
    expect(taskDraftToCreateInput(draft({ start: '2026-09-30T09:00', note: 'メモ', reviewerId: 'r', priority: 'high', colorLabelId: 'l', audience: 'selected', selectedIds: ['r'], recurrence: 'weekly', until: '2026-12-31' }))).toEqual({
      title: '提出物', assigneeMembershipId: 'me', dueAt: '2026-09-30T20:00:00+09:00', dueStartAt: '2026-09-30T09:00:00+09:00', reviewerMembershipId: 'r', note: 'メモ', priority: 'high', colorLabelId: 'l',
      visibility: { audience: 'selected', selectedMembershipIds: ['r'] }, recurrence: { rrule: 'FREQ=WEEKLY;UNTIL=20261231', timezone: 'Asia/Tokyo', exceptions: [] },
    });
  });

  it('clears emptied fields with null, in a form the schema accepts', () => {
    const original = todo({ dueAt: '2026-09-30T20:00:00+09:00', dueStartAt: '2026-09-30T09:00:00+09:00', reviewerMembershipId: 'r', note: 'メモ', priority: 'high', colorLabelId: 'l' });
    const input = taskDraftToUpdateInput({ ...todoToDraft(original), start: '', end: '', reviewerId: '', note: ' ', priority: 'normal', colorLabelId: '' }, original, { recurrenceEditable: true });
    expect(input).toMatchObject({ dueAt: null, dueStartAt: null, reviewerMembershipId: null, note: null, priority: null, colorLabelId: null });
    expect(todoUpdateSchema.safeParse(input).success).toBe(true);
  });

  it('sends the audience and the rule only when they changed', () => {
    const rule = { rrule: 'FREQ=WEEKLY;BYDAY=TH', timezone: 'Asia/Tokyo', exceptions: ['2026-10-08' as const] };
    const original = todo({ dueAt: '2026-10-01T07:30:00+09:00', recurrence: rule, visibility: { audience: 'adults', creatorMembershipId: 'a', selectedMembershipIds: [] } });
    const unchanged = taskDraftToUpdateInput(todoToDraft(original), original, { recurrenceEditable: true });
    expect(unchanged).not.toHaveProperty('visibility');
    expect(unchanged).not.toHaveProperty('recurrence');
    const changed = taskDraftToUpdateInput({ ...todoToDraft(original), audience: 'creator', recurrence: 'daily' }, original, { recurrenceEditable: true });
    expect(changed.visibility).toEqual({ audience: 'creator', selectedMembershipIds: [] });
    expect(changed.recurrence).toEqual({ rrule: 'FREQ=DAILY', timezone: 'Asia/Tokyo', exceptions: ['2026-10-08'] });
    expect(taskDraftToUpdateInput({ ...todoToDraft(original), recurrence: 'none' }, original, { recurrenceEditable: true }).recurrence).toBeNull();
    expect(taskDraftToUpdateInput({ ...todoToDraft(original), recurrence: 'daily' }, original, { recurrenceEditable: false })).not.toHaveProperty('recurrence');
  });
});

describe('people', () => {
  const members = [member('owner', 'owner'), member('child', 'child'), member('guest', 'guest'), member('away', 'adult', 'suspended'), member('gone', 'adult', 'left')];

  it('offers active non-guests, and keeps whoever is already set', () => {
    expect(assignablePeople(members, []).map((item) => item.id)).toEqual(['owner', 'child']);
    expect(assignablePeople(members, ['guest', 'gone']).map((item) => item.id)).toEqual(['owner', 'child', 'guest', 'gone']);
  });

  it('finds who would lose sight of the task', () => {
    const outside = (changes: Parameters<typeof peopleOutsideVisibility>[0]) => peopleOutsideVisibility(changes, members, 'owner').map((item) => item.id);
    const base = { assigneeId: 'child', reviewerId: '', selectedIds: [] };
    expect(outside({ ...base, audience: 'household' })).toEqual([]);
    expect(outside({ ...base, audience: 'participants' })).toEqual([]);
    expect(outside({ ...base, audience: 'adults' })).toEqual(['child']);
    expect(outside({ ...base, audience: 'creator' })).toEqual(['child']);
    expect(outside({ ...base, audience: 'selected', selectedIds: ['owner'] })).toEqual(['child']);
    expect(outside({ ...base, audience: 'selected', selectedIds: ['child'] })).toEqual([]);
    expect(outside({ assigneeId: 'owner', reviewerId: 'child', audience: 'creator', selectedIds: [] })).toEqual(['child']);
  });
});
