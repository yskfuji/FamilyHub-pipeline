import { z } from 'zod';

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const shiftRuleSchema = z.strictObject({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(20),
  /** 表の中で使われる書き方。名前そのものは数えなくてよい。 */
  aliases: z.array(z.string().trim().min(1).max(12)).max(16),
  start: clockSchema,
  end: clockSchema,
  /** 終了が開始より後でも翌日に終わる勤務（例：8:30〜翌9:00）。 */
  endsNextDay: z.boolean(),
  /** 休みの記号。時刻を持たず、終日の予定になる。 */
  off: z.boolean(),
});
export type ShiftTimeRule = z.infer<typeof shiftRuleSchema>;

const rule = (id: string, label: string, aliases: string[], start: string, end: string, off = false): ShiftTimeRule => ({ id, label, aliases, start, end, endsNextDay: false, off });

export const defaultShiftRules: readonly ShiftTimeRule[] = [
  rule('early', '早番', ['早', 'E'], '07:00', '16:00'),
  rule('day', '日勤', ['日', 'D', '○'], '09:00', '18:00'),
  rule('late', '遅番', ['遅', 'L'], '13:00', '22:00'),
  rule('night', '夜勤', ['夜', 'N'], '22:00', '07:00'),
  rule('code-a', 'A勤務', ['A'], '09:00', '18:00'),
  rule('code-b', 'B勤務', ['B'], '13:00', '22:00'),
  rule('code-c', 'C勤務', ['C'], '22:00', '07:00'),
  rule('off', '休み', ['休', '公休', '希望休', '有休', '有給', '代休', '年休', '特休', '明', '明け', '×', 'OFF'], '00:00', '00:00', true),
];

/** 新しい規則。時刻は日勤の値から編集してもらう。 */
export function customRule(label: string, rules: readonly ShiftTimeRule[]): ShiftTimeRule {
  const taken = new Set(rules.map((item) => item.id));
  let number = rules.length + 1;
  while (taken.has(`custom-${number}`)) number += 1;
  return { id: `custom-${number}`, label: (label || `新しい規則${number}`).slice(0, 20), aliases: [], start: '09:00', end: '18:00', endsNextDay: false, off: false };
}

/** 比べるための形。全角と大文字小文字の違いをなくす。 */
export const normalizeSymbol = (text: string) => text.normalize('NFKC').trim().toUpperCase();

export const symbolsOf = (item: Pick<ShiftTimeRule, 'label' | 'aliases'>) => [item.label, ...item.aliases].map(normalizeSymbol);

export function findRule(rules: readonly ShiftTimeRule[], symbol: string): ShiftTimeRule | undefined {
  const wanted = normalizeSymbol(symbol);
  return rules.find((item) => symbolsOf(item).includes(wanted));
}

export const isOvernight = (item: Pick<ShiftTimeRule, 'start' | 'end' | 'endsNextDay'>) => item.endsNextDay || item.end <= item.start;

export const ruleRangeText = (item: ShiftTimeRule) => (item.off ? '休み' : `${item.start}〜${isOvernight(item) ? '翌' : ''}${item.end}`);

/** 読点・カンマ・スラッシュ・空白で区切られた別名を分ける。 */
export const parseAliases = (text: string) => [...new Set(text.split(/[,、/／\s]+/).map((item) => item.trim()).filter(Boolean))];

/** 入力の確認。問題があれば文言を返す。 */
export function ruleProblem(item: ShiftTimeRule, rules: readonly ShiftTimeRule[]): string | null {
  if (!item.label.trim()) return '規則の名前を入力してください。';
  if (!shiftRuleSchema.safeParse(item).success) return '名前、別名、時刻を確認してください。';
  const clash = symbolsOf(item).find((symbol) => rules.some((other) => other.id !== item.id && symbolsOf(other).includes(symbol)));
  return clash ? `「${clash}」はほかの規則で使われています。` : null;
}

/** 追加する規則を優先して合わせる。同じ記号を持つ規則は、その記号だけを外し、残らなければ消す。 */
export function mergeRules(rules: readonly ShiftTimeRule[], additions: readonly ShiftTimeRule[]): ShiftTimeRule[] {
  const taken = new Set(additions.flatMap(symbolsOf));
  const kept = rules.flatMap((item) => {
    if (taken.has(normalizeSymbol(item.label))) return additions.some((added) => added.id === item.id) ? [] : item.aliases.some((alias) => !taken.has(normalizeSymbol(alias))) ? [{ ...item, label: item.aliases.find((alias) => !taken.has(normalizeSymbol(alias))) as string, aliases: item.aliases.filter((alias) => !taken.has(normalizeSymbol(alias))) }] : [];
    return [{ ...item, aliases: item.aliases.filter((alias) => !taken.has(normalizeSymbol(alias))) }];
  });
  return [...kept, ...additions];
}

/** 端末に残す。記号と時刻だけで、貼り付けた表や名前は残さない。 */
export const SHIFT_RULES_KEY = 'family-hub-shift-rules';
type RuleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadShiftRules(storage: Pick<Storage, 'getItem'>): ShiftTimeRule[] {
  try {
    const parsed = z.array(shiftRuleSchema).min(1).max(40).safeParse(JSON.parse(storage.getItem(SHIFT_RULES_KEY) ?? 'null'));
    return parsed.success ? parsed.data : structuredClone([...defaultShiftRules]);
  } catch {
    return structuredClone([...defaultShiftRules]);
  }
}

export function saveShiftRules(storage: RuleStorage, rules: readonly ShiftTimeRule[]) {
  try { storage.setItem(SHIFT_RULES_KEY, JSON.stringify(rules)); return true; } catch { return false; }
}

export function resetShiftRules(storage: RuleStorage): ShiftTimeRule[] {
  try { storage.removeItem(SHIFT_RULES_KEY); } catch { /* 残っていても初期値を返す */ }
  return structuredClone([...defaultShiftRules]);
}
