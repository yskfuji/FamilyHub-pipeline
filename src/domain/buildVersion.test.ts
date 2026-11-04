import { describe, expect, it } from 'vitest';
import { isNewerBuild } from './buildVersion';

describe('isNewerBuild', () => {
  it('印が違うときだけ知らせる', () => {
    expect(isNewerBuild('aaa', 'bbb')).toBe(true);
    expect(isNewerBuild('aaa', 'aaa')).toBe(false);
  });
  it('どちらかの印が分からなければ知らせない', () => {
    expect(isNewerBuild('aaa', 'development')).toBe(false);
    expect(isNewerBuild('development', 'bbb')).toBe(false);
    expect(isNewerBuild('', 'bbb')).toBe(false);
    expect(isNewerBuild('aaa', null)).toBe(false);
    expect(isNewerBuild(undefined, 'bbb')).toBe(false);
  });
});
