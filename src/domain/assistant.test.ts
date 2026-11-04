import { describe, expect, it } from 'vitest';
import { draftProblem, newEventDraft } from './eventForm';
import { candidateToDraft, jsonOfOutput, parseDateText, parseEventOutput, parseReceiptOutput, readingImageProblem, readingUrlProblem, receiptToDraft } from './assistant';
import { expenseDraftProblem, newExpenseDraft } from './expenseForm';

const today = '2026-10-15';

describe('parseDateText', () => {
  it.each([
    ['2026年10月14日', '2026-10-14'],
    ['2026/10/14', '2026-10-14'],
    ['2026-10-14(水)', '2026-10-14'],
    ['２０２６／１０／１４', '2026-10-14'],
    ['令和8年10月14日', '2026-10-14'],
    ['R8.10.14', '2026-10-14'],
    ['平成31年4月1日', '2019-04-01'],
    ['26-10-14', '2026-10-14'],
  ])('reads %s', (text, expected) => expect(parseDateText(text, today, 'past')).toBe(expected));

  it('picks the nearest year when none is written', () => {
    expect(parseDateText('12/25', today, 'past')).toBe('2025-12-25');
    expect(parseDateText('12月25日', today, 'future')).toBe('2026-12-25');
    expect(parseDateText('1/5', today, 'future')).toBe('2027-01-05');
    expect(parseDateText('10/15', today, 'future')).toBe('2026-10-15');
  });

  it('refuses what is not a date', () => {
    for (const text of ['2026/13/1', '2/30', '明日', '', '午後3時']) expect(parseDateText(text, today, 'past')).toBeNull();
  });
});

describe('jsonOfOutput', () => {
  it('reads plain and fenced output, and gives null otherwise', () => {
    expect(jsonOfOutput('{"a":1}')).toEqual({ a: 1 });
    expect(jsonOfOutput('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonOfOutput('all done!')).toBeNull();
  });
});

describe('parseReceiptOutput', () => {
  const valid = { total: 2480, date_text: '2026/10/14', merchant: '青葉スーパー', category: 'food' };

  it('accepts a valid reading', () => expect(parseReceiptOutput(valid, today)).toEqual({ amountJpy: 2480, date: '2026-10-14', merchant: '青葉スーパー', category: 'food' }));

  it('refuses a wrong shape', () => {
    for (const bad of [null, 'text', [], { ...valid, total: -1 }, { ...valid, total: 12.5 }, { ...valid, total: '2480' }, { ...valid, total: 1e12 }, { ...valid, category: 'rent' }, { ...valid, merchant: 'x'.repeat(5000) }, { ...valid, merchant: 7 }]) expect(parseReceiptOutput(bad, today)).toBeNull();
  });

  it('refuses a reading where nothing was read', () => expect(parseReceiptOutput({ total: null, date_text: null, merchant: null, category: 'other' }, today)).toBeNull());

  it('keeps what was read and blanks an unreadable or future date', () => {
    expect(parseReceiptOutput({ ...valid, date_text: 'よめない' }, today)).toMatchObject({ date: null, amountJpy: 2480 });
    expect(parseReceiptOutput({ ...valid, date_text: '2030/1/1' }, today)).toMatchObject({ date: null });
  });

  it('clamps lengths and removes control characters', () => {
    const merchant = parseReceiptOutput({ ...valid, merchant: `店\u0000‮名${'あ'.repeat(300)}` }, today)?.merchant;
    expect(merchant).toHaveLength(120);
    expect(merchant?.startsWith('店名あ')).toBe(true);
  });
});

describe('parseEventOutput', () => {
  const candidate = { title: '区民まつり', date_text: '10月27日', start_time: '10:00', end_time: '15:30', all_day: false, location: '中央公園' };

  it('accepts candidates and fills the year', () => expect(parseEventOutput({ candidates: [candidate] }, today)).toEqual([{ title: '区民まつり', date: '2026-10-27', startTime: '10:00', endTime: '15:30', allDay: false, location: '中央公園' }]));

  it('makes an event without a time all-day and drops a bad time', () => {
    expect(parseEventOutput({ candidates: [{ ...candidate, start_time: null, end_time: null }] }, today)?.[0]).toMatchObject({ allDay: true, startTime: null });
    expect(parseEventOutput({ candidates: [{ ...candidate, start_time: '25:99' }] }, today)?.[0]).toMatchObject({ allDay: true, startTime: null });
    expect(parseEventOutput({ candidates: [{ ...candidate, end_time: '09:00' }] }, today)?.[0]).toMatchObject({ endTime: null });
  });

  it('drops a candidate without a date, and refuses when none remain', () => {
    expect(parseEventOutput({ candidates: [{ ...candidate, date_text: '未定' }, candidate] }, today)).toHaveLength(1);
    expect(parseEventOutput({ candidates: [{ ...candidate, date_text: '未定' }] }, today)).toBeNull();
    expect(parseEventOutput({ candidates: [] }, today)).toBeNull();
    expect(parseEventOutput({ events: [] }, today)).toBeNull();
  });

  it('keeps at most eight candidates', () => expect(parseEventOutput({ candidates: Array.from({ length: 20 }, () => candidate) }, today)).toHaveLength(8));
});

describe('drafts', () => {
  it('fills the expense form with what was read and nothing else', () => {
    const draft = { ...newExpenseDraft(today, 'member-aoi', ['member-aoi'], 'household'), ...receiptToDraft({ amountJpy: 2480, date: '2026-10-14', merchant: '青葉スーパー', category: 'food' }) };
    expect(draft).toMatchObject({ title: '青葉スーパー', amount: '2480', date: '2026-10-14', category: 'food', payerId: 'member-aoi' });
    expect(expenseDraftProblem(draft, false)).toBeNull();
    expect(receiptToDraft({ amountJpy: null, date: null, merchant: null, category: 'other' })).toEqual({ kind: 'expense', category: 'other' });
  });

  it('fills the event form so that it passes the form check', () => {
    const base = newEventDraft({ date: today }, 'member-aoi', 'household');
    const timed = candidateToDraft({ title: 'a', date: '2026-10-27', startTime: '10:00', endTime: null, allDay: false, location: null });
    expect(timed).toMatchObject({ start: '2026-10-27T10:00', end: '2026-10-27T11:00', allDay: false });
    expect(draftProblem({ ...base, ...timed }, true)).toBeNull();
    const allDay = candidateToDraft({ title: 'a', date: '2026-10-27', startTime: null, endTime: null, allDay: true, location: '公園' });
    expect(allDay).toMatchObject({ allDay: true, location: '公園' });
    expect(draftProblem({ ...base, ...allDay }, true)).toBeNull();
    expect(candidateToDraft({ title: 'a', date: '2026-10-27', startTime: '23:30', endTime: null, allDay: false, location: null }).end).toBe('2026-10-27T23:59');
  });
});

describe('input checks', () => {
  it('accepts only https URLs without credentials', () => {
    expect(readingUrlProblem('https://example.com/event')).toBeNull();
    for (const url of ['http://example.com/', 'ftp://example.com/', 'not a url', 'https://user:pw@example.com/', `https://example.com/${'a'.repeat(3000)}`]) expect(readingUrlProblem(url)).not.toBeNull();
  });

  it('accepts only JPEG and PNG within the limit', () => {
    expect(readingImageProblem({ name: 'r.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(readingImageProblem({ name: 'r.PNG', type: '', size: 1000 })).toBeNull();
    expect(readingImageProblem({ name: 'r.heic', type: 'image/heic', size: 1000 })).toContain('JPEG');
    expect(readingImageProblem({ name: 'r.png', type: 'image/png', size: 20_000_000 })).toContain('MB');
  });
});
