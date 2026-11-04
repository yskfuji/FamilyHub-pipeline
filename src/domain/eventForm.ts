import { addDateKeyDays, dateKeyFromRfc3339, toJstRfc3339 } from './calendarDate';
import { LAST_DAY_OF_MONTH_RULE, occurrenceDates, occurrenceStartsAt, parseRRule, withUntil } from './recurrence';
import type { EventInput, EventUpdateInput } from './schemas';
import { daysBetweenKeys, describeSeriesShift, seriesShiftRefusalMessage, shiftSeries } from './seriesShift';
import type { CalendarEvent, Id, RecurrenceRule, VisibilityAudience } from './types';
import { visibilityChange, visibilityInput, visibilityProblem } from './visibilityForm';

/** keep は、この画面で作れない規則をそのまま残すこと。 */
export type RecurrenceChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'month-end' | 'every-n-days' | 'keep';

export interface EventDraft {
  title: string;
  allDay: boolean;
  /** 日本時間の YYYY-MM-DDTHH:mm。終日のときは日付の部分だけを使う。 */
  start: string;
  end: string;
  location: string;
  note: string;
  participantIds: Id[];
  audience: VisibilityAudience;
  selectedIds: Id[];
  recurrence: RecurrenceChoice;
  intervalDays: number;
  until: string;
  colorLabelId: string;
  reminderMinutes: number | null;
  weatherSensitive: boolean;
}

/** 予定の追加を開くときの、前もって入れておく日時。 */
export interface EventPrefill { date: string; time?: string; allDay?: boolean }

export const reminderChoices = [10, 30, 60, 1440] as const;
export const reminderLabel = (minutes: number) => (minutes % 1440 === 0 ? `${minutes / 1440}日前` : minutes % 60 === 0 ? `${minutes / 60}時間前` : `${minutes}分前`);

export const TIMEZONE = 'Asia/Tokyo';
/** 時刻を、日時の入力欄に入れる日本時間の形にする。 */
export const toLocal = (iso: string) => toJstRfc3339(new Date(iso)).slice(0, 16);
export const toInstant = (local: string) => `${local}:00+09:00`;
const addMinutes = (local: string, minutes: number) => toLocal(new Date(Date.parse(toInstant(local)) + minutes * 60_000).toISOString());
const minutesBetween = (from: string, to: string) => (Date.parse(toInstant(to)) - Date.parse(toInstant(from))) / 60_000;
export const isValidLocal = (local: string) => Number.isFinite(Date.parse(toInstant(local)));

export function newEventDraft(prefill: EventPrefill, viewerMembershipId: Id, audience: VisibilityAudience): EventDraft {
  const start = `${prefill.date}T${prefill.time ?? '18:00'}`;
  const lastMinute = `${prefill.date}T23:59`;
  const end = addMinutes(start, 60) > lastMinute ? lastMinute : addMinutes(start, 60);
  return { title: '', allDay: prefill.allDay ?? false, start, end, location: '', note: '', participantIds: [viewerMembershipId], audience, selectedIds: [], recurrence: 'none', intervalDays: 2, until: '', colorLabelId: '', reminderMinutes: null, weatherSensitive: false };
}

/** 規則をこの画面の選択肢に直す。開始日に合わない規則や回数の指定は keep にして、書き換えない。 */
export function recurrenceChoiceOf(rule: RecurrenceRule | undefined, startKey: string): Pick<EventDraft, 'recurrence' | 'intervalDays' | 'until'> {
  const none = { intervalDays: 2, until: '' };
  if (!rule) return { recurrence: 'none', ...none };
  const parsed = parseRRule(rule.rrule);
  const keep = { recurrence: 'keep', ...none } as const;
  if (!parsed || parsed.count !== undefined) return keep;
  const until = parsed.until ?? '';
  const weekday = new Date(`${startKey}T00:00:00Z`).getUTCDay();
  if (parsed.freq === 'DAILY') return parsed.interval === 1 ? { recurrence: 'daily', intervalDays: 2, until } : { recurrence: 'every-n-days', intervalDays: parsed.interval, until };
  if (parsed.interval !== 1) return keep;
  if (parsed.freq === 'WEEKLY') return parsed.byDay.length === 0 || (parsed.byDay.length === 1 && parsed.byDay[0] === weekday) ? { recurrence: 'weekly', intervalDays: 2, until } : keep;
  if (!parsed.byMonthDay.length) return { recurrence: 'monthly', intervalDays: 2, until };
  return withoutUntil(rule.rrule) === LAST_DAY_OF_MONTH_RULE ? { recurrence: 'month-end', intervalDays: 2, until } : keep;
}

const withoutUntil = (rrule: string) => rrule.split(';').filter((part) => !part.startsWith('UNTIL=')).join(';');

const baseRules: Record<'daily' | 'weekly' | 'monthly' | 'month-end', string> = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', 'month-end': LAST_DAY_OF_MONTH_RULE };

/** 選択肢を RRULE にする。繰り返さないときと keep のときは null。 */
export function rruleOf(draft: Pick<EventDraft, 'recurrence' | 'intervalDays' | 'until'>): string | null {
  if (draft.recurrence === 'none' || draft.recurrence === 'keep') return null;
  const base = draft.recurrence === 'every-n-days' ? `FREQ=DAILY;INTERVAL=${draft.intervalDays}` : baseRules[draft.recurrence];
  return draft.until ? withUntil(base, draft.until) : base;
}

export function eventToDraft(event: CalendarEvent): EventDraft {
  return {
    title: event.title, allDay: Boolean(event.allDay), start: toLocal(event.startsAt), end: toLocal(event.endsAt),
    location: event.location ?? '', note: event.note ?? '', participantIds: [...event.participantMembershipIds],
    audience: event.visibility.audience, selectedIds: [...event.visibility.selectedMembershipIds],
    ...recurrenceChoiceOf(event.recurrence, dateKeyFromRfc3339(event.startsAt)),
    colorLabelId: event.colorLabelId ?? '', reminderMinutes: event.reminderMinutesBefore ?? null, weatherSensitive: Boolean(event.weatherSensitive),
  };
}

/** 開始を動かすときは、長さを保って終了も動かす。 */
export function withStart(draft: EventDraft, start: string): EventDraft {
  if (!isValidLocal(start) || !isValidLocal(draft.start) || !isValidLocal(draft.end)) return { ...draft, start };
  return { ...draft, start, end: addMinutes(draft.end, minutesBetween(draft.start, start)) };
}

export function eventTimes(draft: Pick<EventDraft, 'allDay' | 'start' | 'end'>): { startsAt: string; endsAt: string } {
  if (draft.allDay) return { startsAt: `${draft.start.slice(0, 10)}T00:00:00+09:00`, endsAt: `${draft.end.slice(0, 10)}T23:59:00+09:00` };
  return { startsAt: toInstant(draft.start), endsAt: toInstant(draft.end) };
}

/** 繰り返しの入力の確認。start は最初の回の日付、noun は「予定」のような記録の名前。 */
export function recurrenceProblem(rule: Pick<EventDraft, 'recurrence' | 'intervalDays' | 'until'>, start: string, noun: string): string | null {
  if (rule.recurrence === 'every-n-days' && !(Number.isInteger(rule.intervalDays) && rule.intervalDays >= 1 && rule.intervalDays <= 366)) return '繰り返す間隔は1日から366日のあいだで入力してください。';
  const rrule = rruleOf(rule);
  if (rrule && !occurrenceDates(start, { rrule, timezone: TIMEZONE, exceptions: [] }, start, addDateKeyDays(start, 800)).length) return `繰り返しの終了日までに${noun}が入りません。終了日を確認してください。`;
  return null;
}

/** 入力の確認。問題があれば文言を返す。recurrenceEditable が false のときは繰り返しを見ない。 */
export function draftProblem(draft: EventDraft, recurrenceEditable: boolean): string | null {
  if (!draft.title.trim()) return '予定名を入力してください。';
  if (!isValidLocal(draft.start.slice(0, 16)) || !isValidLocal(draft.end.slice(0, 16))) return '開始と終了の日時を入力してください。';
  const { startsAt, endsAt } = eventTimes(draft);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return '終了日時は開始日時より後にしてください。';
  if (!draft.participantIds.length) return '参加者を1人以上選んでください。';
  return visibilityProblem(draft.audience, draft.selectedIds) ?? (recurrenceEditable ? recurrenceProblem(draft, draft.start.slice(0, 10), '予定') : null);
}

export function draftToCreateInput(draft: EventDraft): EventInput {
  const rrule = rruleOf(draft);
  return {
    title: draft.title.trim(), ...eventTimes(draft), timezone: TIMEZONE, participantMembershipIds: draft.participantIds,
    visibility: visibilityInput(draft.audience, draft.selectedIds),
    ...(draft.allDay ? { allDay: true } : {}),
    ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    ...(draft.weatherSensitive ? { weatherSensitive: true } : {}),
    ...(draft.colorLabelId ? { colorLabelId: draft.colorLabelId } : {}),
    ...(draft.reminderMinutes !== null ? { reminderMinutesBefore: draft.reminderMinutes } : {}),
    ...(rrule ? { recurrence: { rrule, timezone: TIMEZONE, exceptions: [] } } : {}),
  };
}

/**
 * 変更の入力。空にした項目は null で外す。公開範囲と繰り返しは、変えたときだけ送る
 * （子どもが選べない公開範囲の予定を、題名だけ直せるようにするため）。
 * seriesStart を渡すと、シリーズの開始日に時刻を当てはめる。occurrenceDate（開いた回の日付）も渡すと、
 * 下書きの日付と開いた回の日付の差だけシリーズの開始日をずらす（A13。規則・例外日・UNTIL は受け取る側がずらす）。
 */
export function draftToUpdateInput(draft: EventDraft, original: CalendarEvent, options: { recurrenceEditable: boolean; seriesStart?: string; occurrenceDate?: string }): EventUpdateInput {
  const times = eventTimes(draft);
  const deltaDays = options.seriesStart ? seriesDeltaDays(draft, options.occurrenceDate) : 0;
  if (options.seriesStart) {
    const span = daysBetweenKeys(dateKeyFromRfc3339(times.startsAt), dateKeyFromRfc3339(times.endsAt));
    const start = addDateKeyDays(options.seriesStart, deltaDays);
    times.endsAt = occurrenceStartsAt(times.endsAt, addDateKeyDays(start, span));
    times.startsAt = occurrenceStartsAt(times.startsAt, start);
  }
  const before = recurrenceChoiceOf(original.recurrence, dateKeyFromRfc3339(original.startsAt));
  const rule = { recurrence: draft.recurrence, intervalDays: draft.intervalDays, until: draft.until };
  const recurrenceChanged = options.recurrenceEditable && draft.recurrence !== 'keep' && rruleOf(rule) !== rruleOf(before);
  const rrule = rruleOf(rule);
  // 規則を同時に変えるときは、受け取る側は規則をそのまま使うので、例外日はここで同じだけずらす。
  const exceptions = (original.recurrence?.exceptions ?? []).map((date) => addDateKeyDays(date, deltaDays));
  return {
    title: draft.title.trim(), ...times, allDay: draft.allDay, participantMembershipIds: draft.participantIds,
    location: draft.location.trim() || null, note: draft.note.trim() || null, weatherSensitive: draft.weatherSensitive,
    colorLabelId: draft.colorLabelId || null, reminderMinutesBefore: draft.reminderMinutes,
    ...visibilityChange(draft.audience, draft.selectedIds, original.visibility),
    ...(recurrenceChanged ? { recurrence: rrule ? { rrule, timezone: TIMEZONE, exceptions } : null } : {}),
  };
}

/** 「すべて」の編集で、下書きの日付が開いた回の日付から何日動いたか。開いた回がわからなければ 0。 */
export const seriesDeltaDays = (draft: Pick<EventDraft, 'start'>, occurrenceDate?: string) => occurrenceDate ? daysBetweenKeys(occurrenceDate, draft.start.slice(0, 10)) : 0;

/**
 * 「すべて」の編集で日付を動かしたときの見通し。保存の前に示す文か、ずらせない理由（「これ以降の予定」への案内つき）を返す。
 * 日付が動いていないとき、または規則も同時に変えるとき（その規則をそのまま使う）は null。
 */
export function seriesEditPreview(draft: EventDraft, series: CalendarEvent, occurrenceDate: string, recurrenceEditable = true): { kind: 'shift' | 'refused'; deltaDays: number; text: string } | null {
  const deltaDays = seriesDeltaDays(draft, occurrenceDate);
  if (deltaDays === 0 || !series.recurrence) return null;
  const before = recurrenceChoiceOf(series.recurrence, dateKeyFromRfc3339(series.startsAt));
  if (recurrenceEditable && draft.recurrence !== 'keep' && rruleOf(draft) !== rruleOf(before)) return null;
  const shifted = shiftSeries(series, deltaDays);
  if (!shifted.ok) return { kind: 'refused', deltaDays, text: seriesShiftRefusalMessage(shifted.reason) };
  return { kind: 'shift', deltaDays, text: describeSeriesShift(series, deltaDays) ?? '' };
}

/** 過去の予定から作るときの候補。新しい順に、同じ名前は1つにまとめる。 */
export function pastEventTemplates(events: readonly CalendarEvent[], nowIso: string, limit = 5): CalendarEvent[] {
  const now = Date.parse(nowIso);
  const names = new Set<string>();
  return events.filter((event) => Date.parse(event.endsAt) < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).filter((event) => {
    const name = event.title.trim();
    if (names.has(name)) return false;
    names.add(name);
    return true;
  }).slice(0, limit);
}

/** 過去の予定の内容を入れる。日付は今の入力のまま、時刻と長さは元の予定に合わせる。繰り返しは写さない。 */
export function applyTemplate(draft: EventDraft, event: CalendarEvent, options: { allowedAudiences: readonly VisibilityAudience[]; memberIds: readonly Id[] }): EventDraft {
  const date = draft.start.slice(0, 10);
  const start = `${date}T${toLocal(event.startsAt).slice(11)}`;
  const end = addMinutes(start, (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000);
  const participants = event.participantMembershipIds.filter((id) => options.memberIds.includes(id));
  const keepAudience = options.allowedAudiences.includes(event.visibility.audience);
  return {
    ...draft, title: event.title, allDay: Boolean(event.allDay), start, end, location: event.location ?? '', note: event.note ?? '',
    participantIds: participants.length ? participants : draft.participantIds,
    audience: keepAudience ? event.visibility.audience : draft.audience,
    selectedIds: keepAudience ? event.visibility.selectedMembershipIds.filter((id) => options.memberIds.includes(id)) : draft.selectedIds,
    colorLabelId: event.colorLabelId ?? '', reminderMinutes: event.reminderMinutesBefore ?? null, weatherSensitive: Boolean(event.weatherSensitive),
  };
}
