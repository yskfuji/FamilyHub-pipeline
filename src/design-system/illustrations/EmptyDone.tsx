import { Ground } from './parts';

/** 空の状態「全部済んだ」: 湯気の立つ湯のみと、済んだ印。 */
export function EmptyDone() {
  return <svg className="illustration" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">
    <Ground/>
    <path d="M40 98h64" stroke="var(--line-strong)"/>
    <path d="M46 60h52v14a20 20 0 0 1-20 20H66a20 20 0 0 1-20-20Z" fill="var(--sheet)"/>
    <path d="M98 64h3a8 8 0 0 1 0 16h-5"/>
    <path d="M52 70h40" stroke="var(--brand)"/>
    <path d="M62 50c-4-6 4-8 0-14M74 50c-4-6 4-8 0-14M86 50c-4-6 4-8 0-14" stroke="var(--line-strong)"/>
    <circle cx="118" cy="44" r="14" fill="var(--moss-soft)" stroke="var(--moss)"/>
    <path d="m111 44 5 5 9-10" stroke="var(--moss)"/>
  </svg>;
}
