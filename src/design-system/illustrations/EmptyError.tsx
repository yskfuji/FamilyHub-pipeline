import { Ground } from './parts';

/** 空の状態「エラー」: 二つに破れた紙と、注意の印。 */
export function EmptyError() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <g transform="rotate(-5 58 64)"><path d="M42 30h34l-6 14 8 12-7 12 6 14-5 14H42a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6Z" fill="var(--sheet)"/><path d="M44 48h18M44 60h22M44 72h16" stroke="var(--line-strong)"/></g>
    <g transform="rotate(6 100 66)"><path d="M86 32h26a6 6 0 0 1 6 6v54a6 6 0 0 1-6 6H86l5-14-6-14 7-12-8-12Z" fill="var(--sheet)"/><path d="M96 50h14M98 62h12M96 74h12" stroke="var(--line-strong)"/></g>
    <circle cx="122" cy="28" r="11" fill="var(--attention-soft)" stroke="var(--attention)"/>
    <path d="M122 22v7M122 34v.01" stroke="var(--attention)"/>
  </svg>;
}
