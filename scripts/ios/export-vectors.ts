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

// ---- 段階 S1: 認証の入力・今日の画面 ----
{
  const { readFileSync } = await import('node:fs');
  const { passwordProblem, normalizePassword, loadCommonPasswords } = await import('../../src/domain/passwordPolicy');
  const { signUpSchema, ageOn } = await import('../../src/domain/account');
  const { currentPasswordSchema } = await import('../../src/domain/schemas');
  const { occurrenceDates, describeRule, nextOccurrenceAfter, withUntil, remainderRule, parseRRule } = await import('../../src/domain/recurrence');
  const { seasonOf } = await import('../../src/domain/season');
  const { stripLayout } = await import('../../src/domain/timeStrip');
  const { memberScopeChoices, scopedMemberId, inScope, eventInvolves, todoInvolves, expenseInvolves, memoInvolves } = await import('../../src/domain/memberScope');
  const { todayDigest, minutesOfDay } = await import('../../src/domain/todayDigest');
  type Snapshot = import('../../src/domain/types').HouseholdSnapshot;

  // パスワード。長さは UTF-16 の数で数える（JS の length）。全角・絵文字・空白・文脈の語・並び・頻出の一覧。
  const common = [...await loadCommonPasswords()];
  const context = { email: 'mori.aoi@example.test', displayName: '森 碧', householdName: '森さんち', memberNames: ['蓮', '花', 'ゆい'] };
  const passwords = [
    'short', 'a'.repeat(14), 'a'.repeat(15), 'x'.repeat(65), 'correct horse battery staple', 'これは長い日本語のパスワードです。', 'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯ',
    '😀😀😀😀😀😀😀😀', '😀a😀b😀c😀d😀e😀f😀g😀', 'abcabcabcabcabc', 'abababababababab', '123456789012345', '9876543210987654', 'qwertyuiopasdfgh', 'qwerty123456789',
    'zxcvbnm,./zxcvbnm', '1q2w3e4r5t6y7u8i', 'mori.aoimori.aoi', 'moriaoi12345678!', 'yoridokoroyoridokoro', 'よりどころよりどころよりどころ', 'Yoridokoro2026!!',
    '森さんち森さんち森さんち森さんち', '蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮蓮', 'ゆいゆいゆいゆい123456789', 'mori aoi mori aoi', 'river-maple-lantern-41', '   spaced out words here   ',
    'Ｙｏｒｉｄｏｋｏｒｏ１２３４５', 'a1b2c3d4e5f6g7h8', 'aaaaaaaaaaaaaaab', 'tsukimi-dango-2026', '　　　　　　　　　　　　　　　',
    ...common.filter((_, index) => index % 97 === 0).slice(0, 60), ...common.slice(0, 5).map((value) => value.toUpperCase()),
  ];
  write('passwordPolicy', passwords.map((input) => ({ input, expected: { plain: passwordProblem(input), checked: passwordProblem(input, { commonPasswords: new Set(common), context }), normalized: normalizePassword(input), current: currentPasswordSchema.safeParse(input).error?.issues[0]?.message ?? null } })));
  write('passwordContext', context);
  // 頻出の一覧そのもの。アプリに入れる（Swift の PasswordPolicy が読む）。
  writeGenerated('ios/Packages/FamilyHubKit/Sources/FHDomain/Resources/commonPasswords.json', readFileSync('src/domain/commonPasswords.json'));

  const signUps = [
    { displayName: '森 碧', email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    { displayName: '   ', email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    { displayName: 'あ'.repeat(41), email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    { displayName: '  森  ', email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    // zod の長さはコードポイントで数える（絵文字は1文字）。passwordPolicy の長さは UTF-16 で数える。
    { displayName: '😀'.repeat(40), email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    { displayName: '😀'.repeat(41), email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false },
    { displayName: '森 碧', email: 'aoi@example.test', password: '😀a😀b😀c😀d😀e😀f😀g😀h', birthdate: '1990-04-01', guardianConsent: false },
    ...['aoi@example', 'aoi@@example.test', '.aoi@example.test', 'aoi.@example.test', 'ao..i@example.test', 'a+b@sub.example.co.jp', "o'neil@example.test", 'aoi@-example.test', 'aoi@example.t', '碧@example.test', 'AOI@EXAMPLE.TEST', `${'a'.repeat(250)}@example.test`, ' aoi@example.test', 'aoi@example.test '].map((email) => ({ displayName: '森 碧', email, password: 'river-maple-lantern-41', birthdate: '1990-04-01', guardianConsent: false })),
    ...['short', 'abcabcabcabcabcabc', 'x'.repeat(65)].map((password) => ({ displayName: '森 碧', email: 'aoi@example.test', password, birthdate: '1990-04-01', guardianConsent: false })),
    ...['2026-02-30', '2026-9-01', '', '2012-04-01'].map((birthdate) => ({ displayName: '森 碧', email: 'aoi@example.test', password: 'river-maple-lantern-41', birthdate, guardianConsent: true })),
    { displayName: '', email: 'bad', password: 'short', birthdate: 'x', guardianConsent: false },
  ];
  write('signUp', signUps.map((input) => { const parsed = signUpSchema.safeParse(input); return { input, expected: parsed.success ? { ok: true, displayName: parsed.data.displayName, email: parsed.data.email } : { ok: false, message: parsed.error.issues[0]?.message ?? null } }; }));
  write('ageOn', [['2008-09-30', '2026-09-30'], ['2008-10-01', '2026-09-30'], ['2008-09-29', '2026-09-30'], ['2004-02-29', '2022-02-28'], ['2004-02-29', '2022-03-01'], ['1990-01-01', '2026-01-01'], ['2026-09-30', '2026-09-30']].map(([birthdate, today]) => ({ input: { birthdate, today }, expected: ageOn(birthdate, today) })));

  // 繰り返し。規則×開始日×範囲。対応しない規則は最初の1回だけ。
  const rules = [
    'FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=DAILY;COUNT=5', 'FREQ=DAILY;UNTIL=20261005', 'FREQ=DAILY;UNTIL=20261005T145959Z',
    'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'FREQ=WEEKLY;BYDAY=SU;COUNT=4', 'FREQ=WEEKLY;BYDAY=SA,SU,SA',
    'FREQ=MONTHLY', 'FREQ=MONTHLY;INTERVAL=2', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
    'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=1', 'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=MONTHLY;COUNT=3', 'FREQ=YEARLY', 'FREQ=DAILY;BYHOUR=9', 'FREQ=WEEKLY;BYDAY=XX',
    'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=367', 'FREQ=MONTHLY;BYSETPOS=-1', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;UNTIL=bad', 'FREQ=DAILY;BYDAY=MO', '',
  ];
  const starts = ['2026-09-30', '2026-01-31', '2024-02-29', '2026-09-27'];
  const ranges: Array<[string, string]> = [['2026-09-30', '2026-09-30'], ['2026-09-01', '2026-12-31'], ['2027-01-01', '2027-03-31'], ['2025-01-01', '2025-01-31']];
  const exceptions = [[], ['2026-10-02', '2026-10-15']];
  const recurrence: unknown[] = [];
  for (const rrule of rules) for (const start of starts) for (const [from, to] of ranges) for (const exception of exceptions) {
    const rule = { rrule, timezone: 'Asia/Tokyo', exceptions: exception };
    recurrence.push({ input: { start, rrule, exceptions: exception, from, to }, expected: occurrenceDates(start, rule, from, to) });
  }
  write('recurrence', recurrence);
  write('recurrenceRules', rules.flatMap((rrule) => starts.slice(0, 2).map((start) => {
    const rule = { rrule, timezone: 'Asia/Tokyo', exceptions: ['2026-10-02'] };
    return { input: { start, rrule }, expected: { parsed: parseRRule(rrule) !== null, describe: describeRule(start, rule), next: nextOccurrenceAfter(start, rule, '2026-10-01'), withUntil: withUntil(rrule, '2026-12-01'), remainder: remainderRule(start, rule, '2026-11-01') } };
  })));
  write('season', Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}-15`).map((input) => ({ input, expected: seasonOf(input) })));
  const stripCases = [
    { marks: [], now: 465 }, { marks: [{ start: 540, minutes: 60 }, { start: 560, minutes: 0 }, { start: 1080, minutes: 0 }, { start: 1090, minutes: 0 }], now: 465 },
    { marks: [{ start: 300, minutes: 30 }, { start: 1380, minutes: 90 }], now: 1430 }, { marks: [{ start: 600, minutes: 120 }, { start: 610, minutes: 30 }, { start: 620, minutes: 0 }], now: 0 },
  ];
  write('stripLayout', stripCases.map((input) => ({ input, expected: stripLayout(input.marks, input.now) })));

  // 今日の画面。人ごとの家族の記録（export-fixtures.mjs が書いたもの）を、時刻と「表示する人」を変えて計算する。
  const fixture = (actor: string) => JSON.parse(readFileSync(`ios/Packages/FamilyHubKit/Tests/FHModelTests/Fixtures/snapshot.${actor}.json`, 'utf8')) as Snapshot;
  const summary = (snapshot: Snapshot, scope: string) => {
    const memberId = scopedMemberId(scope, snapshot.viewer.membershipId, snapshot.memberships);
    const scoped = { events: inScope(snapshot.events, memberId, eventInvolves), todos: inScope(snapshot.todos, memberId, todoInvolves), expenses: inScope(snapshot.expenses, memberId, expenseInvolves), memos: inScope(snapshot.memos, memberId, memoInvolves) };
    const digest = todayDigest(snapshot, scoped);
    const strip = stripLayout(digest.timeline.map((item) => ({ start: minutesOfDay(item.at), minutes: item.minutes })), digest.now);
    return {
      memberId, scoped: { events: scoped.events.map((item) => item.id), todos: scoped.todos.map((item) => item.id), expenses: scoped.expenses.map((item) => item.id), memos: scoped.memos.map((item) => item.id) },
      today: digest.today, now: digest.now, greeting: digest.greeting, mine: digest.mine.map((todo) => todo.id), unsettled: digest.unsettled, spentThisMonth: digest.spentThisMonth,
      reviewTodo: digest.reviewTodo?.id ?? null, events: digest.events.map((event) => ({ id: event.id, startsAt: event.startsAt, minutes: event.minutes })), affected: digest.affected.map((event) => event.id),
      showWeather: digest.showWeather, timeline: digest.timeline, upcoming: digest.upcoming?.key ?? null, nextTask: digest.nextTask?.id ?? null, attention: digest.attention, empty: digest.empty, strip,
    };
  };
  const today: unknown[] = [];
  for (const actor of ['member-aoi', 'member-ren', 'member-hana']) {
    const base = fixture(actor);
    for (const asOf of ['2026-09-30T07:45:00+09:00', '2026-09-30T12:30:00+09:00', '2026-09-30T19:10:00+09:00', '2026-10-01T08:00:00+09:00', '2026-10-31T23:59:00+09:00']) {
      for (const scope of ['all', 'me', 'member-ren', 'member-yui', 'member-unknown']) {
        const snapshot = { ...base, context: { ...base.context, asOf } };
        today.push({ input: { actor, asOf, scope }, expected: summary(snapshot, scope) });
      }
    }
    const sunny = { ...base, context: { ...base.context, weather: { ...base.context.weather, condition: 'sunny' as const } } };
    today.push({ input: { actor, asOf: base.context.asOf, scope: 'all', weather: 'sunny' }, expected: summary(sunny, 'all') });
    const empty = { ...base, events: [], todos: [], expenses: [] };
    today.push({ input: { actor, asOf: base.context.asOf, scope: 'all', empty: true }, expected: summary(empty, 'all') });
  }
  write('todayDigest', today);
  write('memberScopeChoices', ['member-aoi', 'member-ren', 'member-hana', 'member-yui'].map((actor) => { const snapshot = fixture(actor); return { input: actor, expected: memberScopeChoices(snapshot.viewer.membershipId, snapshot.memberships) }; }));
}

