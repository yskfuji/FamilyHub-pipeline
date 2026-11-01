import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useSyncExternalStore, type PropsWithChildren } from 'react';
import { ja } from '../content/ja';
import { Drawer } from './components';
import { CloseIcon } from './icons';

/** 一覧と詳細を横に並べられる、本文の領域の幅（rem）。 */
const TWO_PANE_MIN_REM = 52;

function subscribeContentWidth(notify: () => void) {
  const main = document.getElementById('main');
  window.addEventListener('resize', notify);
  const observer = main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(notify) : null;
  if (main) observer?.observe(main);
  return () => { window.removeEventListener('resize', notify); observer?.disconnect(); };
}

const contentIsWide = () => {
  const main = document.getElementById('main');
  if (!main) return false;
  return main.clientWidth >= TWO_PANE_MIN_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
};

/** 本文の領域が、一覧と詳細を並べられる幅かどうか。ウィンドウではなく本文の領域で判断する。 */
export const useContentWide = () => useSyncExternalStore(subscribeContentWidth, contentIsWide);

function DetailPane({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  const titleId = useId();
  const pane = useRef<HTMLElement>(null);
  const close = useEffectEvent(onClose);
  const trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  useLayoutEffect(() => {
    const returnTarget = trigger.current;
    pane.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => {
      // 別の項目へ切り替えたときは、新しい詳細にある焦点を動かさない。
      requestAnimationFrame(() => { if (!document.querySelector('.detail-pane')) returnTarget?.focus({ preventScroll: true }); });
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[data-modal-root]')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  return <section ref={pane} className="detail-pane" role="dialog" aria-labelledby={titleId}>
    <div className="drawer-head"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><button data-control-id="drawer.close" data-autofocus className="icon-button" type="button" onClick={onClose} aria-label={ja.actions.close}><CloseIcon/></button></div>
    {children}
  </section>;
}

/** 詳細の表示。広い本文の領域では一覧の横に並べ、狭いときは今までどおり重ねて開く。 */
export function DetailSurface({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  return useContentWide()
    ? <DetailPane title={title} eyebrow={eyebrow} onClose={onClose}>{children}</DetailPane>
    : <Drawer title={title} eyebrow={eyebrow} onClose={onClose}>{children}</Drawer>;
}
