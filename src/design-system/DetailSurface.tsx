import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, type PropsWithChildren } from 'react';
import { ja } from '../content/ja';
import { Drawer, focusReturnTarget } from './components';
import { useSizeClass } from './sizeClass';
import { closeGuarded } from './unsavedGuard';
import { CloseIcon } from './icons';

/**
 * 本文の領域が、一覧と詳細を並べられる幅（wide、#main が 1100px 以上）かどうか。ウィンドウではなく本文の領域で判断する。
 * 段階の決め方は sizeClass.ts。
 */
export const useContentWide = () => useSizeClass() === 'wide';

function DetailPane({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  const titleId = useId();
  const pane = useRef<HTMLElement>(null);
  // ×・Esc のどちらで閉じても、保存していない入力があれば確かめる。
  const guardedClose = () => closeGuarded(pane.current, onClose);
  const close = useEffectEvent(guardedClose);
  const trigger = useRef<HTMLElement | null>(focusReturnTarget());
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
    <div className="drawer-head"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId} data-detail-title>{title}</h2></div><button data-control-id="drawer.close" data-autofocus className="icon-button" type="button" onClick={guardedClose} aria-label={ja.actions.close}><CloseIcon/></button></div>
    {children}
  </section>;
}

/**
 * 詳細の表示。wide では一覧の横に並べ、medium では右からのドロワー、narrow では全画面のシートで開く
 * （ドロワーとシートの違いは html の data-size-class で CSS が切り替える）。開く・閉じるは URL が決める。
 */
export function DetailSurface({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  return useContentWide()
    ? <DetailPane title={title} eyebrow={eyebrow} onClose={onClose}>{children}</DetailPane>
    : <Drawer title={title} eyebrow={eyebrow} onClose={onClose}>{children}</Drawer>;
}
