import { useSyncExternalStore } from 'react';

/**
 * 本文の領域（#main）の幅で決める3つの段階。ウィンドウの幅ではなく、レールを除いた本文の幅で決める。
 * - narrow（600px 未満）: 詳細は全画面のシートで開く。
 * - medium（600〜1100px）: 詳細は右からのドロワーで開く。
 * - wide（1100px 以上）: 一覧の横に詳細を並べる（一覧と詳細を持つ画面だけ）。
 * 上部・下のナビ・レールの切り替えは、レールが本文の幅を決めるため、ウィンドウの幅（760px）のまま。
 */
export type SizeClass = 'narrow' | 'medium' | 'wide';

export const NARROW_BELOW_PX = 600;
export const WIDE_FROM_PX = 1100;

export const sizeClassFor = (width: number): SizeClass => (width < NARROW_BELOW_PX ? 'narrow' : width < WIDE_FROM_PX ? 'medium' : 'wide');

/** #main があればその幅、なければ（サインインの画面など）ウィンドウの幅。 */
function measure(): SizeClass {
  const main = document.getElementById('main');
  return sizeClassFor(main ? main.clientWidth : window.innerWidth);
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
