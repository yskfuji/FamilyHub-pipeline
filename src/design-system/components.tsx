import type { PropsWithChildren, ReactNode } from 'react';
import { useEffectEvent, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CloseIcon, FileIcon } from './icons';
import { addDateKeyDays, dateKeyFromRfc3339 } from '../domain/calendarDate';
import { ja } from '../content/ja';

export function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 48 48" role="img" aria-label={ja.brand.markLabel}><path d="M24 4c7 8 16 10 16 21 0 9-7 17-16 17S8 34 8 25C8 14 17 12 24 4Z" fill="var(--persimmon-soft)" stroke="var(--persimmon)" strokeWidth="2"/><path d="M16 27c4-7 12-7 16 0M24 18v17" fill="none" stroke="var(--indigo-strong)" strokeWidth="2" strokeLinecap="round"/></svg>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  // ロゴだけを表示するときも、リンク先が名前から分かるようにする。
  return <a data-control-id="brand.home" href="/today" className="brand" data-link aria-label={compact ? `${ja.brand.name}（今日の画面へ）` : undefined}><BrandMark />{!compact && <span className="brand-copy"><span className="brand-name">{ja.brand.name}</span><span className="brand-kicker">{ja.brand.tagline}</span></span>}</a>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>{action}</header>;
}

export function EmptyState({ title, children, action }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return <div className="empty"><div className="empty-mark"><FileIcon /></div><h2>{title}</h2><p className="muted">{children}</p>{action}</div>;
}

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let lastModalTrigger: HTMLElement | null = null;

export function useModalTriggerTracking() {
  useLayoutEffect(() => {
    const remember = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(focusable) : null;
      if (target && !target.closest('[data-modal-root]')) lastModalTrigger = target;
      else if (target) lastModalTrigger = target;
    };
    document.addEventListener('pointerdown', remember, true);
    return () => document.removeEventListener('pointerdown', remember, true);
  }, []);
}

export function useModalBehavior(onClose: () => void) {
  const root = useRef<HTMLElement>(null);
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const trigger = useRef<HTMLElement | null>(active ?? lastModalTrigger);
  const close = useEffectEvent(onClose);
  useLayoutEffect(() => {
    const returnTarget = trigger.current;
    const appRoot = document.getElementById('root');
    const previousOverflow = document.body.style.overflow;
    appRoot?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    const preferred = root.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus], button, input, select, textarea, a[href]');
    preferred?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !root.current) return;
      const items = [...root.current.querySelectorAll<HTMLElement>(focusable)].filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => returnTarget?.focus());
    };
  }, []);
  return root;
}

export function Dialog({ title, description, onClose, children, actions }: PropsWithChildren<{ title: string; description?: string; onClose: () => void; actions?: ReactNode }>) {
  const titleId = useId();
  const root = useModalBehavior(onClose);
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="dialog-head"><div><h2 id={titleId}>{title}</h2>{description && <p className="muted mb-0">{description}</p>}</div><button data-control-id="dialog.close" data-autofocus className="icon-button" type="button" onClick={onClose} aria-label={ja.actions.close}><CloseIcon /></button></div>{children}{actions && <div className="dialog-actions">{actions}</div>}</section></div>, document.body);
}

export function Drawer({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  const titleId = useId();
  const root = useModalBehavior(onClose);
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root><div className="backdrop" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="drawer-head"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><button data-control-id="drawer.close" data-autofocus className="icon-button" type="button" onClick={onClose} aria-label={ja.actions.close}><CloseIcon /></button></div>{children}</aside></div>, document.body);
}

export function StatusBadge({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'neutral' | 'attention' | 'success' | 'danger' }>) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

export const formatYen = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
export const formatTime = (value?: string) => value ? new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value)) : ja.states.noDueDate;
export const formatDate = (value: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value));
export const formatDateOnly = (value: string) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(`${value}T12:00:00+09:00`));

/** 期限の表示。今日なら時刻だけ、明日なら「明日」、それ以外は日付も付ける（時刻だけだと別の日の期限と区別できない）。 */
export function formatDue(value: string | undefined, asOf: string): string {
  if (!value) return ja.states.noDueDate;
  const today = dateKeyFromRfc3339(asOf);
  const day = dateKeyFromRfc3339(value);
  const time = formatTime(value);
  if (day === today) return time;
  if (day === addDateKeyDays(today, 1)) return `明日 ${time}`;
  if (day === addDateKeyDays(today, -1)) return `昨日 ${time}`;
  return `${formatDate(value)} ${time}`;
}

/** 基準時刻からの経過を「5分前」「2時間前」のように表す。7日以上前は日付で示す。 */
export function formatRelative(value: string, asOf: string): string {
  const minutes = Math.round((Date.parse(asOf) - Date.parse(value)) / 60_000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}日前`;
  return formatDate(value);
}

/** 詳細URLの対象が、削除・共有範囲の変更・存在しないIDのいずれかで表示できないとき。存在の有無は区別しない。 */
export function DetailNotFound({ what, feature, backHref }: { what: string; feature: string; backHref: string }) {
  return <div className="callout detail-missing" role="status">
    <AlertIcon/>
    <div><strong>{what}が見つからないか、表示する権限がありません</strong><p className="small muted mb-0">削除されたか、共有の範囲が変わった可能性があります。</p></div>
    <a data-control-id={`route.detail.back.${feature}`} className="button" href={backHref} data-link>一覧に戻る</a>
  </div>;
}

