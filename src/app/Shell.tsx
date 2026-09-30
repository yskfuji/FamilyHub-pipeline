import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { useApp } from './AppContext';
import { Brand, Drawer, EmptyState, PageHeader, StatusBadge, formatTime } from '../design-system/components';
import type { HouseholdNotification } from '../domain/types';
import { BellIcon, CalendarIcon, CheckIcon, HomeIcon, MoonIcon, MoreIcon, NoteIcon, SearchIcon, SettingsIcon, SparkIcon, SunIcon, YenIcon } from '../design-system/icons';
import { QuickCreate } from './QuickCreate';
import { SearchOverlay } from './SearchOverlay';
import type { Capability } from '../domain/types';
import { roleLabels } from '../authz/policy';
import { auditPath, auditSurface } from '@audit-surface';

const primary: Array<{ href: string; label: string; icon: (props: any) => ReactNode; capability?: Capability }> = [
  { href: '/today', label: '今日', icon: HomeIcon },
  { href: '/calendar', label: '予定', icon: CalendarIcon, capability: 'event.read' },
  { href: '/tasks', label: 'タスク', icon: CheckIcon, capability: 'task.read' },
  { href: '/notes', label: 'メモ', icon: NoteIcon, capability: 'memo.read' },
  { href: '/budget', label: '家計', icon: YenIcon, capability: 'expense.read' },
  { href: '/insights', label: '気づき', icon: SparkIcon, capability: 'insight.read' },
  { href: '/settings/security', label: '設定', icon: SettingsIcon, capability: 'settings.own' },
];

function isCurrent(path: string, href: string) { return path === href || path.startsWith(`${href}/`); }
function NavAnchor({ href, label, icon: Icon, path }: { href: string; label: string; icon: (props: any) => ReactNode; path: string }) {
  return <a className="nav-link" href={href} data-link aria-current={isCurrent(path, href) ? 'page' : undefined}><Icon/><span className="nav-label">{label}</span></a>;
}

export function Shell({ path, children }: PropsWithChildren<{ path: string }>) {
  const { snapshot, loading, theme, setTheme, error, refresh, gateway, announce, can, pendingCommands, retryQueued, discardQueued } = useApp();
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<HouseholdNotification[]>([]);
  const [notificationsError, setNotificationsError] = useState('');
  const [notificationBusy, setNotificationBusy] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchButton.current?.focus(); setSearch(true); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => { void (async () => { const result = await gateway.notifications.list(); if (result.ok) setNotifications(result.value); else setNotificationsError(result.error.message); })(); }, [gateway]);
  const unauthenticated = error?.code === 'UNAUTHENTICATED';
  const available = primary.filter((item) => !item.capability || can(item.capability));
  const mobilePrimary = available.filter((item) => ['/today','/calendar','/tasks','/notes','/budget'].includes(item.href)).slice(0, 4);
  const loadNotifications = async () => { const result = await gateway.notifications.list(); if (result.ok) { setNotifications(result.value); setNotificationsError(''); } else setNotificationsError(result.error.message); };
  const updateNotification = async (id: string, action: 'read' | 'snooze' | 'stop' | 'resume') => {
    if (notificationBusy) return; setNotificationBusy(`${id}:${action}`);
    const result = action === 'read' ? await gateway.notifications.markRead(id) : action === 'snooze' ? await gateway.notifications.snooze(id, 30) : action === 'stop' ? await gateway.notifications.stop(id) : await gateway.notifications.resume(id);
    setNotificationBusy(null);
    if (!result.ok) { setNotificationsError(result.error.message); return; }
    await loadNotifications(); announce(action === 'read' ? '通知を既読にしました' : action === 'snooze' ? '通知を30分延期しました' : action === 'stop' ? 'この通知を停止しました' : '通知を再開しました');
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main">本文へ移動</a>
    <aside className="rail"><Brand/><nav aria-label="主な機能"><ul className="nav-list">{available.map((item) => <li key={item.href}><NavAnchor {...item} path={path}/></li>)}</ul></nav><div className="rail-footer">{auditSurface && <a className="nav-link" href={auditPath} data-link aria-current={isCurrent(path, auditPath) ? 'page' : undefined}><SparkIcon/><span className="nav-label">内部監査</span></a>}<div className="identity"><span className="avatar" aria-hidden="true">{snapshot.user.displayName.slice(0, 1)}</span><span className="identity-copy"><strong>{snapshot.household.name}</strong><br/><span className="muted">{snapshot.user.displayName} · {roleLabels[snapshot.viewer.role]}</span></span></div></div></aside>
    <div className="shell-main">
      <header className="topbar"><div className="split"><span className="mobile-brand"><Brand compact/></span><div className="topbar-date"><strong>9月30日 水曜日</strong><br/><span>東京・{snapshot.context.weather.temperatureC}℃</span></div></div><div className="topbar-actions">{pendingCommands.length > 0 && <button type="button" className="button" data-control-id="queue.open" onClick={() => setQueueOpen(true)}><span className="label">再送待ち</span><StatusBadge tone="attention">{pendingCommands.length}</StatusBadge></button>}<button ref={searchButton} type="button" className="button" data-control-id="search.open" onClick={() => setSearch(true)}><SearchIcon width="18"/><span className="label">検索</span><span className="small muted">⌘K</span></button><button type="button" className="icon-button notification-button" data-control-id="notifications.open" aria-label={`通知を確認、未読${notifications.filter((item) => !item.read).length}件`} onClick={async () => { await loadNotifications(); setNotificationsOpen(true); }}><BellIcon/>{notifications.some((item) => !item.read) && <span className="notification-dot" aria-hidden="true"/>}</button><button type="button" className="icon-button" data-control-id="theme.toggle" aria-label={theme === 'light' ? '夕景テーマに切り替え' : '明るいテーマに切り替え'} onClick={() => setTheme(theme === 'light' ? 'dusk' : 'light')}>{theme === 'light' ? <MoonIcon/> : <SunIcon/>}</button></div></header>
      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="callout" role="alert"><span className="status-dot"/><div><strong>{error.message}</strong><p className="small muted mb-0">{unauthenticated ? '世帯の内容は再認証まで表示しません。' : '直近に取得した情報を表示しています。'}</p></div>{error.retryable && <button className="button" type="button" onClick={() => void refresh()}>再試行</button>}</div></div>}
      <main id="main" tabIndex={-1} aria-busy={loading}>{unauthenticated ? <div className="page"><EmptyState title="本人確認が必要です" action={<a className="button primary" href="/auth" data-link>サインインへ</a>}>安全のため、世帯のデータを隠しています。</EmptyState></div> : loading ? <div className="page" aria-label="世帯の情報を読み込んでいます"><PageHeader eyebrow="読み込み中" title="最新の情報を確認しています" description="確認が終わるまで、この画面の変更操作は行いません。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/></div></div> : children}</main>
      {!unauthenticated && !loading && (can('event.create') || can('task.create') || can('memo.create') || can('expense.create')) && <QuickCreate/>}
      <nav className="mobile-nav" aria-label="モバイルの主な機能">{mobilePrimary.map((item) => <a key={item.href} href={item.href} data-link aria-current={isCurrent(path,item.href) ? 'page' : undefined}><item.icon/><span>{item.label}</span></a>)}<button type="button" data-control-id="navigation.more" aria-expanded={more} onClick={() => setMore(!more)}><MoreIcon/><span>その他</span></button></nav>
      {more && <div className="mobile-more">{available.filter((item) => !mobilePrimary.some((mobile) => mobile.href === item.href)).map((item) => <a key={item.href} href={item.href} data-link onClick={() => setMore(false)}><item.icon width="20"/>{item.label}</a>)}{auditSurface && <a href={auditPath} data-link onClick={() => setMore(false)}><SparkIcon width="20"/>内部監査</a>}</div>}
    </div>
    {search && <SearchOverlay onClose={() => setSearch(false)}/>} 
    {notificationsOpen && <Drawer eyebrow="お知らせ" title="通知センター" onClose={() => setNotificationsOpen(false)}><div className="stack">{notificationsError && <div className="notice error" role="alert"><strong>{notificationsError}</strong><button className="button mt-1" type="button" onClick={() => void loadNotifications()}>もう一度読み込む</button></div>}{notifications.length === 0 && !notificationsError ? <p className="muted">通知はありません。</p> : notifications.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.status === 'stopped' ? 'neutral' : item.status === 'snoozed' ? 'attention' : 'success'}>{item.status === 'stopped' ? '停止済み' : item.status === 'snoozed' ? '延期済み' : formatTime(item.remindAt)}</StatusBadge>{!item.read && <StatusBadge tone="attention">未読</StatusBadge>}</div><h3>{item.title}</h3><p className="muted">{item.body}</p><p className="small muted">通知時刻 {formatTime(item.remindAt)}</p><div className="grid two">{!item.read && <button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'read')}>既読にする</button>}{item.status !== 'stopped' ? <><button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'snooze')}>{notificationBusy === `${item.id}:snooze` ? '延期中…' : '30分延期'}</button><button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'stop')}>{notificationBusy === `${item.id}:stop` ? '停止中…' : 'この通知を停止'}</button></> : <button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'resume')}>通知を再開</button>}</div></article>)}</div></Drawer>}
    {queueOpen && <Drawer eyebrow="オフライン対応" title="再送待ち" onClose={() => setQueueOpen(false)}><p className="muted">内容を確認してから送信します。自動送信や上書きは行いません。</p><div className="stack">{pendingCommands.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.state === 'pending' ? 'attention' : 'danger'}>{item.state === 'pending' ? '送信待ち' : item.state === 'conflicted' ? '内容の確認が必要' : '権限の確認が必要'}</StatusBadge><span className="small muted">24時間以内</span></div><h3>{item.summary}</h3><div className="grid two"><button className="button primary" type="button" onClick={() => void retryQueued(item.id)}>この変更を送信</button><button className="button" type="button" onClick={() => void discardQueued(item.id)}>破棄</button></div></article>)}<button className="button primary full" type="button" onClick={() => void retryQueued()}>送信できる変更をすべて送る</button></div></Drawer>}
  </div>;
}
