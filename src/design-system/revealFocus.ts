/**
 * Tab で焦点が動いたとき、焦点のある要素を全部見せる（段階12。WCAG 2.4.11）。
 * - 横にスクロールする並び（設定のタブ・札の並びなど）の中では、並びの中に全部見せる。Chromium は、一部だけ見えている要素へ
 *   Tab で移ってもスクロールしないことがある（設定のタブの「共有とプライバシー」が右端で半分切れていた）。
 * - 画面やドロワーの縦の向きでは、要素が窓の上下の端で切れているときだけ、近い側へ寄せる（WebKit は、半分が窓の外のまま止まる）。
 *   上部と下のナビの分は、html の scroll-padding（tokens.css の --layout-*）が空ける。
 * Tab のときだけ動かす。プログラムで焦点を移すとき（focus({ preventScroll: true })）の意図は変えない。
 */
const EDGE_PX = 8;

export function revealInScroller(target: Element) {
  for (let node = target.parentElement; node && node !== document.body; node = node.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(node).overflowX) || node.scrollWidth <= node.clientWidth) continue;
    const box = target.getBoundingClientRect();
    const frame = node.getBoundingClientRect();
    if (box.left < frame.left) node.scrollLeft -= frame.left - box.left + EDGE_PX;
    else if (box.right > frame.right) node.scrollLeft += box.right - frame.right + EDGE_PX;
    return;
  }
}

/** 窓の上下（上部と下のナビ・すぐに追加の分を除く）で切れているときだけ、近い側へ寄せる。 */
export function revealInWindow(target: Element) {
  const box = target.getBoundingClientRect();
  // 重ね表示の中は固定の部品に覆われないので、窓の端だけで比べる。
  const padding = target.closest('[data-modal-root]') ? null : getComputedStyle(document.documentElement);
  const top = padding ? parseFloat(padding.scrollPaddingTop) || 0 : 0;
  const bottom = window.innerHeight - (padding ? parseFloat(padding.scrollPaddingBottom) || 0 : 0);
  if (box.height === 0 || (box.top >= top && box.bottom <= bottom)) return;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** 文書全体で、Tab による焦点の移動を見る。外すための関数を返す。 */
export function watchFocusInScrollers() {
  let tabbing = false;
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    tabbing = true;
    setTimeout(() => { tabbing = false; }, 0);
  };
  const focusin = (event: FocusEvent) => {
    if (!tabbing || !(event.target instanceof Element)) return;
    revealInScroller(event.target);
    revealInWindow(event.target);
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin);
  return () => {
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin);
  };
}
