import { Ground } from './parts';

/** 空の状態「アルバム」: 重ねた2枚の写真。山と、日の代わりの柿色の丸。 */
export function EmptyAlbums() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <rect x="58" y="24" width="66" height="54" rx="5" fill="var(--sheet)" transform="rotate(8 91 51)"/>
    <rect x="36" y="38" width="76" height="60" rx="5" fill="var(--sheet)"/>
    <rect x="43" y="45" width="62" height="40" rx="2" fill="var(--paper-deep)" stroke="none"/>
    <path d="m43 85 20-22 12 12 10-8 20 18Z" fill="var(--moss-soft)" stroke="var(--moss)"/>
    <circle cx="90" cy="57" r="6" fill="var(--brand-soft)" stroke="var(--brand)"/>
  </svg>;
}
