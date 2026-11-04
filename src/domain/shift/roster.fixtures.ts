/** 読み取りの基準の表。名前と勤務はすべて架空。expected は「日付 題名 時刻」の形。 */
export interface RosterSample {
  name: string;
  text: string;
  month: string;
  person?: string;
  layout: 'table' | 'columns' | 'lines';
  expected: string[];
  people?: string[];
  legend?: string[];
  skipped?: number;
}

export const rosterSamples: readonly RosterSample[] = [
  {
    name: 'dates per line with M/D and shift names',
    month: '2026-10', layout: 'lines',
    text: '10/1 早番\n10/2 遅番\n10/3 休み\n10/4 夜勤',
    expected: ['2026-10-01 早番 07:00-16:00', '2026-10-02 遅番 13:00-22:00', '2026-10-03 休み 終日', '2026-10-04 夜勤 22:00-翌07:00'],
  },
  {
    name: 'full-width digits and separators',
    month: '2026-10', layout: 'lines',
    text: '１０／５　早番\n１０／６　遅\n１０／７　９：００～１８：００',
    expected: ['2026-10-05 早番 07:00-16:00', '2026-10-06 遅番 13:00-22:00', '2026-10-07 勤務 09:00-18:00'],
  },
  {
    name: 'Japanese month and day with weekdays, checked against the calendar',
    month: '2026-10', layout: 'lines',
    text: '10月1日（木） 9:00-18:00\n10月2日(金) 休\n10月3日(土)　13:00〜22:00\n10月4日（月） 日勤',
    expected: ['2026-10-01 勤務 09:00-18:00', '2026-10-02 休み 終日', '2026-10-03 勤務 13:00-22:00', '2026-10-04 日勤 09:00-18:00 !曜日'],
  },
  {
    name: 'bare day numbers crossing into the next month',
    month: '2026-10', layout: 'lines',
    text: '30 早\n31日 休み\n1 夜\n2(月) 公休',
    expected: ['2026-10-30 早番 07:00-16:00', '2026-10-31 休み 終日', '2026-11-01 夜勤 22:00-翌07:00', '2026-11-02 休み 終日'],
  },
  {
    name: 'tab-separated sheet with weekday row, empty cells and codes',
    month: '2026-10', person: '鈴木 実', layout: 'table',
    people: ['田中 花', '鈴木 実'],
    text: '2026年10月 シフト表\n氏名\t1\t2\t3\t4\t5\t6\n\t木\t金\t土\t日\t月\t火\n田中 花\tA\tB\t休\tC\tA\tA\n鈴木 実\tB\t\tA\t休\tC\tB\n合計\t2\t1\t1\t1\t2\t2',
    expected: ['2026-10-01 B勤務 13:00-22:00', '2026-10-03 A勤務 09:00-18:00', '2026-10-04 休み 終日', '2026-10-05 C勤務 22:00-翌07:00', '2026-10-06 B勤務 13:00-22:00'],
  },
  {
    name: 'space-separated table where the name has a space',
    month: '2026-11', person: '佐々木', layout: 'table',
    people: ['佐々木 葵', '森 太一'],
    text: '名前 1 2 3 4 5\n佐々木 葵 早 遅 休 夜 明\n森 太一 休 休 早 早 遅',
    expected: ['2026-11-01 早番 07:00-16:00', '2026-11-02 遅番 13:00-22:00', '2026-11-03 休み 終日', '2026-11-04 夜勤 22:00-翌07:00', '2026-11-05 休み 終日'],
  },
  {
    name: 'closing on the 20th: the header wraps from 31 to 1',
    month: '2026-10', layout: 'table',
    people: ['小川 凛'],
    text: 'スタッフ\t29\t30\t31\t1\t2\t3\n小川 凛\t早\t遅\t休\t早\t遅\t休',
    expected: ['2026-10-29 早番 07:00-16:00', '2026-10-30 遅番 13:00-22:00', '2026-10-31 休み 終日', '2026-11-01 早番 07:00-16:00', '2026-11-02 遅番 13:00-22:00', '2026-11-03 休み 終日'],
  },
  {
    name: 'markdown table copied from chat, one person without a name',
    month: '2026-12', layout: 'table',
    text: '| 1 | 2 | 3 | 4 | 5 |\n|---|---|---|---|---|\n| 早 | 遅 | 休 | - | 夜 |',
    expected: ['2026-12-01 早番 07:00-16:00', '2026-12-02 遅番 13:00-22:00', '2026-12-03 休み 終日', '2026-12-05 夜勤 22:00-翌07:00'],
  },
  {
    name: 'dates down, people across, with a weekday column',
    month: '2026-10', person: '石井', layout: 'columns',
    people: ['石井', '村上'],
    text: '日付\t曜日\t石井\t村上\n10/1\t木\t早番\t遅番\n10/2\t金\t休\t早番\n10/3\t土\t9:00-18:00\t休',
    expected: ['2026-10-01 早番 07:00-16:00', '2026-10-02 休み 終日', '2026-10-03 勤務 09:00-18:00'],
  },
  {
    name: 'chat message with several dates on a line',
    month: '2026-10', layout: 'lines',
    text: '来週の予定です！\n10/5(月)は早番、10/6(火)は休み、10/7(水)は遅番でお願いします。',
    expected: ['2026-10-05 早番 07:00-16:00', '2026-10-06 休み 終日', '2026-10-07 遅番 13:00-22:00'],
  },
  {
    name: 'email with a legend for this roster and lines that are not shifts',
    month: '2026-10', layout: 'lines',
    legend: ['X', 'Y'],
    text: '皆さま\n来月のシフトを送ります。\nX=8:30-17:30\nY=22:00-翌6:00\n勤務時間 8:30-17:30\n\n10/10 X\n10/11 Y\n10/12 休\n\n提出期限 10/25\n10/15までにご確認ください',
    expected: ['2026-10-10 X 08:30-17:30', '2026-10-11 Y 22:00-翌06:00', '2026-10-12 休み 終日'],
  },
  {
    name: 'time written past 24:00 and with 時',
    month: '2026-10', layout: 'lines',
    text: '10/1 22:00-31:00\n10/2 9時-18時\n10/3 9時半から17時',
    expected: ['2026-10-01 勤務 22:00-翌07:00', '2026-10-02 勤務 09:00-18:00', '2026-10-03 勤務 09:30-17:00'],
  },
  {
    name: 'a 24-hour shift keeps the next-day end',
    month: '2026-10', layout: 'lines',
    text: '10/8 当直 8:30-翌9:00',
    expected: ['2026-10-08 当直 08:30-翌09:00'],
  },
  {
    name: 'sections per person, reading only the chosen one',
    month: '2026-10', person: '大野', layout: 'lines',
    people: ['大野', '吉田'],
    text: '【大野】\n10/1 早番\n10/2 遅番\n\n【吉田】\n10/1 休\n10/2 早番',
    expected: ['2026-10-01 早番 07:00-16:00', '2026-10-02 遅番 13:00-22:00'],
  },
  {
    name: 'one line per date with name and shift pairs',
    month: '2026-10', person: '鈴木', layout: 'lines',
    people: ['佐藤', '鈴木'],
    text: '10/1 佐藤:早番 鈴木:遅番\n10/2 佐藤:休 鈴木:夜勤',
    expected: ['2026-10-01 遅番 13:00-22:00', '2026-10-02 夜勤 22:00-翌07:00'],
  },
  {
    name: 'a symbol nobody defined stays visible for review',
    month: '2026-10', layout: 'lines',
    text: '10/1 研修\n10/2 早番',
    expected: ['2026-10-01 研修 ?', '2026-10-02 早番 07:00-16:00'],
  },
  {
    name: 'an impossible date is reported, not guessed',
    month: '2026-02', layout: 'lines', skipped: 1,
    text: '2/30 早番\n2/27 遅番',
    expected: ['2026-02-27 遅番 13:00-22:00'],
  },
  {
    name: 'two shifts in one cell',
    month: '2026-10', layout: 'table',
    text: '1 2 3 4 5\n早/遅 休 早 早 早',
    expected: ['2026-10-01 早番 07:00-16:00', '2026-10-01 遅番 13:00-22:00', '2026-10-02 休み 終日', '2026-10-03 早番 07:00-16:00', '2026-10-04 早番 07:00-16:00', '2026-10-05 早番 07:00-16:00'],
  },
];
