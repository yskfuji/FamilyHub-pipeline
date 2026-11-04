import { Ground } from './parts';

/** 空の状態「場所」: 折りたたんだ地図と、点線の道、目印。 */
export function EmptyPlaces() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <path d="m32 40 30-10 32 10 30-10v60l-30 10-32-10-30 10Z" fill="var(--sheet)"/>
    <path d="M62 30v60M94 40v60" stroke="var(--line-strong)"/>
    <path d="M42 82c10-4 14-18 26-16s14 14 28 8" stroke="var(--accent)" strokeDasharray="2 6"/>
    <path d="M106 74s-13-12-13-22a13 13 0 0 1 26 0c0 10-13 22-13 22Z" fill="var(--brand-soft)" stroke="var(--brand)"/>
    <circle cx="106" cy="52" r="4.5" fill="var(--sheet)" stroke="var(--brand)"/>
  </svg>;
}
