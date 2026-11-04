import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../../data/fixtures';
import { taskDraftProblem, newTaskDraft } from '../taskForm';
import { draftProblem, newEventDraft } from '../eventForm';
import type { CalendarEvent, Expense, HouseholdSnapshot, Todo } from '../types';
import { allRecords, reviewRecords, scheduleConflicts } from './review';

const eventBase = baseSnapshot.events[0];
const todoBase = baseSnapshot.todos[0];
const expenseBase = baseSnapshot.expenses[0];
const event = (id: string, startsAt: string, endsAt: string, people: string[], extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ ...eventBase, id, title: id, startsAt, endsAt, participantMembershipIds: people, recurrence: undefined, allDay: false, ...extra });
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ ...todoBase, id, title: id, status: 'open', assigneeMembershipId: 'member-aoi', dueAt: undefined, recurrence: undefined, ...extra });
const spend = (id: string, category: Expense['category'], amountJpy: number, incurredOn: Expense['incurredOn']): Expense => ({ ...expenseBase, id, title: id, category, amountJpy, incurredOn, kind: 'expense', shares: [], settlements: [] });
const snapshot = (changes: Partial<HouseholdSnapshot>): HouseholdSnapshot => ({ ...baseSnapshot, events: [], todos: [], expenses: [], ...changes });
const kinds = (value: HouseholdSnapshot) => reviewRecords(value).findings.map((finding) => finding.kind);

describe('schedule conflicts', () => {
  const at = (hour: number) => `2026-10-02T${String(hour).padStart(2, '0')}:00:00+09:00`;

  it('finds two events overlapping for one person', () => {
    const review = reviewRecords(snapshot({ events: [event('歯医者', at(10), at(11), ['member-aoi']), event('面談', at(10), at(12), ['member-aoi', 'member-ren'])] }));
    const finding = review.findings.find((item) => item.kind === 'conflict');
    expect(finding?.summary).toContain('碧さん');
    expect(finding?.citations.map((citation) => citation.href)).toEqual(['/calendar/歯医者?on=2026-10-02', '/calendar/面談?on=2026-10-02']);
  });

  it('ignores back-to-back events, different people and all-day events', () => {
    expect(kinds(snapshot({ events: [event('a', at(10), at(11), ['member-aoi']), event('b', at(11), at(12), ['member-aoi'])] }))).not.toContain('conflict');
    expect(kinds(snapshot({ events: [event('a', at(10), at(11), ['member-aoi']), event('b', at(10), at(11), ['member-ren'])] }))).not.toContain('conflict');
    expect(kinds(snapshot({ events: [event('a', at(0), at(23), ['member-aoi'], { allDay: true }), event('b', at(10), at(11), ['member-aoi'])] }))).not.toContain('conflict');
  });

  it('sees the occurrence of a repeating event', () => {
    const weekly = event('週の習い事', '2026-09-02T10:00:00+09:00', '2026-09-02T11:00:00+09:00', ['member-aoi'], { recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: [] } });
    const review = reviewRecords(snapshot({ events: [weekly, event('面談', '2026-10-07T10:30:00+09:00', '2026-10-07T11:30:00+09:00', ['member-aoi'])] }));
    expect(review.findings.find((item) => item.kind === 'conflict')?.citations[0].href).toBe('/calendar/週の習い事?on=2026-10-07');
  });

  it('does not call a repeating event a conflict with itself', () => {
    const daily = event('長い当番', '2026-10-01T10:00:00+09:00', '2026-10-02T12:00:00+09:00', ['member-aoi'], { recurrence: { rrule: 'FREQ=DAILY', timezone: 'Asia/Tokyo', exceptions: [] } });
    expect(kinds(snapshot({ events: [daily] }))).not.toContain('conflict');
  });

  it('finds every overlapping pair, not only neighbours', () => {
    const long = event('long', at(9), at(13), ['member-aoi']);
    const conflicts = scheduleConflicts([long, event('x', at(10), at(11), ['member-aoi']), event('y', at(12), at(13), ['member-aoi'])].map((item) => ({ ...item, occurrenceDate: '2026-10-02' as const })));
    expect(conflicts).toHaveLength(2);
  });
});

describe('tasks', () => {
  it('counts overdue tasks and leaves out finished ones', () => {
    const review = reviewRecords(snapshot({ todos: [todo('古い', { dueAt: '2026-09-20T20:00:00+09:00' }), todo('もっと古い', { dueAt: '2026-09-10T20:00:00+09:00' }), todo('終わった', { dueAt: '2026-09-10T20:00:00+09:00', status: 'done' }), todo('先', { dueAt: '2026-10-20T20:00:00+09:00' })] }));
    const finding = review.findings.find((item) => item.kind === 'overdue');
    expect(finding?.title).toBe('期限を過ぎたタスクが2件');
    expect(finding?.citations.map((citation) => citation.id)).toEqual(['もっと古い', '古い']);
  });

  it('counts tasks with no due date and caps the links', () => {
    const review = reviewRecords(snapshot({ todos: Array.from({ length: 7 }, (_, index) => todo(`task-${index}`)) }));
    const finding = review.findings.find((item) => item.kind === 'no-due');
    expect(finding?.title).toBe('期限のないタスクが7件');
    expect(finding?.citations).toHaveLength(5);
    expect(finding?.moreCitations).toBe(2);
  });
});

describe('money', () => {
  it('adds up what is still unsettled and offers an event draft', () => {
    const finding = reviewRecords(baseSnapshot).findings.find((item) => item.kind === 'unsettled');
    expect(finding?.title).toMatch(/^未精算の合計は[¥￥]3,110$/);
    expect(finding?.citations.every((citation) => citation.href.startsWith('/budget/'))).toBe(true);
    expect(finding?.proposal.kind).toBe('event');
  });

  it('compares a category with last month only when it is well above it', () => {
    const higher = snapshot({ expenses: [spend('8月', 'food', 10_000, '2026-08-10'), spend('9月a', 'food', 9000, '2026-09-10'), spend('9月b', 'food', 9000, '2026-09-11')] });
    const finding = reviewRecords(higher).findings.find((item) => item.kind === 'spending');
    expect(finding?.title).toMatch(/^食費が先月より[¥￥]8,000多い$/);
    expect(finding?.citations.map((citation) => citation.id)).toEqual(['9月a', '9月b']);
    expect(kinds(snapshot({ expenses: [spend('a', 'food', 10_000, '2026-08-10'), spend('b', 'food', 14_000, '2026-09-10')] }))).not.toContain('spending');
    expect(kinds(snapshot({ expenses: [spend('a', 'food', 500, '2026-08-10'), spend('b', 'food', 2000, '2026-09-10')] }))).not.toContain('spending');
    expect(kinds(snapshot({ expenses: [spend('b', 'food', 90_000, '2026-09-10')] }))).not.toContain('spending');
  });

  it('never compares income as spending', () => {
    const income = { ...spend('給与', 'food', 300_000, '2026-09-10'), kind: 'income' as const };
    expect(kinds(snapshot({ expenses: [spend('a', 'food', 1000, '2026-08-10'), income] }))).not.toContain('spending');
  });
});

describe('load', () => {
  it('counts per person and says it only compares counts', () => {
    const review = reviewRecords(snapshot({ events: [event('a', '2026-10-02T10:00:00+09:00', '2026-10-02T11:00:00+09:00', ['member-ren'])], todos: [todo('t1', { assigneeMembershipId: 'member-ren' }), todo('t2', { assigneeMembershipId: 'member-ren', dueAt: '2026-09-01T20:00:00+09:00' })] }));
    expect(review.load.find((person) => person.membershipId === 'member-ren')).toMatchObject({ events: 1, openTasks: 2, overdueTasks: 1 });
    const finding = review.findings.find((item) => item.kind === 'load');
    expect(finding?.summary).toContain('件数だけの比較');
    expect(finding?.citations).toHaveLength(3);
  });

  it('counts each occurrence of a repeating event but cites the event once', () => {
    const weekly = event('週の習い事', '2026-10-01T10:00:00+09:00', '2026-10-01T11:00:00+09:00', ['member-aoi'], { recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: [] } });
    const review = reviewRecords(snapshot({ events: [weekly], todos: [todo('t', { dueAt: '2026-10-20T20:00:00+09:00' })] }));
    expect(review.load.find((person) => person.membershipId === 'member-aoi')?.events).toBe(2);
    expect(review.findings.find((item) => item.kind === 'load')?.citations.map((citation) => citation.id)).toEqual(['週の習い事', 't']);
  });

  it('stays quiet for small numbers', () => expect(kinds(snapshot({ todos: [todo('t', { dueAt: '2026-10-20T20:00:00+09:00' })] }))).not.toContain('load'));
});

describe('scope', () => {
  const full = snapshot({ events: baseSnapshot.events, todos: [...baseSnapshot.todos, todo('期限なし')], expenses: baseSnapshot.expenses });

  it('leaves out record types that are switched off', () => {
    const none = reviewRecords(full, { events: false, tasks: false, expenses: false });
    expect(none.findings).toEqual([]);
    expect(none.counted).toEqual({ events: 0, tasks: 0, expenses: 0 });
    const tasks = reviewRecords(full, { ...allRecords, expenses: false }).findings.map((finding) => finding.kind);
    expect(tasks).not.toContain('unsettled');
    expect(tasks).toContain('no-due');
  });

  it('never counts money for someone who cannot read it', () => {
    const viewer = { ...full.viewer, capabilities: full.viewer.capabilities.filter((item) => item !== 'expense.read') };
    expect(reviewRecords({ ...full, viewer }).findings.map((finding) => finding.kind)).not.toContain('unsettled');
  });
});

describe('every finding', () => {
  const busy = snapshot({
    events: [event('a', '2026-10-02T10:00:00+09:00', '2026-10-02T11:00:00+09:00', ['member-aoi']), event('b', '2026-10-02T10:30:00+09:00', '2026-10-02T11:30:00+09:00', ['member-aoi'])],
    todos: [todo('過ぎた', { dueAt: '2026-09-20T20:00:00+09:00' }), todo('期限なし')],
    expenses: [...baseSnapshot.expenses, spend('先月の食費', 'food', 3000, '2026-08-10'), spend('今月の食費', 'food', 9000, '2026-09-10')],
  });

  it('cites records that exist and offers a draft the forms accept', () => {
    const { findings } = reviewRecords(busy);
    expect(new Set(findings.map((finding) => finding.kind))).toEqual(new Set(['conflict', 'overdue', 'no-due', 'unsettled', 'spending', 'load']));
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
    for (const finding of findings) {
      expect(finding.citations.length).toBeGreaterThan(0);
      for (const citation of finding.citations) expect([...busy.events, ...busy.todos, ...busy.expenses].some((record) => record.id === citation.id)).toBe(true);
      if (finding.proposal.kind === 'task') expect(taskDraftProblem({ ...newTaskDraft('2026-09-30', 'member-aoi', 'household'), ...finding.proposal.task }, true)).toBeNull();
      else expect(draftProblem({ ...newEventDraft({ date: '2026-09-30' }, 'member-aoi', 'household'), ...finding.proposal.event }, true)).toBeNull();
    }
  });

  it('does not change the records', () => {
    const before = JSON.stringify(busy);
    reviewRecords(busy);
    expect(JSON.stringify(busy)).toBe(before);
  });
});
