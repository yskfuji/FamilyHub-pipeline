import { Ground } from './parts';

/** 空の状態「オフライン」: 雲と、途切れた電波。 */
export function EmptyOffline() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <path d="M54 70a14 14 0 0 1-1-28 20 20 0 0 1 38-6 16 16 0 0 1 17 34Z" fill="var(--sheet)"/>
    <path d="M62 90a26 26 0 0 1 36 0M70 98a14 14 0 0 1 20 0" stroke="var(--line-strong)"/>
    <circle cx="80" cy="105" r="2.5" fill="var(--line-strong)" stroke="none"/>
    <path d="m62 80 36 30" stroke="var(--brand)"/>
  </svg>;
}
