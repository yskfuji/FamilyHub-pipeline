import { describe, expect, it } from 'vitest';
import { applyTemplate, draftProblem, draftToCreateInput, draftToUpdateInput, eventTimes, eventToDraft, newEventDraft, pastEventTemplates, recurrenceChoiceOf, reminderLabel, rruleOf, seriesEditPreview, withStart, type EventDraft } from './eventForm';
import { eventInputSchema, eventUpdateSchema } from './schemas';
import { LAST_DAY_OF_MONTH_RULE, describeRule, occurrenceDates } from './recurrence';
import type { CalendarEvent } from './types';

const draft = (extra: Partial<EventDraft> = {}): EventDraft => ({ ...newEventDraft({ date: '2026-10-05', time: '10:00' }, 'a', 'participants'), title: '予定', ...extra });
const stored = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'e', householdId: 'h', title: '予定', startsAt: '2026-10-05T10:00:00+09:00', endsAt: '2026-10-05T11:00:00+09:00', timezone: 'Asia/Tokyo', ownerMembershipId: 'a', participantMembershipIds: ['a'], version: 1, visibility: { audience: 'household', creatorMembershipId: 'a', selectedMembershipIds: [] }, ...extra });
const rule = (rrule: string) => ({ rrule, timezone: 'Asia/Tokyo', exceptions: [] });
const options = { recurrenceEditable: true };

describe('newEventDraft', () => {
  it('starts an hour long at the chosen time', () => {
    expect(draft()).toMatchObject({ start: '2026-10-05T10:00', end: '2026-10-05T11:00', participantIds: ['a'], audience: 'participants' });
  });

  it('stays on the same day for a late slot', () => {
    expect(newEventDraft({ date: '2026-10-05', time: '23:30' }, 'a', 'creator').end).toBe('2026-10-05T23:59');
  });
});

describe('recurrence choices', () => {
  it('builds each rule the form offers', () => {
    expect(rruleOf({ recurrence: 'none', intervalDays: 2, until: '' })).toBeNull();
    expect(rruleOf({ recurrence: 'daily', intervalDays: 2, until: '' })).toBe('FREQ=DAILY');
    expect(rruleOf({ recurrence: 'weekly', intervalDays: 2, until: '' })).toBe('FREQ=WEEKLY');
    expect(rruleOf({ recurrence: 'monthly', intervalDays: 2, until: '' })).toBe('FREQ=MONTHLY');
    expect(rruleOf({ recurrence: 'month-end', intervalDays: 2, until: '' })).toBe(LAST_DAY_OF_MONTH_RULE);
    expect(rruleOf({ recurrence: 'every-n-days', intervalDays: 10, until: '' })).toBe('FREQ=DAILY;INTERVAL=10');
    expect(rruleOf({ recurrence: 'weekly', intervalDays: 2, until: '2026-12-31' })).toBe('FREQ=WEEKLY;UNTIL=20261231');
  });

  it('reads back what it wrote', () => {
    for (const recurrence of ['daily', 'weekly', 'monthly', 'month-end', 'every-n-days'] as const) {
      const until = '2027-03-31';
      const rrule = rruleOf({ recurrence, intervalDays: 10, until })!;
      expect(recurrenceChoiceOf(rule(rrule), '2026-10-05')).toMatchObject({ recurrence, until });
    }
    expect(recurrenceChoiceOf(rule('FREQ=DAILY;INTERVAL=10'), '2026-10-05').intervalDays).toBe(10);
  });

  it('treats a weekly rule on the start weekday as weekly and keeps the rest untouched', () => {
    expect(recurrenceChoiceOf(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-10-05').recurrence).toBe('weekly');
    for (const rrule of ['FREQ=WEEKLY;BYDAY=TU', 'FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=WEEKLY;INTERVAL=2', 'FREQ=WEEKLY;COUNT=4', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=YEARLY']) {
      expect(recurrenceChoiceOf(rule(rrule), '2026-10-05').recurrence).toBe('keep');
    }
  });

  it('describes the month-end rule and lands on the last day of short months', () => {
    expect(describeRule('2026-01-31', rule(LAST_DAY_OF_MONTH_RULE))).toBe('毎月末日');
    expect(occurrenceDates('2027-01-31', rule(LAST_DAY_OF_MONTH_RULE), '2027-01-01', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
});

describe('times', () => {
  it('moves the end along with the start', () => {
    expect(withStart(draft(), '2026-10-05T14:30')).toMatchObject({ start: '2026-10-05T14:30', end: '2026-10-05T15:30' });
  });

  it('does not lose the end when the start is cleared', () => {
    expect(withStart(draft(), '')).toMatchObject({ start: '', end: '2026-10-05T11:00' });
  });

  it('stores an all-day event from the start of the first day to the end of the last', () => {
    expect(eventTimes(draft({ allDay: true, end: '2026-10-07T11:00' }))).toEqual({ startsAt: '2026-10-05T00:00:00+09:00', endsAt: '2026-10-07T23:59:00+09:00' });
  });

  it('reads a stored value as Japan time', () => {
    expect(eventToDraft(stored({ startsAt: '2026-10-05T01:00:00Z', endsAt: '2026-10-05T02:00:00Z' }))).toMatchObject({ start: '2026-10-05T10:00', end: '2026-10-05T11:00' });
  });
});

describe('draftProblem', () => {
  it('accepts a complete draft', () => {
    expect(draftProblem(draft(), true)).toBeNull();
  });

  it.each<[string, Partial<EventDraft>]>([
    ['予定名', { title: ' ' }],
    ['開始と終了', { start: '' }],
    ['終了日時', { end: '2026-10-05T09:00' }],
    ['参加者', { participantIds: [] }],
    ['公開する人', { audience: 'selected' }],
    ['8人', { audience: 'selected', selectedIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }],
    ['間隔', { recurrence: 'every-n-days', intervalDays: 0 }],
    ['間隔', { recurrence: 'every-n-days', intervalDays: 367 }],
    ['終了日', { recurrence: 'weekly', until: '2026-10-01' }],
    ['終了日', { recurrence: 'month-end', until: '2026-10-20' }],
  ])('rejects a draft and mentions %s', (word, extra) => {
    expect(draftProblem(draft(extra), true)).toContain(word);
  });

  it('accepts a one-day all-day event', () => {
    expect(draftProblem(draft({ allDay: true, end: '2026-10-05T09:00' }), true)).toBeNull();
  });

  it('ignores the recurrence when it cannot be edited', () => {
    expect(draftProblem(draft({ recurrence: 'weekly', until: '2026-10-01' }), false)).toBeNull();
  });
});

describe('draftToCreateInput', () => {
  it('produces input the shared schema accepts, with only what was filled in', () => {
    const input = draftToCreateInput(draft());
    expect(eventInputSchema.safeParse(input).success).toBe(true);
    expect(input).not.toHaveProperty('allDay');
    expect(input).not.toHaveProperty('recurrence');
    expect(input).not.toHaveProperty('reminderMinutesBefore');
    expect(input.visibility).toEqual({ audience: 'participants', selectedMembershipIds: [] });
  });

  it('carries every optional field', () => {
    const input = draftToCreateInput(draft({ allDay: true, location: ' 公園 ', note: ' 持ち物 ', colorLabelId: 'l', reminderMinutes: 1440, recurrence: 'month-end', weatherSensitive: true, audience: 'selected', selectedIds: ['b'] }));
    expect(eventInputSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({ allDay: true, location: '公園', note: '持ち物', colorLabelId: 'l', reminderMinutesBefore: 1440, weatherSensitive: true, recurrence: { rrule: LAST_DAY_OF_MONTH_RULE }, visibility: { audience: 'selected', selectedMembershipIds: ['b'] } });
  });

  it('drops the picked members when the audience is not selected', () => {
    expect(draftToCreateInput(draft({ audience: 'creator', selectedIds: ['b'] })).visibility?.selectedMembershipIds).toEqual([]);
  });
});

describe('draftToUpdateInput', () => {
  const edit = (event: CalendarEvent, extra: Partial<EventDraft> = {}, opts: Parameters<typeof draftToUpdateInput>[2] = options) => draftToUpdateInput({ ...eventToDraft(event), ...extra }, event, opts);

  it('clears emptied fields with null', () => {
    const input = edit(stored({ location: '公園', note: 'メモ', colorLabelId: 'l', reminderMinutesBefore: 10 }), { location: '', note: '', colorLabelId: '', reminderMinutes: null });
    expect(input).toMatchObject({ location: null, note: null, colorLabelId: null, reminderMinutesBefore: null });
    expect(eventUpdateSchema.safeParse(input).success).toBe(true);
  });

  it('leaves the audience out unless it changed', () => {
    expect(edit(stored({ visibility: { audience: 'adults', creatorMembershipId: 'a', selectedMembershipIds: [] } }))).not.toHaveProperty('visibility');
    expect(edit(stored(), { audience: 'creator' }).visibility).toEqual({ audience: 'creator', selectedMembershipIds: [] });
    expect(edit(stored({ visibility: { audience: 'selected', creatorMembershipId: 'a', selectedMembershipIds: ['b'] } }), { selectedIds: ['c'] }).visibility).toEqual({ audience: 'selected', selectedMembershipIds: ['c'] });
  });

  it('leaves the rule out unless it changed, so an unsupported rule survives an edit', () => {
    expect(edit(stored({ recurrence: rule('FREQ=WEEKLY;BYDAY=MO') }))).not.toHaveProperty('recurrence');
    expect(edit(stored({ recurrence: rule('FREQ=WEEKLY;BYDAY=MO,WE') }), { title: '別の名前' })).not.toHaveProperty('recurrence');
  });

  it('does not send the rule when only one occurrence is being edited', () => {
    expect(edit(stored({ recurrence: rule('FREQ=DAILY') }), { recurrence: 'weekly' }, { recurrenceEditable: false })).not.toHaveProperty('recurrence');
  });

  it('removes the rule with null and keeps the exceptions when the rule changes', () => {
    expect(edit(stored({ recurrence: rule('FREQ=DAILY') }), { recurrence: 'none' }).recurrence).toBeNull();
    const event = stored({ recurrence: { rrule: 'FREQ=DAILY', timezone: 'Asia/Tokyo', exceptions: ['2026-10-07'] } });
    expect(edit(event, { recurrence: 'weekly' }).recurrence).toEqual({ rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: ['2026-10-07'] });
  });

  it('adds a rule to an event that had none', () => {
    expect(edit(stored(), { recurrence: 'daily', until: '2026-10-09' }).recurrence).toEqual({ rrule: 'FREQ=DAILY;UNTIL=20261009', timezone: 'Asia/Tokyo', exceptions: [] });
  });

  it('applies the times to the first date of the series for a series edit', () => {
    const occurrence = stored({ startsAt: '2026-10-12T15:00:00+09:00', endsAt: '2026-10-13T16:00:00+09:00' });
    expect(edit(occurrence, {}, { recurrenceEditable: true, seriesStart: '2026-10-05' })).toMatchObject({ startsAt: '2026-10-05T15:00:00+09:00', endsAt: '2026-10-06T16:00:00+09:00' });
    expect(edit(occurrence, {}, { recurrenceEditable: true, seriesStart: '2026-10-05', occurrenceDate: '2026-10-12' })).toMatchObject({ startsAt: '2026-10-05T15:00:00+09:00', endsAt: '2026-10-06T16:00:00+09:00' });
  });

  it('moves the start of the series by the days the opened occurrence moved (A13)', () => {
    const series = stored({ startsAt: '2026-10-05T15:00:00+09:00', endsAt: '2026-10-05T16:00:00+09:00', recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: ['2026-10-19'] } });
    const draft = { ...eventToDraft(series), start: '2026-10-13T15:00', end: '2026-10-13T16:00' };
    const input = draftToUpdateInput(draft, series, { recurrenceEditable: true, seriesStart: '2026-10-05', occurrenceDate: '2026-10-12' });
    expect(input).toMatchObject({ startsAt: '2026-10-06T15:00:00+09:00', endsAt: '2026-10-06T16:00:00+09:00' });
    // 規則は送らない（受け取る側が曜日・例外日・UNTIL をずらす）。規則も変えるときは、例外日をここでずらして送る。
    expect(input).not.toHaveProperty('recurrence');
    expect(draftToUpdateInput({ ...draft, recurrence: 'daily' }, series, { recurrenceEditable: true, seriesStart: '2026-10-05', occurrenceDate: '2026-10-12' }).recurrence).toEqual({ rrule: 'FREQ=DAILY', timezone: 'Asia/Tokyo', exceptions: ['2026-10-20'] });
    expect(seriesEditPreview(draft, series, '2026-10-12')).toEqual({ kind: 'shift', deltaDays: 1, text: 'すべての予定を1日後へ移します（毎週火曜）' });
    expect(seriesEditPreview({ ...draft, start: '2026-10-12T15:00' }, series, '2026-10-12')).toBeNull();
    const monthly = stored({ startsAt: '2026-10-28T15:00:00+09:00', endsAt: '2026-10-28T16:00:00+09:00', recurrence: { rrule: 'FREQ=MONTHLY', timezone: 'Asia/Tokyo', exceptions: [] } });
    expect(seriesEditPreview({ ...eventToDraft(monthly), start: '2026-11-29T15:00', end: '2026-11-29T16:00' }, monthly, '2026-11-28')).toMatchObject({ kind: 'refused', deltaDays: 1, text: expect.stringContaining('「これ以降の予定」') });
  });
});

describe('past event templates', () => {
  const now = '2026-10-05T12:00:00+09:00';

  it('offers recent past events, newest first, once per name', () => {
    const events = [
      stored({ id: 'old', title: '通院', startsAt: '2026-09-01T10:00:00+09:00', endsAt: '2026-09-01T11:00:00+09:00' }),
      stored({ id: 'new', title: '通院', startsAt: '2026-10-01T10:00:00+09:00', endsAt: '2026-10-01T11:00:00+09:00' }),
      stored({ id: 'other', title: '買い物', startsAt: '2026-09-20T10:00:00+09:00', endsAt: '2026-09-20T11:00:00+09:00' }),
      stored({ id: 'future', title: '運動会', startsAt: '2026-10-10T10:00:00+09:00', endsAt: '2026-10-10T11:00:00+09:00' }),
      stored({ id: 'running', title: '面談', startsAt: '2026-10-05T11:00:00+09:00', endsAt: '2026-10-05T13:00:00+09:00' }),
    ];
    expect(pastEventTemplates(events, now).map((event) => event.id)).toEqual(['new', 'other']);
    expect(pastEventTemplates(events, now, 1)).toHaveLength(1);
  });

  const allowed = { allowedAudiences: ['participants', 'creator', 'selected'] as const, memberIds: ['a', 'b'] };

  it('keeps the chosen date and copies the time, length and details', () => {
    const template = stored({ title: '通院', startsAt: '2026-09-01T15:00:00+09:00', endsAt: '2026-09-01T16:30:00+09:00', location: '病院', note: '保険証', reminderMinutesBefore: 60, colorLabelId: 'l' });
    expect(applyTemplate(draft(), template, { allowedAudiences: ['household'], memberIds: ['a'] })).toMatchObject({ title: '通院', start: '2026-10-05T15:00', end: '2026-10-05T16:30', location: '病院', note: '保険証', reminderMinutes: 60, colorLabelId: 'l', audience: 'household' });
  });

  it('does not copy an audience the viewer cannot choose, or people who have left', () => {
    const result = applyTemplate(draft(), stored({ participantMembershipIds: ['b', 'gone'] }), allowed);
    expect(result.audience).toBe('participants');
    expect(result.participantIds).toEqual(['b']);
  });

  it('does not copy the rule', () => {
    expect(applyTemplate(draft(), stored({ recurrence: rule('FREQ=DAILY') }), allowed).recurrence).toBe('none');
  });
});

describe('reminderLabel', () => {
  it('reads naturally', () => {
    expect([10, 30, 60, 1440, 90].map(reminderLabel)).toEqual(['10分前', '30分前', '1時間前', '1日前', '90分前']);
  });
});
