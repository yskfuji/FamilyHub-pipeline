import { describe, expect, it } from 'vitest';
import { eventInputSchema } from '../schemas';
import type { CalendarEvent } from '../types';
import { includedByDefault, proposalTimeText, saveProposals, shiftEventInput, toProposals } from './proposal';
import type { RosterRow } from './roster';

const target = { memberId: 'member-aoi', workLabelId: 'label-work', offLabelId: '', audience: 'participants' as const, selectedIds: [] };
const night: RosterRow = { date: '2026-10-31', symbol: '夜', kind: 'work', title: '夜勤', startTime: '22:00', endTime: '07:00', endsNextDay: true };
const off: RosterRow = { date: '2026-10-02', symbol: '休', kind: 'off', title: '休み', endsNextDay: false };
const unknown: RosterRow = { date: '2026-10-03', symbol: '研修', kind: 'unknown', title: '研修', endsNextDay: false };

describe('shiftEventInput', () => {
  it('ends an overnight shift the next day, across the month, in Japan time', () => {
    const input = shiftEventInput(night, target);
    expect(input).toMatchObject({ title: '夜勤', startsAt: '2026-10-31T22:00:00+09:00', endsAt: '2026-11-01T07:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: ['member-aoi'], colorLabelId: 'label-work' });
    expect(input.allDay).toBeUndefined();
    expect(eventInputSchema.safeParse(input).success).toBe(true);
  });

  it('makes an off day an all-day event with its own list', () => {
    expect(shiftEventInput(off, { ...target, offLabelId: 'label-off' })).toMatchObject({ allDay: true, startsAt: '2026-10-02T00:00:00+09:00', endsAt: '2026-10-02T23:59:00+09:00', colorLabelId: 'label-off' });
    expect(shiftEventInput(off, target).colorLabelId).toBeUndefined();
  });
});

describe('toProposals', () => {
  const existing = { title: '夜勤', startsAt: '2026-10-31T13:00:00Z', participantMembershipIds: ['member-aoi'] } as CalendarEvent;

  it('marks a shift that is already on the calendar and leaves it out by default', () => {
    const [row] = toProposals([night], [existing], 'member-aoi');
    expect(row.duplicate).toBe(true);
    expect(includedByDefault(row)).toBe(false);
    expect(toProposals([night], [existing], 'member-ren')[0].duplicate).toBe(false);
  });

  it('leaves out a symbol without a rule, and keeps the id stable', () => {
    const rows = toProposals([night, off, unknown], [], 'member-aoi');
    expect(rows.map(includedByDefault)).toEqual([true, true, false]);
    expect(rows.map((row) => row.id)).toEqual(toProposals([night, off, unknown], [], 'member-ren').map((row) => row.id));
    expect(rows.map(proposalTimeText)).toEqual(['22:00〜翌07:00', '終日', '規則なし']);
  });
});

describe('saveProposals', () => {
  it('keeps going after a failure and reports which rows failed', async () => {
    const rows = toProposals([night, off, { ...off, date: '2026-10-04' }], [], 'member-aoi');
    const steps: number[] = [];
    const outcome = await saveProposals(rows, async (row) => (row === rows[1] ? { ok: false, error: { code: 'CONFLICT', message: '保存できません', retryable: true } } : { ok: true, value: undefined }), (done) => steps.push(done));
    expect(outcome.saved).toEqual([rows[0].id, rows[2].id]);
    expect(outcome.failures).toEqual({ [rows[1].id]: '保存できません' });
    expect(steps).toEqual([1, 2, 3]);
  });

  it('saves nothing when nothing was chosen', async () => expect(await saveProposals([], () => { throw new Error('must not send'); })).toEqual({ saved: [], failures: {} }));
});
