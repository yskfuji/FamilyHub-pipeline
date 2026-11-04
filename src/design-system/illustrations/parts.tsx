/**
 * 挿絵に共通する部品。色はテーマの変数だけを使い（夜のテーマでも色が変わる）、線の太さは CSS の .illustration が決める。
 * 挿絵はどれも飾りで、意味は隣の文が伝える。scripts/audit-illustrations.mjs が、色の直書き・aria-hidden・大きさを確かめる。
 */

/** どの挿絵も、この丸みのある地の上に描く（同じ一族に見えるように）。幅 160・高さ 120 の枠に合わせた形。 */
export const Ground = () => <path d="M20 98c-10-22-2-52 24-66 22-12 52-14 76-6 24 9 34 32 26 54-4 12-14 19-28 20H36c-8 0-13-1-16-2Z" fill="var(--art-ground)" stroke="none"/>;

/** 柿の実（へたと実）。x と y は実の中心、s は倍率（1 で幅 22）。 */
export const Kaki = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => <g transform={`translate(${x} ${y}) scale(${s})`}>
  <ellipse cy="2" rx="11" ry="9.5" fill="var(--brand-soft)" stroke="var(--brand)"/>
  <path d="M-8-6c3-3 5-3 8-1 3-2 5-2 8 1-3 2-5 2-8 1-3 1-5 1-8-1ZM0-7v-4" fill="var(--moss-soft)" stroke="var(--moss)"/>
</g>;

/** 人の形（頭と肩）。挿絵の家族に使う。 */
export const Person = ({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) => <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
  <circle cy="-20" r="7"/>
  <path d="M-12 6a12 12 0 0 1 24 0Z"/>
</g>;
