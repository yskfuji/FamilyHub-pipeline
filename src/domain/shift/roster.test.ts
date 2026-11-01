import { describe, expect, it } from 'vitest';
import { defaultShiftRules } from './rules';
import { detectRosterMonth, legendRules, parseRoster } from './roster';
import type { RosterRow } from './roster';
import { rosterSamples } from './roster.fixtures';

const show = (row: RosterRow) => `${row.date} ${row.title} ${row.kind === 'unknown' ? '?' : row.kind === 'off' ? '終日' : `${row.startTime}-${row.endsNextDay ? '翌' : ''}${row.endTime}`}${row.warning ? ' !曜日' : ''}`;

describe('roster golden samples', () => {
  it('covers at least ten samples', () => expect(rosterSamples.length).toBeGreaterThanOrEqual(10));
  it.each(rosterSamples)('$name', (sample) => {
    const result = parseRoster(sample.text, { month: sample.month, rules: defaultShiftRules, person: sample.person });
    expect(result.rows.map(show)).toEqual(sample.expected);
    expect(result.layout).toBe(sample.layout);
    if (sample.people) expect(result.people).toEqual(sample.people);
    if (sample.legend) expect(result.legend.map((rule) => rule.label)).toEqual(sample.legend);
    expect(result.skipped).toHaveLength(sample.skipped ?? 0);
  });
});

describe('parseRoster', () => {
  const twoPeople = '氏名\t1\t2\t3\t4\t5\n田中\t早\t遅\t休\t早\t遅\n森\t休\t休\t早\t遅\t遅';

  it('waits for a choice when the table has several people', () => {
    const result = parseRoster(twoPeople, { month: '2026-10', rules: defaultShiftRules });
    expect(result.people).toEqual(['田中', '森']);
    expect(result.rows).toEqual([]);
  });

  it('finds a person by family name, and nobody when the name is not in the table', () => {
    expect(parseRoster('氏名\t1\t2\t3\t4\t5\n田中 花\t早\t遅\t休\t早\t遅', { month: '2026-10', rules: defaultShiftRules, person: '田中' }).rows).toHaveLength(5);
    expect(parseRoster(twoPeople, { month: '2026-10', rules: defaultShiftRules, person: '山本' }).rows).toEqual([]);
  });

  it('applies edited rules, including an overnight end', () => {
    const rules = defaultShiftRules.map((rule) => (rule.id === 'early' ? { ...rule, start: '05:30', end: '14:30' } : rule));
    expect(parseRoster('10/1 早番', { month: '2026-10', rules }).rows[0]).toMatchObject({ startTime: '05:30', endTime: '14:30', endsNextDay: false });
    const night = defaultShiftRules.map((rule) => (rule.id === 'early' ? { ...rule, start: '08:30', end: '09:00', endsNextDay: true } : rule));
    expect(parseRoster('10/1 早番', { month: '2026-10', rules: night }).rows[0]).toMatchObject({ endsNextDay: true });
  });

  it('gives the same result for the same input and ignores text with no shifts', () => {
    expect(parseRoster(twoPeople, { month: '2026-10', rules: defaultShiftRules, person: '森' })).toEqual(parseRoster(twoPeople, { month: '2026-10', rules: defaultShiftRules, person: '森' }));
    expect(parseRoster('お疲れさまです。今月もよろしくお願いします。', { month: '2026-10', rules: defaultShiftRules })).toMatchObject({ rows: [], layout: 'none' });
    expect(parseRoster('', { month: '2026-10', rules: defaultShiftRules }).rows).toEqual([]);
  });

  it('reads no date outside a month of the chosen one, and says so', () => {
    const result = parseRoster('3/1 早番\n2027/3/2 遅番\n9/30 休', { month: '2026-10', rules: defaultShiftRules });
    expect(result.rows.map((row) => row.date)).toEqual(['2026-09-30']);
    expect(result.skipped).toHaveLength(2);
  });

  it('carries a December roster into January', () => {
    expect(parseRoster('12/31 早番\n1/1 遅番', { month: '2026-12', rules: defaultShiftRules }).rows.map((row) => row.date)).toEqual(['2026-12-31', '2027-01-01']);
    expect(parseRoster('スタッフ\t29\t30\t31\t1\t2\n小川\t早\t早\t早\t早\t早', { month: '2026-12', rules: defaultShiftRules }).rows.map((row) => row.date).at(-1)).toBe('2027-01-02');
  });

  it('stops quickly on a long hostile paste', () => {
    const started = performance.now();
    parseRoster('1 '.repeat(100_000), { month: '2026-10', rules: defaultShiftRules });
    parseRoster('<'.repeat(100_000), { month: '2026-10', rules: defaultShiftRules });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('legendRules', () => {
  it('reads a legend into rules', () => {
    expect(legendRules('凡例\nA=9:00-18:00\nC：22:00～翌7:00')).toMatchObject([{ label: 'A', start: '09:00', end: '18:00', endsNextDay: false }, { label: 'C', start: '22:00', end: '07:00', endsNextDay: true }]);
  });
  it('reads several on a line, and a code with a name', () => {
    expect(legendRules('A 9-18 / B 13-22').map((rule) => rule.label)).toEqual(['A', 'B']);
    expect(legendRules('A 早番 7:00-16:00')).toMatchObject([{ label: '早番', aliases: ['A'] }]);
  });
  it('leaves out break times and other words', () => {
    expect(legendRules('休憩 12:00-13:00\n勤務時間 9:00-18:00')).toEqual([]);
  });
});

describe('detectRosterMonth', () => {
  it.each([
    ['2026年11月 シフト表', '2026-11'],
    ['令和8年12月分', '2026-12'],
    ['R8.11 勤務表', '2026-11'],
    ['10月度シフト', '2026-10'],
    ['1月分のシフト', '2027-01'],
    ['2026/11 勤務表', '2026-11'],
    ['11/3 早番', '2026-11'],
  ])('%s', (text, month) => expect(detectRosterMonth(text, '2026-10')).toBe(month));
  it('returns null when nothing says the month', () => expect(detectRosterMonth('1 早\n2 遅', '2026-10')).toBeNull());
});
