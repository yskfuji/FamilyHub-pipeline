import { Ground } from './parts';

/** 空の状態「タスク」: 一つだけ印の付いたチェックの板と、鉛筆。 */
export function EmptyTasks() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <rect x="46" y="24" width="64" height="76" rx="8" fill="var(--sheet)"/>
    <rect x="64" y="18" width="28" height="12" rx="4" fill="var(--moss-soft)"/>
    {[46, 62, 78].map((y, index) => <g key={y}>
      <rect x="56" y={y - 5} width="10" height="10" rx="3" fill={index ? 'var(--sheet)' : 'var(--moss-soft)'}/>
      <path d={`M74 ${y}h${index === 2 ? 16 : 26}`} stroke="var(--line-strong)"/>
    </g>)}
    <path d="m58 46 3 3 5-6" stroke="var(--moss)"/>
    <g transform="rotate(32 124 64)"><path d="M119 38h10v40l-5 8-5-8Z" fill="var(--brand-soft)"/><path d="M119 46h10M120 80h8" stroke="var(--brand)"/></g>
  </svg>;
}
