import { Ground, Kaki } from './parts';

/** 空の状態「予定」: 丸を付けた日のある暦と、柿の実。 */
export function EmptyEvents() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <rect x="42" y="28" width="76" height="66" rx="8" fill="var(--sheet)"/>
    <path d="M42 46V36a8 8 0 0 1 8-8h60a8 8 0 0 1 8 8v10Z" fill="var(--brand-soft)"/>
    <path d="M60 22v12M100 22v12"/>
    <g fill="var(--line-strong)" stroke="none">{[56, 72, 88, 104].flatMap((x) => [58, 70, 82].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2"/>))}</g>
    <circle cx="88" cy="70" r="7" stroke="var(--brand)"/>
    <Kaki x={120} y={90} s={0.8}/>
  </svg>;
}
