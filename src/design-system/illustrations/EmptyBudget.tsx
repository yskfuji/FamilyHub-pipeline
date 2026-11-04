import { Ground } from './parts';

/** 空の状態「家計」: 口金の財布と、円の字を描いた硬貨。 */
export function EmptyBudget() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <path d="M38 58a8 8 0 0 1 8-8h60a8 8 0 0 1 8 8v28a12 12 0 0 1-12 12H50a12 12 0 0 1-12-12Z" fill="var(--moss-soft)"/>
    <path d="M58 50a18 14 0 0 1 36 0"/>
    <circle cx="70" cy="42" r="4" fill="var(--sheet)" stroke="var(--gold)"/>
    <circle cx="82" cy="42" r="4" fill="var(--sheet)" stroke="var(--gold)"/>
    <path d="M38 66c18 10 58 10 76 0" stroke="var(--moss)"/>
    {[[122, 82], [112, 92], [130, 96]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="9" fill="var(--sheet)" stroke="var(--gold)"/>)}
    <path d="m118 77 4 5 4-5M122 82v6M118 84h8" stroke="var(--gold)"/>
  </svg>;
}
