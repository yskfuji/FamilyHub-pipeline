import { flushSync } from 'react-dom';

/** 一覧の項目の題名と、開いた詳細の題名に付ける共有の名前。遷移の間だけ付ける。 */
const SHARED_TITLE = 'detail-title';

/** 動きを減らす設定（端末の設定か、この端末だけの設定）のときは動かさない。 */
export function motionAllowed() {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !reduced && document.documentElement.dataset.reduceMotion !== 'true';
}

/** View Transitions が使え、動かしてよいときだけ true。対応していない端末では、すぐに切り替える。 */
export function canTransition() {
  return typeof document.startViewTransition === 'function' && motionAllowed() && document.visibilityState === 'visible';
}

const named = (element: HTMLElement | null, name: string) => { if (element) element.style.viewTransitionName = name; };

/**
 * 画面の切り替えを View Transitions で行う。source は押したリンク。その中に題名（data-transition-title）があれば、
 * 開いた詳細の題名（data-detail-title）へ同じ名前を渡して、題名が動いて見えるようにする。
 * 名前は押した項目にだけ、遷移の間だけ付ける（同じ名前が2つあると遷移が成り立たない）。
 */
export function runViewTransition(update: () => void, source?: Element | null) {
  if (!canTransition()) { update(); return; }
  const from = source?.querySelector<HTMLElement>('[data-transition-title]') ?? null;
  let to: HTMLElement | null = null;
  named(from, SHARED_TITLE);
  const transition = document.startViewTransition(() => {
    named(from, '');
    flushSync(update);
    if (!from) return;
    to = document.querySelector<HTMLElement>('[data-detail-title]');
    named(to, SHARED_TITLE);
  });
  const clear = () => { named(from, ''); named(to, ''); };
  transition.finished.then(clear, clear);
  // 途中で次の遷移が始まったときなどに捨てられる。どちらも画面の更新は済んでいる。
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
}
