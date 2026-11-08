/**
 * Web の計算（src/domain/*）を本物の TS の関数で動かし、入力と答えの組を JSON に書く。
 * iOS の移植（FHDomain）の試験は、この組を読んで同じ答えになることを確かめる。答えを手で書かない。
 *
 *   npx tsx scripts/ios/export-vectors.ts [--check]
 */
import { addDateKeyDays, dateKeyFromRfc3339, isMonthKey, monthGrid, monthKeyFromRfc3339, shiftMonthKey, toJstRfc3339, weekDates } from '../../src/domain/calendarDate';
import { holidaysOfYear } from '../../src/domain/holidays';
import { formatDate, formatDateOnly, formatDue, formatRelative, formatSignedYen, formatTime, formatYen } from '../../src/design-system/components';
import { writeGenerated } from './generated.mjs';

const target = 'ios/Packages/FamilyHubKit/Tests/FHDomainTests/Vectors';
const write = (name: string, cases: unknown) => writeGenerated(`${target}/${name}.json`, `${JSON.stringify(cases)}\n`);

// 祝日: 計算の範囲（2007〜2099年）と、その外の年（空になる）。
write('holidays', Array.from({ length: 2101 - 2005 }, (_, index) => 2005 + index).map((year) => ({ input: year, expected: holidaysOfYear(year).map(({ date, name }) => [date, name]) })));

// 日付の鍵。日本時間の日付の境目（UTC の 14:59 と 15:00）、月末、うるう年。
const instants = [
  '2026-09-30T07:30:00+09:00', '2026-09-29T14:59:59Z', '2026-09-29T15:00:00Z', '2024-02-29T23:59:00+09:00', '2024-12-31T15:00:00Z',
  '2025-01-01T00:00:00+09:00', '2026-03-31T23:30:00-05:00', '2030-06-15T12:00:00.123Z', '2000-02-29T00:00:00+09:00', '2099-12-31T14:59:00Z',
];
write('dateKeys', instants.map((input) => ({ input, expected: { date: dateKeyFromRfc3339(input), month: monthKeyFromRfc3339(input) } })));
write('toJst', instants.map((input) => ({ input, expected: toJstRfc3339(new Date(input)) })));

const dayShifts: Array<[string, number]> = [['2026-09-30', 1], ['2026-09-30', -30], ['2024-02-28', 1], ['2024-02-28', 2], ['2023-02-28', 1], ['2026-12-31', 1], ['2026-01-01', -1], ['2026-09-30', 400], ['2000-03-01', -1], ['2026-09-30', 0]];
write('addDays', dayShifts.map(([date, delta]) => ({ input: { date, delta }, expected: addDateKeyDays(date, delta) })));

const monthShifts: Array<[string, number]> = [['2026-09', 1], ['2026-12', 1], ['2026-01', -1], ['2026-09', -21], ['2026-09', 40]];
write('shiftMonth', monthShifts.map(([month, delta]) => ({ input: { month, delta }, expected: shiftMonthKey(month, delta) })));
write('isMonthKey', ['2026-09', '2026-13', '1899-12', '2100-12', '2101-01', '2026-9', 'abcd-ef', '2026-00'].map((input) => ({ input, expected: isMonthKey(input) })));

// 月の表（42マス、日曜はじまり）。2020〜2035年のすべての月。
const months: string[] = [];
for (let year = 2020; year <= 2035; year += 1) for (let month = 1; month <= 12; month += 1) months.push(`${year}-${String(month).padStart(2, '0')}`);
write('monthGrid', months.map((month) => ({ input: month, expected: monthGrid(month).map((cell) => [cell.date, cell.day, cell.inCurrentMonth]) })));
write('weekDates', ['2026-09-30', '2026-09-27', '2026-10-03', '2024-12-31', '2027-01-01'].map((input) => ({ input, expected: weekDates(input) })));

// 書式。
write('formatYen', [0, 1, 999, 1000, 3110, 320000, 1234567, -2860].map((input) => ({ input, expected: { yen: formatYen(input), signed: formatSignedYen(input) } })));
write('formatTime', instants.map((input) => ({ input, expected: { time: formatTime(input), date: formatDate(input) } })));
write('formatDateOnly', ['2026-09-30', '2026-01-01', '2024-02-29', '2099-12-31'].map((input) => ({ input, expected: formatDateOnly(input) })));
const asOf = '2026-09-30T07:30:00+09:00';
const dues = ['2026-09-30T18:00:00+09:00', '2026-10-01T07:30:00+09:00', '2026-09-29T20:00:00+09:00', '2026-10-05T09:00:00+09:00', '2026-09-30T00:10:00+09:00'];
write('formatDue', [...dues.map((input) => ({ input, expected: formatDue(input, asOf) })), { input: null, expected: formatDue(undefined, asOf) }]);
const pasts = ['2026-09-30T07:30:00+09:00', '2026-09-30T07:29:20+09:00', '2026-09-30T07:00:00+09:00', '2026-09-30T05:31:00+09:00', '2026-09-29T07:30:00+09:00', '2026-09-24T07:31:00+09:00', '2026-09-23T07:30:00+09:00', '2026-10-01T00:00:00+09:00'];
write('formatRelative', pasts.map((input) => ({ input, expected: formatRelative(input, asOf) })));
