import { describe, expect, it } from 'vitest';
import { restoreDaysLeft } from './restoreWindow';

describe('restoreDaysLeft', () => {
  it('削除の直後は7日', () => {
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-02T12:00:00+09:00')).toBe(7);
  });
  it('読み込んだ時刻が削除より前でも7日を超えない', () => {
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-02T11:00:00+09:00')).toBe(7);
  });
  it('途中の日も1日と数える', () => {
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-03T12:00:01+09:00')).toBe(6);
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-03T11:59:59+09:00')).toBe(7);
  });
  it('期限の間際でも0日にはしない', () => {
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-09T11:59:59+09:00')).toBe(1);
    expect(restoreDaysLeft('2026-10-02T12:00:00+09:00', '2026-10-09T13:00:00+09:00')).toBe(1);
  });
});
