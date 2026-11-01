import { findRule, mergeRules, normalizeSymbol } from './rules';
import type { ShiftTimeRule } from './rules';
import { cellsOf, findClockRange, isoDate, normalizeRosterText, personKey, samePerson, weekdayNames, weekdayOf } from './text';
import type { Cells } from './text';

export interface RosterRow {
  date: string;
  /** 表に書かれていた記号。 */
  symbol: string;
  kind: 'work' | 'off' | 'unknown';
  title: string;
  startTime?: string;
  endTime?: string;
  endsNextDay: boolean;
  warning?: string;
}

export interface RosterOptions {
  /** 基準の月（YYYY-MM）。日だけの日付はこの月として読む。 */
  month: string;
  rules: readonly ShiftTimeRule[];
  /** 読み取る人。表に1人しかいなければ省ける。 */
  person?: string;
}

export interface RosterResult {
  rows: RosterRow[];
  /** 表に見つかった人。読み取る人を選ぶのに使う。 */
  people: string[];
  /** 表の凡例から読んだ規則。 */
  legend: ShiftTimeRule[];
  /** 読めなかった行の説明。 */
  skipped: string[];
  layout: 'table' | 'columns' | 'lines' | 'none';
}

const MAX_TEXT_LENGTH = 40_000;
const MAX_ROWS = 200;
const BLANK_CELL = /^[-・._/ー\s]*$/;
const NOT_A_PERSON = /^(合計|計|小計|人数|備考|出勤|出勤者数|勤務|シフト|区分|No|NO|番号|社員番号|氏名|名前|スタッフ|担当)$/;
const NOT_A_SYMBOL = /^(休憩|勤務時間|時間|営業時間|受付|集合|提出|締切|期限|凡例|記号|例|備考|※)$/;
const NAME_LABELS = /^(氏名|名前|スタッフ|担当|従業員|社員|メンバー|No\.?|番号|社員番号)$/i;
const DATE_LABELS = /^(日付|日|月日|日にち|年月日|DATE)$/i;
const WEEKDAY_LABELS = /^(曜日?)$/;
const COLUMN_LABELS = /^(シフト|勤務|区分|予定|勤務区分)$/;

interface Resolved { symbol: string; kind: RosterRow['kind']; title: string; startTime?: string; endTime?: string; endsNextDay: boolean }

const clean = (text: string) => text.replace(/^[\s:は、,。.「『(]+|[\s、,。.!」』)]+$/g, '').replace(/(です|でした|でお願いします|勤務|シフト|となります|になります)$/, '');

function resolveOne(raw: string, rules: readonly ShiftTimeRule[]): Resolved {
  const range = findClockRange(raw);
  if (range) {
    const label = clean(raw.replace(range.text, ''));
    const rule = label ? findRule(rules, label) : undefined;
    return { symbol: label || `${range.start}-${range.end}`, kind: 'work', title: rule?.label ?? (label || '勤務'), startTime: range.start, endTime: range.end, endsNextDay: range.endsNextDay };
  }
  const symbol = clean(raw);
  const rule = findRule(rules, raw.trim()) ?? findRule(rules, symbol);
  if (!rule) return { symbol: raw.trim(), kind: 'unknown', title: raw.trim(), endsNextDay: false };
  if (rule.off) return { symbol, kind: 'off', title: rule.label, endsNextDay: false };
  return { symbol, kind: 'work', title: rule.label, startTime: rule.start, endTime: rule.end, endsNextDay: rule.endsNextDay || rule.end <= rule.start };
}

/** 1つの欄を読む。空なら何も返さない。「早/遅」のように2つ書かれた欄は、両方が読めるときだけ分ける。 */
function resolveCell(raw: string, rules: readonly ShiftTimeRule[]): Resolved[] {
  if (BLANK_CELL.test(raw)) return [];
  if (!findClockRange(raw)) {
    const parts = raw.split(/[/&+・]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((part) => findRule(rules, part))) return parts.map((part) => resolveOne(part, rules));
  }
  return [resolveOne(raw, rules)];
}

interface Day { day: number; month?: number; weekday?: string }

function dayOf(cell: string): Day | null {
  const bare = /^(\d{1,2})日?(?:\(?([日月火水木金土])\)?)?$/.exec(cell);
  if (bare) return Number(bare[1]) >= 1 && Number(bare[1]) <= 31 ? { day: Number(bare[1]), weekday: bare[2] } : null;
  const dated = /^(\d{1,2})[/月](\d{1,2})日?(?:\(?([日月火水木金土])\)?)?$/.exec(cell);
  return dated && Number(dated[1]) <= 12 && Number(dated[2]) <= 31 ? { month: Number(dated[1]), day: Number(dated[2]), weekday: dated[3] } : null;
}

const parseMonth = (month: string) => ({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) });
const addMonths = (base: { year: number; month: number }, count: number) => {
  const index = base.year * 12 + base.month - 1 + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
const monthGap = (a: { year: number; month: number }, b: { year: number; month: number }) => (a.year - b.year) * 12 + a.month - b.month;

/** 月まで書かれた日付の年を決める。基準の月から前後1か月の外は読まない。 */
function dateWithMonth(base: { year: number; month: number }, month: number, day: number, year?: number): string | null {
  const candidates = year ? [year] : [base.year - 1, base.year, base.year + 1];
  const nearest = candidates.map((value) => ({ year: value, month })).sort((a, b) => Math.abs(monthGap(a, base)) - Math.abs(monthGap(b, base)))[0];
  return Math.abs(monthGap(nearest, base)) > 1 ? null : isoDate(nearest.year, nearest.month, day);
}

/** 日だけが並ぶ列を、月をまたぐ並び（21…31, 1…20）も含めて日付にする。 */
function datesOfDays(days: readonly Day[], base: { year: number; month: number }): Array<string | null> {
  let current = base;
  let previous = 0;
  return days.map((item) => {
    if (item.month) { current = { ...current, month: item.month }; previous = item.day; return dateWithMonth(base, item.month, item.day); }
    if (item.day < previous) current = addMonths(current, 1);
    previous = item.day;
    return isoDate(current.year, current.month, item.day);
  });
}

const consecutive = (days: readonly Day[]) => days.every((item, index) => index === 0 || item.day === days[index - 1].day + 1 || (days[index - 1].day >= 28 && item.day === 1));

interface Located {
  layout: 'table' | 'columns';
  headerIndex: number;
  labels: string[];
  days: Day[];
  /** 日の列の右にある、合計などの列の数。 */
  extras: number;
  weekdayIndex: number | null;
  rows: number[];
  exact: boolean;
}

const legendLike = (line: string, cells: string[]) => {
  if (/^(凡例|※|記号|時間)/.test(line) || line.includes('=')) return true;
  const times = cells.filter((cell) => findClockRange(cell)).length;
  return times > 0 && cells.length === times * 2;
};

function isWeekdayRow(cells: string[]) {
  const named = cells.filter((cell) => cell);
  const marks = named.filter((cell) => cell.length <= 3 && weekdayNames.includes(cell.replace(/[()曜]/g, '').slice(0, 1)) && /^\(?[日月火水木金土]曜?\)?$/.test(cell));
  return marks.length >= 5 && marks.length >= named.length - 2;
}

/** 日が横に並ぶ表を探す。 */
function locateTable(lines: readonly string[], split: readonly Cells[]): Located | null {
  for (let index = 0; index < lines.length; index += 1) {
    const { cells, exact } = split[index];
    const start = cells.findIndex((cell) => dayOf(cell));
    if (start < 0 || start > 2) continue;
    const labels = cells.slice(0, start);
    if (labels.some((cell) => cell && !NAME_LABELS.test(cell))) continue;
    const days: Day[] = [];
    let position = start;
    for (; position < cells.length; position += 1) { const day = dayOf(cells[position]); if (!day) break; days.push(day); }
    if (days.length < 5 || !consecutive(days)) continue;
    const before = index > 0 ? split[index - 1].cells : [];
    const after = split[index + 1]?.cells ?? [];
    const weekdayIndex = isWeekdayRow(after) ? index + 1 : isWeekdayRow(before) ? index - 1 : null;
    const rows: number[] = [];
    for (let row = (weekdayIndex === index + 1 ? index + 2 : index + 1); row < lines.length; row += 1) {
      const line = split[row];
      if (!line.cells.length || !lines[row].trim()) { if (rows.length) break; continue; }
      if (line.cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      if (!line.exact && legendLike(lines[row], line.cells)) { if (rows.length) break; continue; }
      if (line.cells.length >= 2) rows.push(row);
    }
    return { layout: 'table', headerIndex: index, labels, days, extras: cells.length - position, weekdayIndex, rows, exact };
  }
  return null;
}

/** 日付が縦に、人が横に並ぶ表を探す。 */
function locateColumns(split: readonly Cells[]): Located | null {
  for (let index = 0; index < split.length; index += 1) {
    const { cells, exact } = split[index];
    if (cells.length < 2 || !DATE_LABELS.test(cells[0])) continue;
    const rows: number[] = [];
    for (let row = index + 1; row < split.length; row += 1) {
      const first = split[row].cells[0] ?? '';
      if (/^(\d{4}[-/年])?\d{1,2}([-/月]\d{1,2}日?)?日?(\(?[日月火水木金土]\)?)?$/.test(first)) rows.push(row);
    }
    if (rows.length) return { layout: 'columns', headerIndex: index, labels: cells, days: [], extras: 0, weekdayIndex: null, rows, exact };
  }
  return null;
}

const LEGEND = /([^\s=:,、/;()\d][^\s=:,、/;()]{0,7})(?:[\s=:]+([^\s=:,、/;()\d][^\s=:,、/;()]{0,7}))?[\s=:(]*(\d{1,2}(?::\d{2})?\s*(?:~|-|から)\s*翌?日?\s*\d{1,2}(?::\d{2})?)/g;

/** 「A=9:00-18:00」「早番 7:00〜16:00」のような凡例の行を規則として読む。 */
export function legendRules(text: string): ShiftTimeRule[] {
  return legendOfLines(normalizeRosterText(text.slice(0, MAX_TEXT_LENGTH)).split('\n'));
}

function legendOfLines(lines: readonly string[]): ShiftTimeRule[] {
  const found = new Map<string, ShiftTimeRule>();
  for (const line of lines) {
    if (dateTokens(line).length) continue;
    for (const match of line.matchAll(LEGEND)) {
      const names = [match[1], match[2]].filter((name): name is string => Boolean(name) && !NOT_A_SYMBOL.test(name));
      const range = findClockRange(match[3]);
      if (!names.length || !range) continue;
      const label = [...names].sort((a, b) => b.length - a.length)[0];
      const key = normalizeSymbol(names[0]);
      if (!found.has(key)) found.set(key, { id: `legend-${key}`, label, aliases: names.filter((name) => name !== label), start: range.start, end: range.end, endsNextDay: range.endsNextDay, off: false });
    }
  }
  return [...found.values()];
}

interface DateToken { index: number; length: number; year?: number; month: number; day: number; weekday?: string }

const DATE_TOKEN = /(?:(\d{4})\s*[年/.-]\s*)?(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?(?:\s*\(\s*([日月火水木金土])\s*(?:曜日?)?\s*\)|\s*([日月火水木金土])曜日?)?|(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*\(\s*([日月火水木金土])\s*\))?/g;

function dateTokens(line: string): DateToken[] {
  return [...line.matchAll(DATE_TOKEN)].flatMap((match) => {
    const [, year, month, day, weekday, plainWeekday, isoYear, isoMonth, isoDay, isoWeekday] = match;
    const values = { year: Number(year ?? isoYear) || undefined, month: Number(month ?? isoMonth), day: Number(day ?? isoDay), weekday: weekday ?? plainWeekday ?? isoWeekday };
    return values.month >= 1 && values.month <= 12 && values.day >= 1 && values.day <= 31 ? [{ index: match.index, length: match[0].length, ...values }] : [];
  });
}

const BARE_DAY = /^\s*(\d{1,2})\s*日?(?:\s*\(?\s*([日月火水木金土])\s*(?:曜日?)?\s*\)?)?(?![\d:/月年])[\s.:、\t-]*(.*)$/;
const SECTION = /^(?:[【[■●◆<]\s*([^\s】\]>:]{1,16})\s*(?:さん|様)?\s*[】\]>:]?|([^\s【[■●◆<\d:]{1,16}?)(?:さん|様)(?:の(?:シフト|勤務|予定))?\s*:?|([^\s【[■●◆<\d:]{1,16})\s*:)$/;

function sectionName(line: string): string | null {
  const match = SECTION.exec(line.trim());
  const name = match?.[1] ?? match?.[2] ?? match?.[3];
  return name && !NOT_A_PERSON.test(name) && !NOT_A_SYMBOL.test(name) && !/(シフト|勤務表|予定表|月度|月分|お知らせ|ご連絡)/.test(name) ? name : null;
}

const firstSymbol = (rest: string, rules: readonly ShiftTimeRule[]): string | null => {
  const text = clean(rest);
  if (!text) return null;
  const range = findClockRange(text);
  if (range) {
    const before = text.slice(0, text.indexOf(range.text)).trim().split(/[\s、,]+/).pop() ?? '';
    return `${before} ${range.text}`.trim();
  }
  const tokens = text.split(/[\s、,。]+/).filter(Boolean);
  const known = tokens.find((token) => findRule(rules, token) || findRule(rules, clean(token)));
  if (known) return known;
  const long = rules.flatMap((rule) => [rule.label, ...rule.aliases]).filter((symbol) => symbol.length >= 2).sort((a, b) => b.length - a.length).find((symbol) => text.toUpperCase().includes(normalizeSymbol(symbol)));
  if (long) return long;
  return tokens[0] && tokens[0].length <= 8 ? tokens[0] : null;
};

interface Entry { person: string; date: string; cell: string; weekday?: string }

function readLines(lines: readonly string[], base: { year: number; month: number }, rules: readonly ShiftTimeRule[], skipped: string[]) {
  const entries: Entry[] = [];
  let section = '';
  let current = base;
  let previous = 0;
  const add = (person: string, date: string | null, cell: string | null, weekday: string | undefined, source: string) => {
    if (!cell) return;
    if (!date) { skipped.push(`「${source}」は日付を読めないか、選んだ月から離れています。`); return; }
    entries.push({ person, date, cell, weekday });
  };
  const readRest = (date: string | null, rest: string, weekday: string | undefined, source: string, owner: string) => {
    const pairs = findClockRange(rest) ? [] : [...rest.matchAll(/([^\s:,、\d][^\s:,、\d]*)\s*:\s*([^\s,、]+)/g)];
    if (pairs.length && pairs.every((pair) => !findRule(rules, pair[1]))) {
      for (const pair of pairs) add(pair[1].replace(/(さん|様)$/, ''), date, pair[2], weekday, source);
      return;
    }
    add(owner, date, firstSymbol(rest, rules), weekday, source);
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const tokens = dateTokens(line);
    if (tokens.length) {
      const prefix = line.slice(0, tokens[0].index).trim().replace(/[:、]$/, '');
      const owner = /^[^\d\s:]{2,10}$/.test(prefix) && !NOT_A_PERSON.test(prefix) && !NOT_A_SYMBOL.test(prefix) && !findRule(rules, prefix) && !/(期限|締切|提出|日時|まで|から)/.test(prefix) ? prefix.replace(/(さん|様)$/, '') : section;
      tokens.forEach((token, index) => {
        const rest = line.slice(token.index + token.length, tokens[index + 1]?.index ?? line.length);
        const date = dateWithMonth(base, token.month, token.day, token.year);
        const source = line.slice(token.index, token.index + token.length).trim();
        readRest(date, rest, token.weekday, source, owner);
      });
      continue;
    }
    const bare = BARE_DAY.exec(line);
    if (bare && !findClockRange(line.slice(0, line.indexOf(bare[3]) || undefined))) {
      const day = Number(bare[1]);
      if (day >= 1 && day <= 31 && bare[3].trim()) {
        if (day < previous) current = addMonths(current, 1);
        previous = day;
        readRest(isoDate(current.year, current.month, day), bare[3], bare[2], `${day}日`, section);
        continue;
      }
    }
    const name = sectionName(line);
    if (name) section = name;
  }
  return entries;
}

function readTable(table: Located, split: readonly Cells[], base: { year: number; month: number }, skipped: string[]) {
  const dates = datesOfDays(table.days, base);
  const count = table.days.length;
  const entries: Entry[] = [];
  const weekdays = table.weekdayIndex === null ? [] : split[table.weekdayIndex].cells.filter((cell) => /[日月火水木金土]/.test(cell) && !NAME_LABELS.test(cell)).slice(-count);
  table.days.forEach((item, index) => { if (dates[index] === null) skipped.push(`${item.month ? `${item.month}/` : ''}${item.day}は日付を読めないか、選んだ月から離れています。`); });
  for (const rowIndex of table.rows) {
    const { cells, exact } = split[rowIndex];
    const longEnough = cells.length >= count + table.extras;
    const offset = exact ? (table.labels.length || (cells.length === count + table.extras + 1 ? 1 : 0)) : longEnough ? cells.length - count - table.extras : table.labels.length;
    const name = cells.slice(0, offset).filter((cell) => cell && !/^\d+$/.test(cell)).join(' ');
    if (NOT_A_PERSON.test(personKey(name))) continue;
    for (let column = 0; column < count; column += 1) {
      const date = dates[column];
      const cell = cells[offset + column];
      if (date && cell) entries.push({ person: name, date, cell, weekday: table.days[column].weekday ?? weekdays[column]?.replace(/[()曜]/g, '') });
    }
  }
  return entries;
}

function readColumns(table: Located, split: readonly Cells[], base: { year: number; month: number }, skipped: string[]) {
  const headers = table.labels;
  const weekdayColumn = headers.findIndex((cell) => WEEKDAY_LABELS.test(cell));
  const people = headers.flatMap((cell, index) => (index === 0 || index === weekdayColumn || !cell ? [] : [{ index, name: COLUMN_LABELS.test(cell) ? '' : cell }]));
  const bare: Day[] = table.rows.map((row) => dayOf(split[row].cells[0]) ?? { day: 0 });
  const seq = datesOfDays(bare.map((item) => (item.day ? item : { day: 1 })), base);
  const entries: Entry[] = [];
  table.rows.forEach((row, rowOrder) => {
    const { cells, exact } = split[row];
    const token = dateTokens(cells[0])[0];
    const day = dayOf(cells[0]);
    const date = token ? dateWithMonth(base, token.month, token.day, token.year) : day ? seq[rowOrder] : null;
    if (!date) { skipped.push(`「${cells[0]}」は日付を読めないか、選んだ月から離れています。`); return; }
    const shift = !exact && weekdayColumn < 0 && day?.weekday === undefined && /^[日月火水木金土]$/.test(cells[1] ?? '') ? 1 : 0;
    const weekday = token?.weekday ?? day?.weekday ?? (weekdayColumn >= 0 ? cells[weekdayColumn]?.replace(/[()曜]/g, '') : shift ? cells[1] : undefined);
    for (const person of people) { const cell = cells[person.index + shift]; if (cell) entries.push({ person: person.name, date, cell, weekday }); }
  });
  return entries;
}

/** 貼り付けた勤務表を読む。何も保存せず、同じ入力には同じ結果を返す。 */
export function parseRoster(text: string, options: RosterOptions): RosterResult {
  const lines = normalizeRosterText(text.slice(0, MAX_TEXT_LENGTH)).split('\n');
  const split = lines.map(cellsOf);
  const base = parseMonth(options.month);
  const skipped: string[] = [];
  const table = locateTable(lines, split) ?? locateColumns(split);
  const used = new Set(table ? [table.headerIndex, ...(table.weekdayIndex === null ? [] : [table.weekdayIndex]), ...table.rows] : []);
  const legend = legendOfLines(lines.filter((_line, index) => !used.has(index)));
  const rules = mergeRules(options.rules, legend);
  const entries = table?.layout === 'table' ? readTable(table, split, base, skipped)
    : table?.layout === 'columns' ? readColumns(table, split, base, skipped)
      : readLines(lines, base, rules, skipped);
  const people = [...new Map(entries.filter((entry) => entry.person).map((entry) => [personKey(entry.person), entry.person])).values()];
  const wanted = options.person?.trim() || (people.length === 1 ? people[0] : '');
  const named = people.length > 0;
  const matching = named && !wanted ? [] : entries.filter((entry) => !named || !entry.person || samePerson(entry.person, wanted));
  const seen = new Set<string>();
  const rows = matching.flatMap((entry) => resolveCell(entry.cell, rules).map((resolved): RosterRow => {
    const mismatch = entry.weekday && weekdayOf(entry.date) !== entry.weekday;
    return { date: entry.date, ...resolved, ...(mismatch ? { warning: `曜日が日付と合いません（表は${entry.weekday}曜）` } : {}) };
  })).filter((row) => {
    const key = `${row.date}|${row.title}|${row.startTime ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '')).slice(0, MAX_ROWS);
  return { rows, people, legend, skipped: [...new Set(skipped)], layout: table?.layout ?? (entries.length ? 'lines' : 'none') };
}

/** 表の見出しから対象の月を読む。読めなければ null。 */
export function detectRosterMonth(text: string, todayMonth: string): string | null {
  const normalized = normalizeRosterText(text.slice(0, MAX_TEXT_LENGTH));
  const full = /(\d{4})\s*[年/.-]\s*(\d{1,2})(?:\s*月)?(?![\d/-])/.exec(normalized);
  const pad = (month: number) => String(month).padStart(2, '0');
  if (full && Number(full[2]) >= 1 && Number(full[2]) <= 12) return `${full[1]}-${pad(Number(full[2]))}`;
  const named = /(\d{1,2})\s*月\s*(?:度|分|の?シフト|の?勤務)/.exec(normalized);
  const token = dateTokens(normalized)[0];
  const month = named ? Number(named[1]) : token?.month;
  if (!month || month > 12) return null;
  if (token?.year && !named) return `${token.year}-${pad(month)}`;
  const today = parseMonth(todayMonth);
  const nearest = [today.year - 1, today.year, today.year + 1].sort((a, b) => Math.abs(monthGap({ year: a, month }, today)) - Math.abs(monthGap({ year: b, month }, today)))[0];
  return `${nearest}-${pad(month)}`;
}
