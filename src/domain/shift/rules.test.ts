import { describe, expect, it } from 'vitest';
import { SHIFT_RULES_KEY, customRule, defaultShiftRules, findRule, isOvernight, loadShiftRules, mergeRules, parseAliases, resetShiftRules, ruleProblem, ruleRangeText, saveShiftRules } from './rules';

const memory = (seed?: string) => {
  const values = new Map<string, string>(seed === undefined ? [] : [[SHIFT_RULES_KEY, seed]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
};

describe('shift rules', () => {
  it('matches a symbol whatever its width or case', () => {
    expect(findRule(defaultShiftRules, 'ａ')?.id).toBe('code-a');
    expect(findRule(defaultShiftRules, '公休')?.off).toBe(true);
    expect(findRule(defaultShiftRules, '研修')).toBeUndefined();
  });

  it('treats an end at or before the start as the next day', () => {
    expect(isOvernight({ start: '22:00', end: '07:00', endsNextDay: false })).toBe(true);
    expect(isOvernight({ start: '09:00', end: '09:00', endsNextDay: false })).toBe(true);
    expect(isOvernight({ start: '08:30', end: '09:00', endsNextDay: true })).toBe(true);
    expect(isOvernight({ start: '09:00', end: '18:00', endsNextDay: false })).toBe(false);
    expect(ruleRangeText(defaultShiftRules.find((rule) => rule.id === 'night')!)).toBe('22:00〜翌07:00');
  });

  it('names a new rule from the symbol, with an id no other rule has', () => {
    const first = customRule('研修', defaultShiftRules);
    expect(first).toMatchObject({ label: '研修', off: false });
    expect(customRule('', [...defaultShiftRules, first]).id).not.toBe(first.id);
  });

  it('splits aliases on the usual separators', () => expect(parseAliases('早、E, 早出 /X')).toEqual(['早', 'E', '早出', 'X']));

  it('refuses a rule without a name or with a symbol another rule uses', () => {
    const [first, second] = defaultShiftRules;
    expect(ruleProblem({ ...first, label: ' ' }, defaultShiftRules)).toContain('名前');
    expect(ruleProblem({ ...first, aliases: ['遅'] }, defaultShiftRules)).toContain('遅');
    expect(ruleProblem(second, defaultShiftRules)).toBeNull();
  });

  it('lets a new rule take over a symbol without losing the old rule', () => {
    const merged = mergeRules(defaultShiftRules, [{ id: 'legend-A', label: 'A', aliases: [], start: '08:00', end: '17:00', endsNextDay: false, off: false }]);
    expect(findRule(merged, 'A')?.start).toBe('08:00');
    expect(findRule(merged, 'A勤務')?.start).toBe('09:00');
    expect(merged.filter((rule) => rule.label === 'A')).toHaveLength(1);
  });

  it('keeps rules on the device and survives damaged storage', () => {
    const storage = memory();
    expect(loadShiftRules(storage)).toEqual(defaultShiftRules);
    const edited = defaultShiftRules.map((rule) => ({ ...rule, start: '06:00' }));
    expect(saveShiftRules(storage, edited)).toBe(true);
    expect(loadShiftRules(storage)[0].start).toBe('06:00');
    expect(resetShiftRules(storage)).toEqual(defaultShiftRules);
    expect(storage.values.size).toBe(0);
    expect(loadShiftRules(memory('not json'))).toEqual(defaultShiftRules);
    expect(loadShiftRules(memory('[{"id":"x"}]'))).toEqual(defaultShiftRules);
    expect(saveShiftRules({ ...storage, setItem: () => { throw new Error('full'); } }, edited)).toBe(false);
  });
});
