import type { PropsWithChildren, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { CloseIcon, FileIcon } from './icons';

export function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 48 48" role="img" aria-label="よりどころの印"><path d="M24 4c7 8 16 10 16 21 0 9-7 17-16 17S8 34 8 25C8 14 17 12 24 4Z" fill="var(--persimmon-soft)" stroke="var(--persimmon)" strokeWidth="2"/><path d="M16 27c4-7 12-7 16 0M24 18v17" fill="none" stroke="var(--indigo-strong)" strokeWidth="2" strokeLinecap="round"/></svg>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <a href="/today" className="brand" data-link><BrandMark />{!compact && <span className="brand-copy"><span className="brand-name">よりどころ</span><span className="brand-kicker">FAMILY HUB</span></span>}</a>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>{action}</header>;
}

export function EmptyState({ title, children, action }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return <div className="empty"><div className="empty-mark"><FileIcon /></div><h2>{title}</h2><p className="muted">{children}</p>{action}</div>;
}

export function Dialog({ title, description, onClose, children, actions }: PropsWithChildren<{ title: string; description?: string; onClose: () => void; actions?: ReactNode }>) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="dialog-head"><div><h2 id={titleId}>{title}</h2>{description && <p className="muted mb-0">{description}</p>}</div><button ref={first} className="icon-button" type="button" onClick={onClose} aria-label="閉じる"><CloseIcon /></button></div>{children}{actions && <div className="dialog-actions">{actions}</div>}</section></div>;
}

export function Drawer({ title, eyebrow, onClose, children }: PropsWithChildren<{ title: string; eyebrow: string; onClose: () => void }>) {
  const titleId = useId();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return <><div className="backdrop" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="drawer-head"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="詳細を閉じる"><CloseIcon /></button></div>{children}</aside></>;
}

export function StatusBadge({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'neutral' | 'attention' | 'success' | 'danger' }>) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

export const formatYen = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
export const formatTime = (value?: string) => value ? new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value)) : '期限なし';
export const formatDate = (value: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value));
