import { describe, expect, it } from 'vitest';
import { HEIC_MESSAGE, albumFileProblem, albumFileType, moveStaged, nextToSend, summarizeUploads, uploadPercent } from './albumUpload';
import type { UploadState } from './albumUpload';

const file = (name: string, type: string, size = 100) => ({ name, type, size });
const entry = (key: string, state: UploadState, albumId = 'a') => ({ key, state, albumId });

describe('albumFileProblem', () => {
  it('accepts the four formats', () => {
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.mp4', 'video/mp4'], ['a.mov', 'video/quicktime']]) expect(albumFileProblem(file(name, type))).toBeNull();
  });
  it('falls back to the extension when the browser gives no type', () => {
    expect(albumFileType(file('a.MOV', ''))).toBe('video/quicktime');
    expect(albumFileProblem(file('a.jpeg', ''))).toBeNull();
  });
  it('explains HEIC, by type or by name', () => {
    expect(albumFileProblem(file('a.heic', 'image/heic'))).toBe(HEIC_MESSAGE);
    expect(albumFileProblem(file('a.HEIC', ''))).toBe(HEIC_MESSAGE);
  });
  it('refuses other formats, empty files and oversized files', () => {
    expect(albumFileProblem(file('a.gif', 'image/gif'))).toContain('JPEG');
    expect(albumFileProblem(file('a.jpg', 'image/jpeg', 0))).toContain('中身');
    expect(albumFileProblem(file('a.jpg', 'image/jpeg', 101 * 1024 * 1024))).toBe('写真は100MBまでです。');
    expect(albumFileProblem(file('a.mp4', 'video/mp4', 5 * 1024 ** 3))).toBe('動画は4GBまでです。');
    expect(albumFileProblem(file('a.mp4', 'video/mp4', 3 * 1024 ** 3))).toBeNull();
  });
});

describe('moveStaged', () => {
  const entries = [entry('sent', 'done'), entry('a', 'staged'), entry('other', 'staged', 'b'), entry('b', 'staged')];
  const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);
  it('swaps staged files of the same album, skipping everything else', () => {
    expect(keys(moveStaged(entries, 'a', 1))).toEqual(['sent', 'b', 'other', 'a']);
    expect(keys(moveStaged(entries, 'b', -1))).toEqual(['sent', 'b', 'other', 'a']);
  });
  it('leaves the order alone at the ends and for files already sent', () => {
    expect(keys(moveStaged(entries, 'a', -1))).toEqual(keys(entries));
    expect(keys(moveStaged(entries, 'sent', 1))).toEqual(keys(entries));
  });
});

describe('nextToSend', () => {
  it('never exceeds three at once, counting files still being processed', () => {
    const waiting = [entry('1', 'waiting'), entry('2', 'waiting'), entry('3', 'waiting'), entry('4', 'waiting')];
    expect(nextToSend(waiting).map((item) => item.key)).toEqual(['1', '2', '3']);
    expect(nextToSend([entry('p', 'processing'), entry('s', 'sending'), ...waiting]).map((item) => item.key)).toEqual(['1']);
    expect(nextToSend([entry('p', 'processing'), entry('s', 'sending'), entry('t', 'sending'), ...waiting])).toEqual([]);
  });
});

describe('summarizeUploads', () => {
  it('counts a duplicate as finished, not failed, and leaves staged files out of the total', () => {
    expect(summarizeUploads([entry('1', 'staged'), entry('2', 'done'), entry('3', 'duplicate'), entry('4', 'failed'), entry('5', 'rejected'), entry('6', 'sending')])).toEqual({ staged: 1, finished: 2, duplicates: 1, failed: 2, active: 1, total: 5 });
  });
});

describe('uploadPercent', () => {
  it('stays between 0 and 100', () => {
    expect(uploadPercent(50, 200)).toBe(25);
    expect(uploadPercent(300, 200)).toBe(100);
    expect(uploadPercent(0, 0)).toBe(0);
  });
});
