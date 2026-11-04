import { describe, expect, it } from 'vitest';
import { holidaysBetween, holidaysOfYear } from './holidays';

const dates = (year: number) => holidaysOfYear(year).map((item) => `${item.date.slice(5)} ${item.name}`);

describe('Japanese national holidays', () => {
  it('matches the published calendar for 2026, including the substitute and citizens holidays', () => {
    expect(dates(2026)).toEqual([
      '01-01 元日', '01-12 成人の日', '02-11 建国記念の日', '02-23 天皇誕生日', '03-20 春分の日', '04-29 昭和の日',
      '05-03 憲法記念日', '05-04 みどりの日', '05-05 こどもの日', '05-06 振替休日', '07-20 海の日', '08-11 山の日',
      '09-21 敬老の日', '09-22 国民の休日', '09-23 秋分の日', '10-12 スポーツの日', '11-03 文化の日', '11-23 勤労感謝の日',
    ]);
  });

  it('handles the moved holidays of 2020 and 2021 and the 2019 accession', () => {
    expect(dates(2020)).toContain('07-24 スポーツの日');
    expect(dates(2021)).toEqual(expect.arrayContaining(['07-22 海の日', '08-08 山の日', '08-09 振替休日']));
    expect(dates(2019)).toEqual(expect.arrayContaining(['04-30 国民の休日', '05-01 天皇の即位の日', '05-02 国民の休日', '10-22 即位礼正殿の儀の行われる日']));
    expect(dates(2019).some((item) => item.endsWith('天皇誕生日'))).toBe(false);
  });

  it('does not guess outside the supported range', () => {
    expect(holidaysOfYear(1999)).toEqual([]);
    expect(holidaysOfYear(2100)).toEqual([]);
  });

  it('crosses a year boundary', () => {
    expect(holidaysBetween('2026-12-20', '2027-01-15').map((item) => item.name)).toEqual(['元日', '成人の日']);
  });
});
