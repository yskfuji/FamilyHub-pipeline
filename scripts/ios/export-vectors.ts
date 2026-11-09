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

// ---- 段階 S2: 予定（カレンダーの配置・入力・繰り返しのずらし・シフト表・読み取り） ----
{
  const { readFileSync } = await import('node:fs');
  const layout = await import('../../src/domain/calendarLayout');
  const { movedDateKey, isDateKey, calendarDayKeys } = await import('../../src/domain/calendarDate');
  const labels = await import('../../src/features/calendar/calendarLabels');
  const form = await import('../../src/domain/eventForm');
  const shift = await import('../../src/domain/seriesShift');
  const visibility = await import('../../src/domain/visibilityForm');
  const { audienceLabel, audienceHelp } = await import('../../src/content/ja');
  const { candidateToDraft, readingUrlProblem, readingImageProblem } = await import('../../src/domain/assistant');
  const text = await import('../../src/domain/shift/text');
  const rules = await import('../../src/domain/shift/rules');
  const roster = await import('../../src/domain/shift/roster');
  const proposal = await import('../../src/domain/shift/proposal');
  const { rosterSamples } = await import('../../src/domain/shift/roster.fixtures');
  type CalendarEvent = import('../../src/domain/types').CalendarEvent;
  type Snapshot = import('../../src/domain/types').HouseholdSnapshot;
  const fixture = (actor: string) => JSON.parse(readFileSync(`ios/Packages/FamilyHubKit/Tests/FHModelTests/Fixtures/snapshot.${actor}.json`, 'utf8')) as Snapshot;

  // 決まった種から作る乱数（毎回同じ予定の組になる）。
  let seed = 20261001;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const pad = (value: number) => String(value).padStart(2, '0');
  const members = ['member-aoi', 'member-ren', 'member-hana', 'member-yui'];
  const event = (id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id, householdId: 'house-mori', title: `予定${id}`, startsAt, endsAt, timezone: 'Asia/Tokyo', ownerMembershipId: 'member-aoi', participantMembershipIds: ['member-aoi'], version: 1,
    visibility: { audience: 'household', creatorMembershipId: 'member-aoi', selectedMembershipIds: [] }, ...extra,
  });
  const recurringRules = ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'FREQ=MONTHLY', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1', 'FREQ=DAILY;COUNT=4', 'FREQ=WEEKLY;UNTIL=20261031'];
  const generated: CalendarEvent[] = [];
  for (let index = 0; index < 70; index += 1) {
    const day = 20 + Math.floor(random() * 50);
    const date = addDateKeyDays('2026-09-01', day - 20);
    const kind = random();
    const hour = Math.floor(random() * 24);
    const minute = pick([0, 0, 15, 30, 45]);
    const start = `${date}T${pad(hour)}:${pad(minute)}:00+09:00`;
    let endsAt: string;
    let allDay: boolean | undefined;
    if (kind < 0.15) { allDay = true; endsAt = `${addDateKeyDays(date, pick([0, 0, 1, 3]))}T23:59:00+09:00`; }
    else if (kind < 0.25) endsAt = `${addDateKeyDays(date, pick([1, 2]))}T${pad(Math.floor(random() * 24))}:00:00+09:00`;
    else if (kind < 0.3) endsAt = `${addDateKeyDays(date, 1)}T00:00:00+09:00`;
    else endsAt = new Date(Date.parse(start) + pick([10, 30, 45, 60, 90, 120, 240]) * 60_000).toISOString().replace('Z', '+00:00');
    const recurring = random() < 0.3;
    const startsAt = allDay ? `${date}T00:00:00+09:00` : start;
    generated.push(event(`g${index}`, startsAt, Date.parse(endsAt) > Date.parse(startsAt) ? endsAt : `${date}T23:59:00+09:00`, {
      ...(allDay ? { allDay } : {}), participantMembershipIds: [pick(members), ...(random() < 0.3 ? [pick(members)] : [])].filter((item, at, list) => list.indexOf(item) === at),
      ...(recurring ? { recurrence: { rrule: pick(recurringRules), timezone: 'Asia/Tokyo', exceptions: random() < 0.4 ? [addDateKeyDays(date, 7)] : [] } } : {}),
      ...(random() < 0.3 ? { location: '公民館' } : {}), ...(random() < 0.3 ? { colorLabelId: 'label-school' } : {}), ...(random() < 0.2 ? { reminderMinutesBefore: pick([10, 30, 60, 1440, 90]) } : {}),
      ...(random() < 0.2 ? { weatherSensitive: true } : {}), ...(random() < 0.2 ? { note: 'メモ' } : {}),
      visibility: { audience: pick(['household', 'adults', 'participants', 'creator', 'selected'] as const), creatorMembershipId: 'member-aoi', selectedMembershipIds: random() < 0.5 ? ['member-ren'] : [] },
    }));
  }
  const events = [...fixture('member-aoi').events, ...generated];
  write('calendarEvents', events);
  write('calendarSnapshot', fixture('member-aoi'));
  const brief = (item: import('../../src/domain/calendarLayout').Occurrence) => [item.id, item.occurrenceDate, item.startsAt, item.endsAt];
  const ranges: Array<[string, string]> = [['2026-09-27', '2026-10-03'], ['2026-09-01', '2026-10-31'], ['2026-10-15', '2026-10-15'], ['2026-11-01', '2026-11-30'], ['2027-01-01', '2027-01-31']];
  write('calendarOccurrences', ranges.map(([from, to]) => ({ input: { from, to }, expected: layout.occurrencesBetween(events, from, to).map(brief) })));
  const startingDates = ['2026-09-30', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-31', '2026-11-12'];
  write('occurrenceStartingOn', events.slice(0, 40).flatMap((item) => startingDates.map((date) => ({ input: { id: item.id, date }, expected: (() => { const hit = layout.occurrenceStartingOn(item, date); return hit ? brief(hit) : null; })() }))));
  const placement = (item: import('../../src/domain/calendarLayout').LanePlacement) => [item.occurrence.id, item.occurrence.occurrenceDate, item.lane, item.colStart, item.colEnd, item.continuesBefore, item.continuesAfter];
  const lanes: unknown[] = [];
  for (const month of ['2026-09', '2026-10', '2026-11']) {
    for (const week of layout.monthWeeks(month)) {
      const dates = week.map((day) => day.date);
      const occurrences = layout.occurrencesBetween(events, dates[0], dates[6]);
      for (const maxLanes of [2, 3, 4]) for (const clip of [false, true]) {
        const result = layout.layoutLanes(dates, occurrences.filter((item) => dates.some((date) => layout.occursOn(item, date))), maxLanes, clip ? { from: `${month}-01`, to: layout.lastDayOfMonth(month) } : undefined);
        lanes.push({ input: { month, first: dates[0], maxLanes, clip }, expected: { placements: result.placements.map(placement), hidden: result.hidden } });
      }
    }
  }
  write('layoutLanes', lanes);
  write('monthWeeks', ['2026-09', '2026-02', '2015-02', '2026-08', '2100-12'].map((input) => ({ input, expected: layout.monthWeeks(input).map((week) => week.map((day) => day.date)) })));
  const timeline: unknown[] = [];
  for (let offset = 0; offset < 50; offset += 1) {
    const date = addDateKeyDays('2026-09-25', offset);
    const occurrences = layout.occurrencesBetween(events, date, date);
    for (const maxColumns of [1, 2, 4, 6]) {
      const result = layout.layoutTimeline(occurrences, date, maxColumns);
      timeline.push({ input: { date, maxColumns }, expected: { blocks: result.blocks.map((block) => [block.occurrence.id, block.start, block.end, block.column, block.columns]), hidden: result.hidden } });
    }
  }
  write('layoutTimeline', timeline);
  const dayTexts = layout.occurrencesBetween(events, '2026-09-28', '2026-10-12').map((item) => ({
    input: { id: item.id, date: item.occurrenceDate },
    expected: { when: labels.whenLabel(item), on: [0, 1, 2].map((delta) => labels.timeOnDay(item, addDateKeyDays(item.occurrenceDate, delta))), last: layout.lastDateOf(item), spanning: layout.isSpanning(item) },
  }));
  write('calendarTexts', dayTexts);
  const days = Array.from({ length: 40 }, (_, index) => addDateKeyDays('2026-09-15', index * 3 - 10));
  write('calendarDays', days.map((date) => ({
    input: date,
    expected: {
      day: labels.dayLabel(date), yearDay: labels.yearDayHeading(date), week: labels.weekHeading(weekDates(date)), month: labels.monthHeading(date.slice(0, 7)),
      tone: labels.dayTone(date, labels.holidayMap(date, date).get(date)) ?? null, moved: calendarDayKeys.map((key) => movedDateKey(date, key)),
      todos: layout.todosOn(fixture('member-aoi').todos, date).map((todo) => todo.id), expenses: layout.expensesOn(fixture('member-aoi').expenses, date).map((item) => item.id),
    },
  })));
  write('calendarSmall', {
    isDateKey: ['2026-09-30', '2026-02-29', '2024-02-29', '2026-13-01', '1899-12-31', '2101-01-01', '2026-9-30', '', 'abcd'].map((input) => [input, isDateKey(input)]),
    slot: [[0, 40], [19, 40], [20, 40], [959, 40], [1000, 40], [200, 0], [-5, 40]].map(([offset, hour]) => [offset, hour, layout.slotMinutes(offset, hour)]),
    initial: [[['2026-09-30'], '2026-09-30', 30], [['2026-09-30'], '2026-09-30', 600], [['2026-10-01'], '2026-09-30', 600]].map(([dates, today, now]) => [dates, today, now, layout.initialTimelineMinutes(dates as string[], today as string, now as number)]),
    clock: [0, 5, 59, 60, 545, 1439].map((minutes) => [minutes, layout.clockOf(minutes)]),
    lastDay: ['2026-02', '2024-02', '2026-12', '2026-09'].map((month) => [month, layout.lastDayOfMonth(month)]),
    reminder: [10, 30, 60, 90, 1440, 2880, 45].map((minutes) => [minutes, form.reminderLabel(minutes)]),
    validLocal: ['2026-02-30T18:00', '2026-02-29T18:00', '2026-09-30T24:00', '2026-09-30T24:01', '2026-09-30T23:60', '2026-9-30T10:00', '', '2026-09-30', '2026-09-30T1:00', '2026-13-01T00:00', '2026-09-32T00:00'].map((local) => [local, form.isValidLocal(local)]),
  });

  // 予定の入力。
  const drafts = events.map((item) => form.eventToDraft(item));
  write('eventDrafts', events.map((item, index) => ({ input: item.id, expected: { draft: drafts[index], create: form.draftToCreateInput(drafts[index]), problem: form.draftProblem(drafts[index], true) } })));
  const prefills = [{ date: '2026-09-30' }, { date: '2026-09-30', time: '23:30' }, { date: '2026-09-30', time: '09:00', allDay: true }, { date: '2026-12-31', time: '23:00' }, { date: '2026-10-01', time: '00:00' }];
  write('newEventDrafts', prefills.map((input) => ({ input, expected: form.newEventDraft(input, 'member-aoi', 'household') })));
  const base = form.newEventDraft({ date: '2026-09-30', time: '10:00' }, 'member-aoi', 'household');
  const variants: Array<[string, Partial<import('../../src/domain/eventForm').EventDraft>]> = [
    ['empty title', { title: '  ' }], ['ok', { title: '  買い物 ' }], ['bad start', { title: 'a', start: '2026-09-30' }], ['end before', { title: 'a', end: '2026-09-30T09:00' }],
    ['same time', { title: 'a', end: '2026-09-30T10:00' }], ['all day ok', { title: 'a', allDay: true, end: '2026-09-30T00:00' }], ['all day before', { title: 'a', allDay: true, end: '2026-09-29T23:00' }],
    ['no participants', { title: 'a', participantIds: [] }], ['selected none', { title: 'a', audience: 'selected', selectedIds: [] }],
    ['selected many', { title: 'a', audience: 'selected', selectedIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }],
    ['every 0', { title: 'a', recurrence: 'every-n-days', intervalDays: 0 }], ['every 400', { title: 'a', recurrence: 'every-n-days', intervalDays: 400 }],
    ['every 3', { title: 'a', recurrence: 'every-n-days', intervalDays: 3, until: '2026-12-01' }], ['until before', { title: 'a', recurrence: 'daily', until: '2026-09-01' }],
    ['month end', { title: 'a', recurrence: 'month-end' }], ['weekly until', { title: 'a', recurrence: 'weekly', until: '2026-10-31' }], ['keep', { title: 'a', recurrence: 'keep' }],
    ['full', { title: 'a', location: ' 公園 ', note: ' 持ち物 ', colorLabelId: 'label-school', reminderMinutes: 30, weatherSensitive: true, audience: 'selected', selectedIds: ['member-ren'] }],
  ];
  write('eventDraftChecks', variants.map(([name, patch]) => {
    const draft = { ...base, ...patch };
    return { input: { name, draft }, expected: { problem: form.draftProblem(draft, true), locked: form.draftProblem(draft, false), create: form.draftToCreateInput(draft) } };
  }));
  write('withStart', [['2026-09-30T12:00', base], ['2026-10-01T23:30', base], ['bad', base], ['2026-09-30T12:00', { ...base, end: 'bad' }]].map(([start, draft]) => ({ input: { start, draft }, expected: form.withStart(draft as typeof base, start as string) })));
  const recurringEvents = events.filter((item) => item.recurrence);
  const updates: unknown[] = [];
  for (const original of [...events.slice(0, 3), ...recurringEvents.slice(0, 12)]) {
    const occurrence = layout.occurrencesBetween([original], '2026-09-01', '2027-03-31')[1] ?? layout.occurrencesBetween([original], '2026-09-01', '2027-03-31')[0];
    if (!occurrence) continue;
    const draft = form.eventToDraft(occurrence);
    const edits: Array<[string, Partial<typeof draft>]> = [['same', {}], ['cleared', { location: '', note: '', colorLabelId: '', reminderMinutes: null }], ['moved', form.withStart(draft, `${addDateKeyDays(draft.start.slice(0, 10), 1)}T${draft.start.slice(11)}`)], ['moved back', form.withStart(draft, `${addDateKeyDays(draft.start.slice(0, 10), -3)}T${draft.start.slice(11)}`)], ['rule', { recurrence: 'daily' }], ['no rule', { recurrence: 'none' }], ['audience', { audience: 'creator' }]];
    for (const [name, edit] of edits) {
      const changed = { ...draft, ...edit };
      const seriesStart = dateKeyFromRfc3339(original.startsAt);
      updates.push({
        input: { id: original.id, occurrenceDate: occurrence.occurrenceDate, name, draft: changed },
        expected: {
          plain: form.draftToUpdateInput(changed, original, { recurrenceEditable: true }),
          locked: form.draftToUpdateInput(changed, original, { recurrenceEditable: false }),
          series: form.draftToUpdateInput(changed, original, { recurrenceEditable: true, seriesStart, occurrenceDate: occurrence.occurrenceDate }),
          preview: original.recurrence ? form.seriesEditPreview(changed, original, occurrence.occurrenceDate) : null,
          previewLocked: original.recurrence ? form.seriesEditPreview(changed, original, occurrence.occurrenceDate, false) : null,
        },
      });
    }
  }
  write('eventUpdates', updates);
  const choiceRules = [...recurringRules, 'FREQ=WEEKLY;BYDAY=TH', 'FREQ=WEEKLY;BYDAY=MO', 'FREQ=MONTHLY;INTERVAL=2', 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;UNTIL=20261231', 'FREQ=DAILY;INTERVAL=1;UNTIL=20261231', 'FREQ=YEARLY'];
  write('recurrenceChoices', choiceRules.flatMap((rrule) => ['2026-10-01', '2026-10-05'].map((start) => {
    const choice = form.recurrenceChoiceOf({ rrule, timezone: 'Asia/Tokyo', exceptions: [] }, start);
    return { input: { rrule, start }, expected: { choice, rrule: form.rruleOf(choice) } };
  })));
  write('pastTemplates', ['2026-09-30T07:30:00+09:00', '2026-10-20T12:00:00+09:00', '2026-11-30T00:00:00+09:00'].map((now) => {
    const templates = form.pastEventTemplates(events, now);
    return { input: now, expected: { ids: templates.map((item) => item.id), applied: templates.map((item) => form.applyTemplate(base, item, { allowedAudiences: ['participants', 'creator', 'selected'], memberIds: ['member-aoi', 'member-ren'] })) } };
  }));

  // 繰り返しのずらし。
  const shiftRules = [...recurringRules, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', 'FREQ=WEEKLY;INTERVAL=3;BYDAY=SU,SA', 'FREQ=MONTHLY;BYMONTHDAY=1,27', 'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=MONTHLY;BYMONTHDAY=10;BYSETPOS=1', 'FREQ=WEEKLY;COUNT=3;UNTIL=20261031', 'FREQ=YEARLY'];
  const shiftCases: unknown[] = [];
  for (const rrule of shiftRules) for (const start of ['2026-10-01', '2026-10-27', '2026-10-31', '2026-10-04']) for (const delta of [-8, -1, 1, 3, 6, 7, 30]) {
    const series = event('s', `${start}T08:00:00+09:00`, `${start}T09:30:00+09:00`, { recurrence: { rrule, timezone: 'Asia/Tokyo', exceptions: [addDateKeyDays(start, 14)] } });
    const result = shift.shiftSeries(series, delta);
    shiftCases.push({ input: { rrule, start, delta }, expected: { refusal: shift.seriesShiftRefusal(start, series.recurrence!, delta), shifted: result.ok ? { startsAt: result.event.startsAt, endsAt: result.event.endsAt, recurrence: result.event.recurrence } : result.reason, describe: shift.describeSeriesShift(series, delta) } });
  }
  write('seriesShift', shiftCases);

  // 公開範囲。
  const roles = ['owner', 'adult', 'child', 'guest'] as const;
  const kinds = ['event', 'task', 'memo', 'album', 'expense'] as const;
  const audiences = ['household', 'adults', 'participants', 'creator', 'selected'] as const;
  write('visibility', roles.flatMap((role) => kinds.map((kind) => ({
    input: { role, kind },
    expected: {
      choices: audiences.map((current) => visibility.audienceChoices(role, kind, current)), plain: visibility.audienceChoices(role, kind),
      defaults: [...audiences, undefined].map((preferred) => visibility.defaultAudience(role, kind, preferred)),
      labels: audiences.map((audience) => audienceLabel(kind, audience)), help: audiences.map((audience) => audienceHelp(kind, audience)),
    },
  }))));
  const original = { audience: 'selected' as const, creatorMembershipId: 'member-aoi', selectedMembershipIds: ['member-ren', 'member-hana'] };
  write('visibilityChange', [['selected', ['member-hana', 'member-ren']], ['selected', ['member-ren']], ['household', ['member-ren']], ['household', []], ['selected', ['member-ren', 'member-hana', 'member-yui']]].map(([audience, ids]) => ({ input: { audience, ids }, expected: { change: visibility.visibilityChange(audience as 'selected', ids as string[], original).visibility ?? null, problem: visibility.visibilityProblem(audience as 'selected', ids as string[]) } })));

  // 読み取り。
  const candidates = [
    { title: '秋祭り', date: '2026-10-10', startTime: '10:00', endTime: '15:00', allDay: false, location: '中央公園' },
    { title: 'バザー', date: '2026-10-11', startTime: '23:30', endTime: null, allDay: false, location: null },
    { title: '運動会', date: '2026-10-12', startTime: null, endTime: null, allDay: false, location: null },
    { title: '展示', date: '2026-10-13', startTime: '09:00', endTime: '17:00', allDay: true, location: '市民館' },
    { title: '説明会', date: '2026-10-14', startTime: '09:15', endTime: null, allDay: false, location: '' },
  ];
  write('readingCandidates', candidates.map((input) => ({ input, expected: { ...base, ...candidateToDraft(input) } })));
  write('readingUrls', ['https://example.com/event', ' https://example.com/a ', 'http://example.com', 'ftp://example.com', 'example.com', 'https://user:pw@example.com', 'https://user@example.com', 'https://@example.com', 'https://:pw@example.com', 'https://', 'https:example.com', 'HTTPS://EXAMPLE.COM', `https://example.com/${'a'.repeat(2050)}`, 'https://exa mple.com', 'https://[::1]/', 'javascript:alert(1)', ''].map((input) => ({ input, expected: readingUrlProblem(input) })));
  write('readingImages', [['a.jpg', '', 10], ['a.JPEG', '', 10], ['a.png', 'image/png', 10_000_001], ['a.heic', 'image/heic', 10], ['a.png', '', 10_000_000], ['a.gif', '', 1], ['a', 'image/jpeg', 5]].map(([name, type, size]) => ({ input: { name, type, size }, expected: readingImageProblem({ name: name as string, type: type as string, size: size as number }) })));

  // シフト表。見本の表に、全角・改行・月・人の違いを加えて読む。
  const fullWidth = (value: string) => value.replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
  const texts = rosterSamples.flatMap((sample) => [sample.text, fullWidth(sample.text), sample.text.replace(/\n/g, '\r\n'), `${sample.text}\n\n`, sample.text.split('\n').slice(0, 3).join('\n')]);
  write('rosterText', texts.flatMap((input) => input.split(/\r?\n/).slice(0, 6)).filter((line, index, list) => list.indexOf(line) === index).map((input) => ({ input, expected: { normalized: text.normalizeRosterText(input), cells: text.cellsOf(text.normalizeRosterText(input)), range: text.findClockRange(text.normalizeRosterText(input)) } })));
  const clocks = ['9:00-18:00', '22:00-31:00', '8:30〜翌9:00', '9時から18時', '9時半-13時15分', '30:00-31:00', '9-18', '25:00-26:00', '7:00-7:00', '9:61-10:00', '23:00-01:00', 'A 9:00 から 翌日 6:00 まで'];
  write('clockRanges', clocks.map((input) => ({ input, expected: text.findClockRange(text.normalizeRosterText(input)) })));
  write('rosterPeople', ['佐藤 花子', '佐藤さん', '佐藤', 'サトウ', '花子ちゃん', '', '  '].flatMap((a) => ['佐藤花子', '佐藤', '花子', '鈴木'].map((b) => ({ input: [a, b], expected: { same: text.samePerson(a, b), key: text.personKey(a) } }))));
  const parses: unknown[] = [];
  for (const sample of rosterSamples) {
    const months = [sample.month, shiftMonthKey(sample.month, 1), shiftMonthKey(sample.month, -2)];
    const variants = [sample.text, fullWidth(sample.text), sample.text.replace(/\n/g, '\r\n')];
    for (const variant of variants) for (const month of months) {
      const first = roster.parseRoster(variant, { month, rules: rules.defaultShiftRules });
      const persons = [sample.person, undefined, ...first.people.slice(0, 2)].filter((item, index, list) => list.indexOf(item) === index);
      for (const person of persons) parses.push({ input: { text: variant, month, person: person ?? null }, expected: roster.parseRoster(variant, { month, rules: rules.defaultShiftRules, person }) });
    }
  }
  write('rosterParse', parses);
  write('rosterMonth', [...rosterSamples.map((sample) => sample.text), '2026年10月分のシフト', '10月度 勤務表', 'R8.10 シフト', '令和8年11月', '12月のシフト', '1/5 早番', '2027-01-03 休み', '13月', 'シフト'].flatMap((input) => ['2026-10', '2026-12', '2027-01'].map((today) => ({ input: { text: input, today }, expected: roster.detectRosterMonth(input, today) }))));
  write('rosterLegend', ['A=9:00-18:00', '早番 7:00〜16:00、遅番 13:00〜22:00', '凡例: N 夜勤 22:00-翌7:00 / D 9-18', '休憩 12:00-13:00', '10/1 A=9:00-18:00', 'X:8:30-17:30 Y=10時-19時'].map((input) => ({ input, expected: roster.legendRules(input) })));
  const legendSet = roster.legendRules('A=8:00-17:00 早 6:00-15:00 新=10:00-19:00');
  const custom = rules.customRule('', rules.defaultShiftRules);
  write('shiftRules', {
    merged: rules.mergeRules(rules.defaultShiftRules, legendSet), custom, customNamed: rules.customRule('とても長い名前の勤務の規則をつくってみる', [...rules.defaultShiftRules, custom]),
    problems: [rules.defaultShiftRules[0], { ...rules.defaultShiftRules[0], label: ' ' }, { ...rules.defaultShiftRules[0], start: '7:00' }, { ...rules.defaultShiftRules[0], id: 'other' }, { ...custom, aliases: ['早'] }, { ...custom, aliases: ['ｅ'] }, { ...custom, label: 'x'.repeat(21) }].map((rule) => rules.ruleProblem(rule, rules.defaultShiftRules)),
    aliases: ['早、E/ｅ  夜,,夜', '', ' a ／ b '].map((input) => rules.parseAliases(input)),
    ranges: rules.defaultShiftRules.map(rules.ruleRangeText),
  });
  const aoi = fixture('member-aoi');
  const sampleRows = roster.parseRoster(rosterSamples[0].text, { month: rosterSamples[0].month, rules: rules.defaultShiftRules }).rows;
  const withDuplicate = [...aoi.events, event('dup', '2026-10-01T07:00:00+09:00', '2026-10-01T16:00:00+09:00', { title: '早番', participantMembershipIds: ['member-aoi'] })];
  write('shiftProposals', ['member-aoi', 'member-ren'].map((memberId) => {
    const rows = proposal.toProposals([...sampleRows, { date: '2026-10-09', symbol: 'Z', kind: 'unknown', title: 'Z', endsNextDay: false }], withDuplicate, memberId);
    return { input: memberId, expected: rows.map((row) => ({ id: row.id, duplicate: row.duplicate, included: proposal.includedByDefault(row), time: proposal.proposalTimeText(row), input: row.kind === 'unknown' ? null : proposal.shiftEventInput(row, { memberId, workLabelId: 'label-work', offLabelId: '', audience: 'household', selectedIds: [] }) })) };
  }));
}
