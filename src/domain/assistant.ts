import { z } from 'zod';
import { addDateKeyDays } from './calendarDate';
import type { EventDraft } from './eventForm';
import type { ExpenseDraft } from './expenseForm';
import { expenseCategories } from './ledger';
import { isoDate } from './shift/text';
import type { Id, IsoDate, SpendingCategory } from './types';

/** 読み取りに送れる画像の大きさ。規則と同じ値で、送る前に理由を示すためにも使う。 */
export const READING_IMAGE_MAX_BYTES = 10_000_000;
export const READING_IMAGE_ACCEPT = '.jpg,.jpeg,.png';
/** 読み取りの結果を待つ時間。 */
export const READING_POLL_INTERVAL_MS = 1200;
export const READING_WAIT_MS = 120_000;

export interface AssistantStatus {
  available: boolean;
  /** 見本のデータを返す確認用の実装のとき。 */
  sample?: boolean;
}

export type AssistantJobKind = 'receipt' | 'event';
export type AssistantJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ReceiptProposal { amountJpy: number | null; date: IsoDate | null; merchant: string | null; category: SpendingCategory }
export interface EventCandidate { title: string; date: IsoDate; startTime: string | null; endTime: string | null; allDay: boolean; location: string | null }

export interface AssistantJob {
  id: Id;
  kind: AssistantJobKind;
  status: AssistantJobStatus;
  receipt?: ReceiptProposal;
  events?: EventCandidate[];
  /** 失敗の理由。 */
  message?: string;
  sample?: boolean;
}

/** 読み取りの結果は信用しない入力として扱う。長さを切り詰め、制御文字を除く。 */
const clamped = (max: number) => z.string().max(4000).transform((text) => text.replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max));
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional().transform((value) => value ?? null);

const receiptOutput = z.object({
  total: nullable(z.number().int().positive().max(99_999_999)),
  date_text: nullable(clamped(40)),
  merchant: nullable(clamped(120)),
  category: z.enum(expenseCategories as readonly [SpendingCategory, ...SpendingCategory[]]),
});

const clockText = /^([01]?\d|2[0-3]):[0-5]\d$/;
const eventOutput = z.object({
  candidates: z.array(z.object({
    title: clamped(120),
    date_text: clamped(40),
    start_time: nullable(clamped(5)),
    end_time: nullable(clamped(5)),
    all_day: z.boolean().optional(),
    location: nullable(clamped(200)),
  })).max(30),
});

const MAX_EVENT_CANDIDATES = 8;
const eras: Readonly<Record<string, number>> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };

/**
 * 書かれたままの日付を読む。年の計算はこちらで行う（和暦と2桁の年）。
 * 年がなければ、prefer が past なら今日以前、future なら今日以降でいちばん近い年にする。読めなければ null。
 */
export function parseDateText(text: string, today: IsoDate, prefer: 'past' | 'future'): IsoDate | null {
  const value = text.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  const era = /^(令和|平成|R|H)(\d{1,2})[年./-](\d{1,2})[月./-](\d{1,2})/.exec(value);
  if (era) return isoDate(eras[era[1]] + Number(era[2]), Number(era[3]), Number(era[4])) as IsoDate | null;
  const full = /^(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/.exec(value);
  if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3])) as IsoDate | null;
  const short = /^(\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/.exec(value);
  if (short) return isoDate(2000 + Number(short[1]), Number(short[2]), Number(short[3])) as IsoDate | null;
  const dated = /^(\d{1,2})[月/](\d{1,2})/.exec(value);
  if (!dated) return null;
  const year = Number(today.slice(0, 4));
  const candidates = [year - 1, year, year + 1].flatMap((item) => isoDate(item, Number(dated[1]), Number(dated[2])) ?? []);
  const fits = prefer === 'past' ? candidates.filter((date) => date <= today).at(-1) : candidates.find((date) => date >= today);
  return (fits ?? null) as IsoDate | null;
}

/** 読み取りの応答の本文を JSON として読む。囲みの記号が付いていても読み、読めなければ null。 */
export function jsonOfOutput(content: string): unknown {
  const body = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(body); } catch { return null; }
}

/** 領収書の読み取り結果を確かめる。形が違うものと、読めた項目が1つもないものは受け付けない。 */
export function parseReceiptOutput(output: unknown, today: IsoDate): ReceiptProposal | null {
  const parsed = receiptOutput.safeParse(output);
  if (!parsed.success) return null;
  const { total, date_text: dateText, merchant, category } = parsed.data;
  const date = dateText ? parseDateText(dateText, today, 'past') : null;
  const proposal = { amountJpy: total, date: date && date <= addDateKeyDays(today, 1) ? date : null, merchant: merchant || null, category };
  return proposal.amountJpy === null && proposal.date === null && proposal.merchant === null ? null : proposal;
}

const clockOf = (text: string | null) => (text && clockText.test(text) ? text.padStart(5, '0') : null);

/** 予定の読み取り結果を確かめる。日付を読めない候補は外す。候補が残らなければ受け付けない。 */
export function parseEventOutput(output: unknown, today: IsoDate): EventCandidate[] | null {
  const parsed = eventOutput.safeParse(output);
  if (!parsed.success) return null;
  const candidates = parsed.data.candidates.flatMap((item): EventCandidate[] => {
    const date = parseDateText(item.date_text, today, 'future');
    if (!date || !item.title) return [];
    const startTime = clockOf(item.start_time);
    const end = clockOf(item.end_time);
    return [{ title: item.title, date, startTime, endTime: startTime && end && end > startTime ? end : null, allDay: !startTime, location: item.location || null }];
  }).slice(0, MAX_EVENT_CANDIDATES);
  return candidates.length ? candidates : null;
}

/** 読み取りの結果を入れる項目。ほかの項目はフォームの初期値のまま。 */
export function receiptToDraft(proposal: ReceiptProposal): Partial<ExpenseDraft> {
  return {
    kind: 'expense', category: proposal.category,
    ...(proposal.merchant ? { title: proposal.merchant } : {}),
    ...(proposal.amountJpy ? { amount: String(proposal.amountJpy) } : {}),
    ...(proposal.date ? { date: proposal.date } : {}),
  };
}

const plusHour = (time: string) => {
  const hour = Number(time.slice(0, 2)) + 1;
  return hour > 23 ? '23:59' : `${String(hour).padStart(2, '0')}${time.slice(2)}`;
};

export function candidateToDraft(candidate: EventCandidate): Partial<EventDraft> {
  const shared = { title: candidate.title, allDay: candidate.allDay, location: candidate.location ?? '' };
  if (candidate.allDay || !candidate.startTime) return { ...shared, allDay: true, start: `${candidate.date}T00:00`, end: `${candidate.date}T23:59` };
  return { ...shared, start: `${candidate.date}T${candidate.startTime}`, end: `${candidate.date}T${candidate.endTime ?? plusHour(candidate.startTime)}` };
}

/** 読み取りに送るページの URL の形を確かめる。問題がなければ null。接続先の確認は別に行う。 */
export function readingUrlProblem(text: string): string | null {
  if (text.length > 2048) return 'URL が長すぎます。';
  let url: URL;
  try { url = new URL(text.trim()); } catch { return 'URL の形を確認してください。'; }
  if (url.protocol !== 'https:') return 'https で始まる URL を入力してください。';
  if (url.username || url.password) return '名前やパスワードを含む URL は使えません。';
  return null;
}

/** 送っても受け付けられない画像の理由。問題がなければ null。 */
export function readingImageProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const type = file.type || (/\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : '');
  if (type !== 'image/jpeg' && type !== 'image/png') return '読み取れるのはJPEGとPNGの画像です。';
  return file.size > READING_IMAGE_MAX_BYTES ? `画像は${READING_IMAGE_MAX_BYTES / 1_000_000}MB以内にしてください。` : null;
}
