import { TIMEZONE } from '../eventForm';
import { eventInputSchema } from '../schemas';
import type { EventInput } from '../schemas';
import { addDateKeyDays } from '../calendarDate';
import type { CalendarEvent, Id, Result, VisibilityAudience } from '../types';
import { visibilityInput } from '../visibilityForm';
import type { RosterRow } from './roster';

/** 確認の表の1行。id は同じ行を読み直しても変わらない。 */
export interface ShiftProposal extends RosterRow {
  id: string;
  /** すでに同じ予定があるとき。 */
  duplicate: boolean;
}

export interface ShiftSaveTarget {
  memberId: Id;
  workLabelId: string;
  offLabelId: string;
  audience: VisibilityAudience;
  selectedIds: Id[];
}

function times(row: RosterRow) {
  if (row.kind !== 'work' || !row.startTime || !row.endTime) return { startsAt: `${row.date}T00:00:00+09:00`, endsAt: `${row.date}T23:59:00+09:00`, allDay: true };
  return { startsAt: `${row.date}T${row.startTime}:00+09:00`, endsAt: `${row.endsNextDay ? addDateKeyDays(row.date, 1) : row.date}T${row.endTime}:00+09:00`, allDay: false };
}

export function toProposals(rows: readonly RosterRow[], events: readonly CalendarEvent[], memberId: Id): ShiftProposal[] {
  return rows.map((row) => {
    const { startsAt } = times(row);
    const duplicate = row.kind !== 'unknown' && events.some((event) => event.title === row.title && Date.parse(event.startsAt) === Date.parse(startsAt) && event.participantMembershipIds.includes(memberId));
    return { ...row, id: `${row.date}|${row.title}|${row.startTime ?? ''}`, duplicate };
  });
}

/** 最初から保存の対象にする行。分からない記号と、すでにある予定は外しておく。 */
export const includedByDefault = (row: ShiftProposal) => row.kind !== 'unknown' && !row.duplicate;

/** 確認した行を予定の入力にする。形は通常の予定の追加と同じ。 */
export function shiftEventInput(row: RosterRow, target: ShiftSaveTarget): EventInput {
  const { allDay, ...span } = times(row);
  const label = row.kind === 'off' ? target.offLabelId : target.workLabelId;
  return eventInputSchema.parse({
    title: row.title, ...span, timezone: TIMEZONE, participantMembershipIds: [target.memberId],
    visibility: visibilityInput(target.audience, target.selectedIds),
    ...(allDay ? { allDay: true } : {}),
    ...(label ? { colorLabelId: label } : {}),
  });
}

export interface ShiftSaveOutcome { saved: string[]; failures: Record<string, string> }

/** 1行ずつ保存する。失敗した行があっても残りを続け、どの行が失敗したかを返す。 */
export async function saveProposals(rows: readonly ShiftProposal[], send: (row: ShiftProposal) => Promise<Result<unknown>>, onProgress?: (done: number) => void): Promise<ShiftSaveOutcome> {
  const outcome: ShiftSaveOutcome = { saved: [], failures: {} };
  for (const [index, row] of rows.entries()) {
    const result = await send(row);
    if (result.ok) outcome.saved.push(row.id); else outcome.failures[row.id] = result.error.message;
    onProgress?.(index + 1);
  }
  return outcome;
}

export function proposalTimeText(row: RosterRow) {
  if (row.kind === 'off') return '終日';
  if (row.kind === 'unknown' || !row.startTime) return '規則なし';
  return `${row.startTime}〜${row.endsNextDay ? '翌' : ''}${row.endTime}`;
}
