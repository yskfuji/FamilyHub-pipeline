import { Ground } from './parts';

/** 空の状態「検索で見つからない」: 何も映っていない虫眼鏡。 */
export function EmptySearch() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <rect x="94" y="68" width="12" height="32" rx="6" fill="var(--brand-soft)" stroke="var(--brand)" transform="rotate(-45 100 84)"/>
    <circle cx="72" cy="56" r="26" fill="var(--sheet)"/>
    <circle cx="72" cy="56" r="19" stroke="var(--line-strong)"/>
    <g fill="var(--line-strong)" stroke="none"><circle cx="64" cy="56" r="2.5"/><circle cx="72" cy="56" r="2.5"/><circle cx="80" cy="56" r="2.5"/></g>
    <path d="M36 30v8M32 34h8M124 34v6M121 37h6" stroke="var(--moss)"/>
  </svg>;
}
