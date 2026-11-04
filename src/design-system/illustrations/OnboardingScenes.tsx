import { Kaki, Person } from './parts';

/** はじめにの地。幅 240・高さ 140 の枠に合わせた丸み。 */
const Ground = () => <path d="M24 128c-14-26-4-70 36-90 36-18 92-20 128-4 36 16 48 52 32 80-6 10-16 16-30 16H40c-8 0-13-1-16-2Z" fill="var(--art-ground)" stroke="none"/>;
const art = { className: 'illustration', viewBox: '0 0 240 140', fill: 'none', stroke: 'var(--ink-soft)', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** はじめに 1「家族グループの設定」: 家と、並んだ家族。 */
export function OnboardingHousehold() {
  return <svg {...art} aria-hidden="true" focusable="false">
    <Ground/>
    <rect x="44" y="64" width="72" height="56" rx="4" fill="var(--sheet)"/>
    <path d="m36 68 44-36 44 36Z" fill="var(--brand-soft)" stroke="var(--brand)"/>
    <rect x="72" y="88" width="16" height="32" rx="3" fill="var(--moss-soft)"/>
    <rect x="54" y="76" width="12" height="12" rx="2" fill="var(--paper-deep)"/>
    <rect x="94" y="76" width="12" height="12" rx="2" fill="var(--paper-deep)"/>
    <path d="M28 120h184" stroke="var(--line-strong)"/>
    <Person x={146} y={114} s={1.15} fill="var(--brand-soft)"/>
    <Person x={170} y={116} s={0.8} fill="var(--moss-soft)"/>
    <Person x={194} y={114} s={1.1} fill="var(--info-soft)"/>
  </svg>;
}

/** はじめに 2「共有範囲」: 家族を覆う傘と、外の雨。 */
export function OnboardingSharing() {
  return <svg {...art} aria-hidden="true" focusable="false">
    <Ground/>
    <path d="M60 70a60 46 0 0 1 120 0c-8-6-16-6-24 0-8-6-16-6-24 0-8-6-16-6-24 0-8-6-16-6-24 0-8-6-16-6-24 0Z" fill="var(--brand-soft)" stroke="var(--brand)"/>
    <path d="M120 24v-6M120 70v44a6 6 0 0 1-12 0" stroke="var(--ink-soft)"/>
    <Person x={98} y={120} s={1.1} fill="var(--moss-soft)"/>
    <Person x={142} y={120} s={1.1} fill="var(--info-soft)"/>
    <path d="M28 120h184" stroke="var(--line-strong)"/>
    <path d="m34 46-3 7M46 70l-3 7M30 92l-3 7M206 50l-3 7M214 78l-3 7M198 100l-3 7" stroke="var(--accent)"/>
  </svg>;
}

/** はじめに 3「ようこそ」: 実のなった柿の枝と、昇る日。 */
export function OnboardingWelcome() {
  return <svg {...art} aria-hidden="true" focusable="false">
    <Ground/>
    <circle cx="200" cy="36" r="14" fill="var(--sheet)" stroke="var(--gold)"/>
    <path d="M200 12v4M200 56v4M176 36h4M220 36h4M183 19l3 3M217 19l-3 3M183 53l3-3M217 53l-3-3" stroke="var(--gold)"/>
    <path d="M18 34c40 2 74 10 104 24s52 30 72 32" stroke="var(--ink-soft)"/>
    <path d="M60 40c4-12 16-16 26-12-4 12-16 16-26 12ZM132 64c10-8 24-6 30 2-10 8-24 6-30-2Z" fill="var(--moss-soft)" stroke="var(--moss)"/>
    <path d="M78 46v10M120 58v14M172 80v10" stroke="var(--ink-soft)"/>
    <Kaki x={78} y={66} s={1.1}/>
    <Kaki x={120} y={83} s={1.25}/>
    <Kaki x={172} y={100} s={1}/>
  </svg>;
}
