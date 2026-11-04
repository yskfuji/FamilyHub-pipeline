import { Ground } from './parts';

/** 空の状態「メモ」: 重ねた2枚の紙と、留めた印。 */
export function EmptyMemos() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <rect x="44" y="32" width="60" height="64" rx="6" fill="var(--moss-soft)" transform="rotate(-9 74 64)"/>
    <path d="M62 28h44l10 10v54a4 4 0 0 1-4 4H62a4 4 0 0 1-4-4V32a4 4 0 0 1 4-4Z" fill="var(--sheet)"/>
    <path d="M106 28v10h10"/>
    <path d="M68 52h36M68 64h36M68 76h22" stroke="var(--line-strong)"/>
    <circle cx="84" cy="30" r="5" fill="var(--brand-soft)" stroke="var(--brand)"/>
  </svg>;
}
