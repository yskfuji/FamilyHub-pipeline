import { describe, expect, it } from 'vitest';
import { captureTimeFromExif, captureTimeFromMvhd, captureTimeFromQuickTime, MAC_EPOCH_OFFSET_SECONDS, zonedRfc3339 } from './captureTime';

const NOW = new Date('2026-09-30T07:45:00+09:00');

describe('capture time (A15)', () => {
  it('keeps the offset written with DateTimeOriginal', () => {
    expect(captureTimeFromExif('2026:09:20 09:12:30', '+09:00', 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T09:12:30+09:00', takenAtSource: 'exif-offset' });
    expect(captureTimeFromExif('2026:09:20 09:12:30', '-05:30', 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T09:12:30-05:30', takenAtSource: 'exif-offset' });
  });

  it('takes a time without an offset in the household time zone, also across a daylight-saving change', () => {
    expect(captureTimeFromExif('2026:09:20 09:12:30', undefined, 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T09:12:30+09:00', takenAtSource: 'exif-local' });
    expect(captureTimeFromExif('2026:07:01 12:00:00', undefined, 'America/New_York', NOW)).toEqual({ takenAt: '2026-07-01T12:00:00-04:00', takenAtSource: 'exif-local' });
    expect(captureTimeFromExif('2026:01:15 12:00:00', undefined, 'America/New_York', NOW)).toEqual({ takenAt: '2026-01-15T12:00:00-05:00', takenAtSource: 'exif-local' });
    // 書かれた時差が読めなければ、時差がないものとして扱う。
    expect(captureTimeFromExif('2026:09:20 09:12:30', '   ', 'Asia/Tokyo', NOW)).toMatchObject({ takenAtSource: 'exif-local' });
  });

  it('refuses dates that do not exist, blanks, before 1990 and more than a day ahead', () => {
    for (const value of ['2026:02:31 10:00:00', '2026:09:20 24:00:00', '    :  :     :  :  ', '0000:00:00 00:00:00', '1989:12:31 23:59:59', '2026:10:02 09:00:00', 'not a date']) {
      expect(captureTimeFromExif(value, '+09:00', 'Asia/Tokyo', NOW), value).toBeNull();
    }
    expect(captureTimeFromExif('2026:10:01 07:00:00', '+09:00', 'Asia/Tokyo', NOW)).toMatchObject({ takenAtSource: 'exif-offset' });
    expect(captureTimeFromExif('2026:09:20 09:12:30', '+15:00', 'Asia/Tokyo', NOW)).toMatchObject({ takenAtSource: 'exif-local' });
  });

  it('reads the Apple creation date with its offset in either form, and refuses one without an offset', () => {
    expect(captureTimeFromQuickTime('2026-09-20T10:15:30+0900', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
    expect(captureTimeFromQuickTime('2026-09-20T10:15:30.250+09:00', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
    expect(captureTimeFromQuickTime('2026-09-20T01:15:30Z', NOW)).toEqual({ takenAt: '2026-09-20T01:15:30+00:00', takenAtSource: 'quicktime-key' });
    expect(captureTimeFromQuickTime('2026-09-20T10:15:30', NOW)).toBeNull();
    expect(captureTimeFromQuickTime('1904-01-01T00:00:00Z', NOW)).toBeNull();
  });

  it('reads mvhd seconds since 1904 as UTC', () => {
    expect(MAC_EPOCH_OFFSET_SECONDS).toBe(Math.round(-Date.UTC(1904, 0, 1) / 1000));
    expect(captureTimeFromMvhd(3_872_707_198, 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T08:59:58+09:00', takenAtSource: 'mvhd' });
    expect(captureTimeFromMvhd(0, 'Asia/Tokyo', NOW)).toBeNull();
    expect(captureTimeFromMvhd(-5, 'Asia/Tokyo', NOW)).toBeNull();
  });

  it('writes an instant in a time zone with its offset', () => {
    expect(zonedRfc3339(Date.UTC(2026, 8, 19, 23, 59, 58, 900), 'Asia/Tokyo')).toBe('2026-09-20T08:59:58+09:00');
    expect(zonedRfc3339(Date.UTC(2026, 2, 8, 7, 0, 0), 'America/New_York')).toBe('2026-03-08T03:00:00-04:00');
  });
});
