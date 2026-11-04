import { useSyncExternalStore } from 'react';

/**
 * 本文の領域（#main）の幅で決める3つの段階。ウィンドウの幅ではなく、レールを除いた本文の幅で決める。
 * - narrow（600px 未満）: 詳細は全画面のシートで開く。
 * - medium（600〜1100px）: 詳細は右からのドロワーで開く。
 * - wide（1100px 以上）: 一覧の横に詳細を並べる（一覧と詳細を持つ画面だけ）。
 * 下のナビとレールの切り替えも同じ段階にそろえる（段階12）。レールは、置いたときに本文が 600px 以上になる窓の幅
 * （600px ＋ レールの 5.2rem = 42.7rem）から出す。下のナビがある間は、#main の幅によらず narrow とする。
 * こうすると「下のナビ」と「medium のドロワー」の組（前の 600〜760px の窓）がなくなる。
 */
export type SizeClass = 'narrow' | 'medium' | 'wide';

export const NARROW_BELOW_PX = 600;
export const WIDE_FROM_PX = 1100;

/** 下のナビを出す窓の幅。global.css と tokens.css の `@media (width < 42.7rem)` と同じ（600px ＋ レールの幅 5.2rem）。 */
export const BOTTOM_NAV_QUERY = '(width < 42.7rem)';

export const sizeClassFor = (width: number): SizeClass => (width < NARROW_BELOW_PX ? 'narrow' : width < WIDE_FROM_PX ? 'medium' : 'wide');

/** 下のナビを出しているか。matchMedia のない環境（単体試験の jsdom）では分からないので null。 */
const bottomNavShown = () => (typeof window.matchMedia === 'function' ? window.matchMedia(BOTTOM_NAV_QUERY).matches : null);

/**
 * #main があればその幅、なければ（サインインの画面など）ウィンドウの幅。
 * 下のナビがある間は narrow。レールがあるのに #main が 600px に届かない（窓の縦のスクロールバーの分など）ときは medium。
 */
function measure(): SizeClass {
  const main = document.getElementById('main');
  if (!main) return sizeClassFor(window.innerWidth);
  const measured = sizeClassFor(main.clientWidth);
  const bottomNav = bottomNavShown();
  if (bottomNav === null) return measured;
  if (bottomNav) return 'narrow';
  return measured === 'narrow' ? 'medium' : measured;
}

const listeners = new Set<() => void>();
let current: SizeClass | null = null;
let observer: ResizeObserver | null = null;
let observed: Element | null = null;

/** 段階を html の data-size-class にも書く。body へ出すドロワーの見た目を CSS で切り替えるため。 */
function update() {
  const next = measure();
  if (next === current) return;
  current = next;
  document.documentElement.dataset.sizeClass = next;
  listeners.forEach((listener) => listener());
}

/** #main は画面の切り替えで作り直されることがあるので、見ている要素が変わったら付け直す。 */
function watchMain() {
  const main = document.getElementById('main');
  if (main === observed) return;
  observer?.disconnect();
  observed = main;
  if (main && typeof ResizeObserver !== 'undefined') {
    observer ??= new ResizeObserver(() => update());
    observer.observe(main);
  }
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('resize', update);
  listeners.add(listener);
  watchMain();
  update();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { window.removeEventListener('resize', update); observer?.disconnect(); observed = null; }
  };
}

const snapshot = () => { watchMain(); return current ?? measure(); };

/** 今の段階。#main の大きさが変わると描き直す。 */
export const useSizeClass = () => useSyncExternalStore(subscribe, snapshot, () => 'medium' as SizeClass);

/** 描画の外（ルーターなど）から今の段階を読む。 */
export const currentSizeClass = () => { update(); return current ?? measure(); };
