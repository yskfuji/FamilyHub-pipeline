import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { caretAfterDigits, formatAmountInput } from '../domain/expenseForm';

/** data-control-id は必ず渡す（scripts/check-control-contracts.mjs は、この部品を呼ぶ側で数える）。 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'inputMode' | 'type'> & { 'data-control-id': string; value: string; onValueChange: (value: string) => void };

/**
 * 金額の欄（段階12）。入力のたびに3桁ごとに区切って表示し、カーソルは同じ数字の後ろに残す。
 * 日本語の入力の変換中は区切りを付けず、確定したときに付ける。値は区切り付きの文字列のままで、parseYen が区切りを外して読む。
 */
export function AmountInput({ value, onValueChange, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [composing, setComposing] = useState(false);
  useLayoutEffect(() => {
    const element = input.current;
    if (caret.current === null || !element || document.activeElement !== element) return;
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const change = (raw: string, cursor: number | null, during = composing) => {
    if (during) { onValueChange(raw); return; }
    const next = formatAmountInput(raw);
    const digitsBefore = (raw.slice(0, cursor ?? raw.length).normalize('NFKC').match(/\d/g) ?? []).length;
    caret.current = caretAfterDigits(next, digitsBefore);
    onValueChange(next);
  };
  return <input {...props} ref={input} type="text" inputMode="numeric" autoComplete="off" value={composing ? value : formatAmountInput(value)}
    onCompositionStart={() => setComposing(true)}
    onCompositionEnd={(event) => { setComposing(false); change(event.currentTarget.value, event.currentTarget.selectionStart, false); }}
    onChange={(event) => change(event.target.value, event.target.selectionStart)}/>;
}
