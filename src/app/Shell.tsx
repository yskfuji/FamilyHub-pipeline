import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { useApp } from './AppContext';
import { Brand, Drawer, EmptyState, StatusBadge, formatTime } from '../design-system/components';
import type { HouseholdNotification } from '../domain/types';
import { BellIcon, CalendarIcon, CheckIcon, HomeIcon, MoonIcon, MoreIcon, NoteIcon, SearchIcon, SettingsIcon, SparkIcon, SunIcon, YenIcon } from '../design-system/icons';
import { QuickCreate } from './QuickCreate';
import { SearchOverlay } from './SearchOverlay';

const primary = [
  { href: '/today', label: '今日', icon: HomeIcon },
  { href: '/calendar', label: '予定', icon: CalendarIcon },
  { href: '/tasks', label: 'Todo', icon: CheckIcon },
  { href: '/notes', label: 'メモ', icon: NoteIcon },
  { href: '/budget', label: '家計', icon: YenIcon },
  { href: '/insights', label: '気づき', icon: SparkIcon },
  { href: '/settings/household', label: '設定', icon: SettingsIcon },
];

function isCurrent(path: string, href: string) { return path === href || path.startsWith(`${href}/`); }
function NavAnchor({ href, label, icon: Icon, path }: { href: string; label: string; icon: (props: any) => ReactNode; path: string }) {
  return <a className="nav-link" href={href} data-link aria-current={isCurrent(path, href) ? 'page' : undefined}><Icon/><span className="nav-label">{label}</span></a>;
}

export function Shell({ path, children }: PropsWithChildren<{ path: string }>) {
  const { snapshot, theme, setTheme, error, refresh, gateway, announce } = useApp();
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<HouseholdNotification[]>([]);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchButton.current?.focus(); setSearch(true); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => { void (async () => { const result = await gateway.notifications.list(); if (result.ok) setNotifications(result.value); })(); }, [gateway]);
  const unauthenticated = error?.code === 'UNAUTHENTICATED';
  return <div className="app-shell">
    <a className="skip-link" href="#main">本文へ移動</a>
    <aside className="rail"><Brand/><nav aria-label="主な機能"><ul className="nav-list">{primary.map((item) => <li key={item.href}><NavAnchor {...item} path={path}/></li>)}</ul></nav><div className="rail-footer"><a className="nav-link" href="/showcase" data-link aria-current={isCurrent(path, '/showcase') ? 'page' : undefined}><SparkIcon/><span className="nav-label">ショーケース</span></a><div className="identity"><span className="avatar" aria-hidden="true">碧</span><span className="identity-copy"><strong>{snapshot.household.name}</strong><br/><span className="muted">碧として表示</span></span></div></div></aside>
    <div className="shell-main">
      <header className="topbar"><div className="split"><span className="mobile-brand"><Brand compact/></span><div className="topbar-date"><strong>9月30日 水曜日</strong><br/><span>東京・{snapshot.context.weather.temperatureC}℃</span></div></div><div className="topbar-actions"><button ref={searchButton} type="button" className="button" onClick={() => setSearch(true)}><SearchIcon width="18"/><span className="label">検索</span><span className="small muted">⌘K</span></button><button type="button" className="icon-button notification-button" aria-label={`通知を確認、未読${notifications.filter((item) => !item.read).length}件`} onClick={async () => { const result = await gateway.notifications.list(); if (result.ok) { setNotifications(result.value); setNotificationsOpen(true); await Promise.all(result.value.filter((item) => !item.read).map((item) => gateway.notifications.markRead(item.id))); const refreshed = await gateway.notifications.list(); if (refreshed.ok) setNotifications(refreshed.value); } }}><BellIcon/>{notifications.some((item) => !item.read) && <span className="notification-dot" aria-hidden="true"/>}</button><button type="button" className="icon-button" aria-label={theme === 'light' ? '夕景テーマに切り替え' : '明るいテーマに切り替え'} onClick={() => setTheme(theme === 'light' ? 'dusk' : 'light')}>{theme === 'light' ? <MoonIcon/> : <SunIcon/>}</button></div></header>
      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="callout" role="alert"><span className="status-dot"/><div><strong>{error.message}</strong><p className="small muted mb-0">{unauthenticated ? '世帯の内容は再認証まで表示しません。' : '直近に取得した情報を表示しています。'}</p></div>{error.retryable && <button className="button" type="button" onClick={() => void refresh()}>再試行</button>}</div></div>}
      <main id="main" tabIndex={-1}>{unauthenticated ? <div className="page"><EmptyState title="本人確認が必要です" action={<a className="button primary" href="/auth" data-link>サインインへ</a>}>安全のため、世帯のデータを隠しています。</EmptyState></div> : children}</main>
      {!unauthenticated && <QuickCreate/>}
      <nav className="mobile-nav" aria-label="モバイルの主な機能">{primary.slice(0,3).map((item) => <a key={item.href} href={item.href} data-link aria-current={isCurrent(path,item.href) ? 'page' : undefined}><item.icon/><span>{item.label}</span></a>)}<a href="/budget" data-link aria-current={isCurrent(path,'/budget') ? 'page' : undefined}><YenIcon/><span>家計</span></a><button type="button" aria-expanded={more} onClick={() => setMore(!more)}><MoreIcon/><span>その他</span></button></nav>
      {more && <div className="mobile-more">{primary.slice(3).filter((item) => item.href !== '/budget').map((item) => <a key={item.href} href={item.href} data-link onClick={() => setMore(false)}><item.icon width="20"/>{item.label}</a>)}<a href="/showcase" data-link onClick={() => setMore(false)}><SparkIcon width="20"/>ショーケース</a></div>}
    </div>
    {search && <SearchOverlay onClose={() => setSearch(false)}/>} 
    {notificationsOpen && <Drawer eyebrow="Notifications" title="通知センター" onClose={() => setNotificationsOpen(false)}><div className="stack">{notifications.length === 0 ? <p className="muted">通知はありません。</p> : notifications.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.status === 'stopped' ? 'neutral' : item.status === 'snoozed' ? 'attention' : 'success'}>{item.status === 'stopped' ? '停止済み' : item.status === 'snoozed' ? '延期済み' : formatTime(item.remindAt)}</StatusBadge>{!item.read && <StatusBadge tone="attention">未読</StatusBadge>}</div><h3>{item.title}</h3><p className="muted">{item.body}</p><p className="small muted">通知時刻 {formatTime(item.remindAt)}</p><div className="grid two"><button className="button" type="button" disabled={item.status === 'stopped'} onClick={async () => { const result = await gateway.notifications.snooze(item.id, 30); if (!result.ok) return announce(result.error.message); const list = await gateway.notifications.list(); if (list.ok) setNotifications(list.value); announce('通知を30分延期しました'); }}>30分延期</button><button className="button" type="button" disabled={item.status === 'stopped'} onClick={async () => { const result = await gateway.notifications.stop(item.id); if (!result.ok) return announce(result.error.message); const list = await gateway.notifications.list(); if (list.ok) setNotifications(list.value); announce('この通知を停止しました'); }}>この通知を停止</button></div></article>)}</div></Drawer>}
  </div>;
}
