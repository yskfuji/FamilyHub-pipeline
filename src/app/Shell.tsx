import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { useApp } from './AppContext';
import { Brand, Drawer, EmptyState, PageHeader, StatusBadge, formatTime } from '../design-system/components';
import type { HouseholdNotification } from '../domain/types';
import { BellIcon, CalendarIcon, CheckIcon, HomeIcon, MoonIcon, MoreIcon, NoteIcon, SearchIcon, SettingsIcon, SparkIcon, SunIcon, YenIcon } from '../design-system/icons';
import { QuickCreate } from './QuickCreate';
import { SearchOverlay } from './SearchOverlay';
import type { Capability } from '../domain/types';
import { ja, notificationStatusLabels, roleLabels } from '../content/ja';
import { auditPath, auditSurface } from '@audit-surface';

const primary: Array<{ href: string; label: string; icon: (props: any) => ReactNode; capability?: Capability }> = [
  { href: '/today', label: ja.navigation.today, icon: HomeIcon },
  { href: '/calendar', label: ja.navigation.calendar, icon: CalendarIcon, capability: 'event.read' },
  { href: '/tasks', label: ja.navigation.tasks, icon: CheckIcon, capability: 'task.read' },
  { href: '/notes', label: ja.navigation.notes, icon: NoteIcon, capability: 'memo.read' },
  { href: '/budget', label: ja.navigation.budget, icon: YenIcon, capability: 'expense.read' },
  { href: '/insights', label: ja.navigation.insights, icon: SparkIcon, capability: 'insight.read' },
  { href: '/settings/security', label: ja.navigation.settings, icon: SettingsIcon, capability: 'settings.own' },
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
  const notificationBusyRef = useRef(false);
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
    if (notificationBusyRef.current) return;
    notificationBusyRef.current = true;
    setNotificationBusy(`${id}:${action}`);
    try {
      const result = action === 'read' ? await gateway.notifications.markRead(id) : action === 'snooze' ? await gateway.notifications.snooze(id, 30) : action === 'stop' ? await gateway.notifications.stop(id) : await gateway.notifications.resume(id);
      if (!result.ok) { setNotificationsError(result.error.message); return; }
      await loadNotifications();
      announce(action === 'read' ? '通知を既読にしました。' : action === 'snooze' ? '通知を30分後に変更しました。' : action === 'stop' ? 'この通知を停止しました。' : '通知を再開しました。');
    } finally {
      notificationBusyRef.current = false;
      setNotificationBusy(null);
    }
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main">本文へ移動</a>
    <aside className="rail"><Brand/><nav aria-label="主な機能"><ul className="nav-list">{available.map((item) => <li key={item.href}><NavAnchor {...item} path={path}/></li>)}</ul></nav><div className="rail-footer">{auditSurface && <a className="nav-link" href={auditPath} data-link aria-current={isCurrent(path, auditPath) ? 'page' : undefined}><SparkIcon/><span className="nav-label">内部監査</span></a>}<div className="identity"><span className="avatar" aria-hidden="true">{snapshot.user.displayName.slice(0, 1)}</span><span className="identity-copy"><strong>{snapshot.household.name}</strong><br/><span className="muted">{snapshot.user.displayName} · {roleLabels[snapshot.viewer.role]}</span></span></div></div></aside>
    <div className="shell-main">
      <header className="topbar"><div className="split"><span className="mobile-brand"><Brand compact/></span><div className="topbar-date"><strong>9月30日 水曜日</strong><br/><span>東京・{snapshot.context.weather.temperatureC}℃</span></div></div><div className="topbar-actions">{pendingCommands.length > 0 && <button type="button" className="button" data-control-id="queue.open" onClick={() => setQueueOpen(true)}><span className="label">未送信の変更</span><StatusBadge tone="attention">{pendingCommands.length}</StatusBadge></button>}<button ref={searchButton} type="button" className="button" data-control-id="search.open" onClick={() => setSearch(true)}><SearchIcon width="18"/><span className="label">検索</span><span className="small muted">⌘K</span></button><button type="button" className="icon-button notification-button" data-control-id="notifications.open" aria-label={`通知を確認、未読${notifications.filter((item) => !item.read).length}件`} onClick={async () => { await loadNotifications(); setNotificationsOpen(true); }}><BellIcon/>{notifications.some((item) => !item.read) && <span className="notification-dot" aria-hidden="true"/>}</button><button type="button" className="icon-button" data-control-id="theme.toggle" aria-label={theme === 'light' ? '暗いテーマに切り替え' : '明るいテーマに切り替え'} onClick={() => setTheme(theme === 'light' ? 'dusk' : 'light')}>{theme === 'light' ? <MoonIcon/> : <SunIcon/>}</button></div></header>
      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="callout" role="alert"><span className="status-dot"/><div><strong>{error.message}</strong><p className="small muted mb-0">{unauthenticated ? '本人確認が終わるまで、家族の情報は表示しません。' : '最後に取得できた情報を表示しています。'}</p></div>{error.retryable && <button className="button" type="button" onClick={() => void refresh()}>{ja.actions.retry}</button>}</div></div>}
      <main id="main" tabIndex={-1} aria-busy={loading}>{unauthenticated ? <div className="page"><EmptyState title="本人確認が必要です" action={<a className="button primary" href="/auth" data-link>サインインする</a>}>家族の情報を表示するには、もう一度サインインしてください。</EmptyState></div> : loading ? <div className="page" aria-label="家族の情報を読み込んでいます"><PageHeader eyebrow={ja.states.loading} title="最新の情報を読み込んでいます" description="読み込みが終わるまで、変更はできません。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/></div></div> : children}</main>
      {!unauthenticated && !loading && (can('event.create') || can('task.create') || can('memo.create') || can('expense.create')) && <QuickCreate/>}
      <nav className="mobile-nav" aria-label="モバイルの主な機能">{mobilePrimary.map((item) => <a key={item.href} href={item.href} data-link aria-current={isCurrent(path,item.href) ? 'page' : undefined}><item.icon/><span>{item.label}</span></a>)}<button type="button" data-control-id="navigation.more" aria-expanded={more} onClick={() => setMore(!more)}><MoreIcon/><span>{ja.navigation.more}</span></button></nav>
      {more && <div className="mobile-more">{available.filter((item) => !mobilePrimary.some((mobile) => mobile.href === item.href)).map((item) => <a key={item.href} href={item.href} data-link onClick={() => setMore(false)}><item.icon width="20"/>{item.label}</a>)}{auditSurface && <a href={auditPath} data-link onClick={() => setMore(false)}><SparkIcon width="20"/>内部監査</a>}</div>}
    </div>
    {search && <SearchOverlay onClose={() => setSearch(false)}/>} 
    {notificationsOpen && <Drawer eyebrow="通知一覧" title="通知" onClose={() => setNotificationsOpen(false)}><div className="stack">{notificationsError && <div className="notice error" role="alert"><strong>{notificationsError}</strong><button className="button mt-1" type="button" onClick={() => void loadNotifications()}>もう一度読み込む</button></div>}{notifications.length === 0 && !notificationsError ? <p className="muted">新しい通知はありません。</p> : notifications.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.status === 'stopped' ? 'neutral' : item.status === 'snoozed' ? 'attention' : 'success'}>{item.status === 'active' ? formatTime(item.remindAt) : notificationStatusLabels[item.status]}</StatusBadge>{!item.read && <StatusBadge tone="attention">{ja.states.unread}</StatusBadge>}</div><h3>{item.title}</h3><p className="muted">{item.body}</p><p className="small muted">通知予定：{formatTime(item.remindAt)}</p><div className="grid two">{!item.read && <button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'read')}>既読にする</button>}{item.status !== 'stopped' ? <><button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'snooze')}>{notificationBusy === `${item.id}:snooze` ? '変更中…' : '30分後に通知'}</button><button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'stop')}>{notificationBusy === `${item.id}:stop` ? '停止中…' : '通知を停止'}</button></> : <button className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'resume')}>通知を再開</button>}</div></article>)}</div></Drawer>}
    {queueOpen && <Drawer eyebrow="オフライン時に保存" title="未送信の変更" onClose={() => setQueueOpen(false)}><p className="muted">送信する内容を確認してください。接続が戻っても自動では送信しません。</p><div className="stack">{pendingCommands.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.state === 'pending' ? 'attention' : 'danger'}>{item.state === 'pending' ? '未送信' : item.state === 'conflicted' ? '内容の確認が必要' : '権限の確認が必要'}</StatusBadge><span className="small muted">保存後24時間まで</span></div><h3>{item.summary}</h3><div className="grid two"><button className="button primary" type="button" onClick={() => void retryQueued(item.id)}>この変更を送信</button><button className="button" type="button" onClick={() => void discardQueued(item.id)}>削除</button></div></article>)}<button className="button primary full" type="button" onClick={() => void retryQueued()}>すべて送信</button></div></Drawer>}
  </div>;
}
