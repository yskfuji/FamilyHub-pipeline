import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren, type ReactNode } from 'react';
import { useApp } from './AppContext';
import { Brand, Drawer, EmptyState, PageHeader, StatusBadge, formatTime } from '../design-system/components';
import { filterTasks } from '../domain/taskList';
import type { HouseholdNotification } from '../domain/types';
import { BellIcon, CalendarIcon, CheckIcon, EyeIcon, HomeIcon, ImageIcon, MapPinIcon, MoonIcon, MoreIcon, NoteIcon, SearchIcon, SettingsIcon, SparkIcon, SunIcon, YenIcon } from '../design-system/icons';
import { QuickCreate } from './QuickCreate';
import type { Capability } from '../domain/types';
import { ja, notificationStatusLabels, roleLabels } from '../content/ja';
import { auditPath, auditSurface } from '@audit-surface';
import { setDevicePreferences, useDevicePreferences } from './devicePreferences';
import { useNewVersion } from './useNewVersion';
import { BOTTOM_NAV_QUERY, useSizeClass } from '../design-system/sizeClass';
import { markReady } from './routeLoading';
import { watchFocusInScrollers } from '../design-system/revealFocus';

/** 検索は開いたときに読む。 */
const SearchOverlay = lazy(async () => ({ default: (await import('./SearchOverlay')).SearchOverlay }));

/** match を持つ項目は、その接頭辞の下のどの画面でも現在地として示す（設定の各タブなど）。 */
const primary: Array<{ href: string; label: string; icon: (props: any) => ReactNode; capability?: Capability; match?: string }> = [
  { href: '/today', label: ja.navigation.today, icon: HomeIcon },
  { href: '/calendar', label: ja.navigation.calendar, icon: CalendarIcon, capability: 'event.read' },
  { href: '/tasks', label: ja.navigation.tasks, icon: CheckIcon, capability: 'task.read' },
  { href: '/notes', label: ja.navigation.notes, icon: NoteIcon, capability: 'memo.read' },
  { href: '/budget', label: ja.navigation.budget, icon: YenIcon, capability: 'expense.read' },
  { href: '/albums', label: ja.navigation.albums, icon: ImageIcon, capability: 'album.read' },
  { href: '/places', label: ja.navigation.places, icon: MapPinIcon, capability: 'place.read' },
  { href: '/insights', label: ja.navigation.insights, icon: SparkIcon, capability: 'insight.read' },
  { href: '/settings', label: ja.navigation.settings, icon: SettingsIcon, capability: 'settings.own', match: '/settings' },
];

function isCurrent(path: string, href: string) { return path === href || path.startsWith(`${href}/`); }
/** 未完了の数。読み上げでは「未完了3件」と伝える。 */
function NavCount({ count }: { count: number }) {
  if (!count) return null;
  return <span className="nav-count"><span aria-hidden="true">{count}</span><span className="sr-only">未完了{count}件</span></span>;
}
function NavAnchor({ href, label, icon: Icon, path, match, count = 0 }: { href: string; label: string; icon: (props: any) => ReactNode; path: string; match?: string; count?: number }) {
  return <a data-control-id={`navigation.open.${href.replace(/^\//, "").replaceAll("/", ".")}`} className="nav-link" href={href} data-link aria-current={isCurrent(path, match ?? href) ? 'page' : undefined}><Icon/><span className="nav-label">{label}</span><NavCount count={count}/></a>;
}
/** 下のナビを出す幅。画面の段階（sizeClass.ts）と同じ境目で、下のナビがある間は narrow。 */
const subscribeBottomNav = (notify: () => void) => { const query = window.matchMedia(BOTTOM_NAV_QUERY); query.addEventListener('change', notify); return () => query.removeEventListener('change', notify); };
const useBottomNav = () => useSyncExternalStore(subscribeBottomNav, () => window.matchMedia(BOTTOM_NAV_QUERY).matches);

const topbarDate = (asOf: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Tokyo' }).format(new Date(asOf));

export function Shell({ path, children }: PropsWithChildren<{ path: string }>) {
  const { snapshot, loading, refreshing, error, refresh, gateway, announce, can, privacy, pendingCommands, retryQueued, discardQueued } = useApp();
  const canNotify = can('notification.manage');
  const { night } = useDevicePreferences();
  const newVersion = useNewVersion();
  const bottomNav = useBottomNav();
  // html の data-size-class を保つ（ドロワーとシートの見た目、試験の確かめに使う）。
  const sizeClass = useSizeClass();
  const openTasks = can('task.read') ? filterTasks(snapshot.todos, 'open', snapshot.viewer.membershipId).length : 0;
  // 「通知の内容を表示しない」設定のときは、題名と本文を伏せ、利用者が開いたものだけ表示する。
  const hideContent = privacy?.hideNotificationContent ?? true;
  const [revealed, setRevealed] = useState<string[]>([]);
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
  useEffect(() => { if (!canNotify) return; void (async () => { const result = await gateway.notifications.list(); if (result.ok) setNotifications(result.value); else setNotificationsError(result.error.message); })(); }, [gateway, canNotify]);
  // 画面を移ったら「その他」を閉じる（開いたまま次の画面に重ならないようにする）。
  useEffect(() => { setMore(false); }, [path]);
  // 横にスクロールする並びの中の焦点を、並びの中に全部見せる。
  useEffect(() => watchFocusInScrollers(), []);
  const unauthenticated = error?.code === 'UNAUTHENTICATED';
  // 本人確認が要るときは本文を描かないので、ここで描き終えた印を書く（読み込み中は書かない）。
  useLayoutEffect(() => { if (unauthenticated && !loading) markReady(window.location.pathname); });
  // すぐに追加は、下のナビがある幅では右下に浮かべ、レールのある幅では上部に置く（本文の上に重ならないように）。
  const quickCreate = !unauthenticated && !loading && (can('event.create') || can('task.create') || can('memo.create') || can('expense.create')) ? <QuickCreate path={path} placement={bottomNav ? 'floating' : 'topbar'}/> : null;
  const available = primary.filter((item) => !item.capability || can(item.capability));
  const mobilePrimary = available.filter((item) => ['/today','/calendar','/tasks','/notes','/budget'].includes(item.href)).slice(0, 4);
  const overflow = available.filter((item) => !mobilePrimary.some((mobile) => mobile.href === item.href));
  const overflowCurrent = overflow.find((item) => isCurrent(path, item.match ?? item.href));
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
  return <div className="app-shell" data-size-class={sizeClass}>
    <a data-control-id="navigation.skip-to-content" className="skip-link" href="#main">本文へ移動</a>
    <aside className="rail"><Brand/><nav aria-label="主な機能"><ul className="nav-list">{available.map((item) => <li key={item.href}><NavAnchor {...item} path={path} count={item.href === '/tasks' ? openTasks : 0}/></li>)}</ul></nav><div className="rail-footer">{auditSurface && <a data-control-id="navigation.audit" className="nav-link" href={auditPath} data-link aria-current={isCurrent(path, auditPath) ? 'page' : undefined}><SparkIcon/><span className="nav-label">内部監査</span></a>}<div className="identity"><span className="avatar" aria-hidden="true">{snapshot.user.displayName.slice(0, 1)}</span><span className="identity-copy"><strong>{snapshot.household.name}</strong><br/><span className="muted">{snapshot.user.displayName} · {roleLabels[snapshot.viewer.role]}</span></span></div></div></aside>
    <div className="shell-main">
      <header className="topbar"><div className="split"><span className="mobile-brand"><Brand compact/></span><div className="topbar-date"><strong>{topbarDate(snapshot.context.asOf)}</strong><br/><span>{snapshot.context.weather.location}・{snapshot.context.weather.temperatureC}℃</span></div></div><div className="topbar-actions">{pendingCommands.length > 0 && <button type="button" className="button" data-control-id="queue.open" onClick={() => setQueueOpen(true)}><span className="label">未送信の変更</span><StatusBadge tone="attention">{pendingCommands.length}</StatusBadge></button>}<button ref={searchButton} type="button" className="button" data-control-id="search.open" aria-label="検索（⌘K）" onClick={() => setSearch(true)}><SearchIcon width="18"/><span className="label">検索</span><span className="small muted">⌘K</span></button>{canNotify && <button type="button" className="icon-button notification-button" data-control-id="notifications.open" aria-label={`通知を確認、未読${notifications.filter((item) => !item.read).length}件`} onClick={async () => { await loadNotifications(); setNotificationsOpen(true); }}><BellIcon/>{notifications.some((item) => !item.read) && <span className="notification-dot" aria-hidden="true"/>}</button>}<button type="button" className="icon-button" data-control-id="settings.theme.toggle" aria-label={night ? '明るいテーマに切り替え' : '暗いテーマに切り替え'} onClick={() => setDevicePreferences({ colorMode: night ? 'day' : 'night' })}>{night ? <SunIcon/> : <MoonIcon/>}</button>{!bottomNav && quickCreate}</div></header>
      {newVersion && <div className="version-banner" role="status"><span>新しい版があります。読み込み直すと最新の内容になります。</span><button data-control-id="shell.version.reload" className="button" type="button" onClick={() => window.location.reload()}>読み込み直す</button></div>}
      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="callout" role="alert"><span className="status-dot"/><div><strong>{error.message}</strong><p className="small muted mb-0">{unauthenticated ? '本人確認が終わるまで、家族の情報は表示しません。' : '最後に取得できた情報を表示しています。'}</p></div>{error.retryable && <button data-control-id="shell.error.retry" className="button" type="button" onClick={() => void refresh()}>{ja.actions.retry}</button>}</div></div>}
      {refreshing && <div className="refresh-indicator" aria-hidden="true"/>}<main id="main" tabIndex={-1} aria-busy={loading || refreshing}>{unauthenticated ? <div className="page"><EmptyState title="本人確認が必要です" action={<a data-control-id="auth.sign-in" className="button primary" href="/auth" data-link>サインインする</a>}>家族の情報を表示するには、もう一度サインインしてください。</EmptyState></div> : loading ? <div className="page" aria-label="家族の情報を読み込んでいます"><PageHeader eyebrow={ja.states.loading} title="最新の情報を読み込んでいます" description="読み込みが終わるまで、変更はできません。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/></div></div> : children}</main>
      {bottomNav && quickCreate}
      <nav className="mobile-nav" aria-label="モバイルの主な機能">{mobilePrimary.map((item) => <a data-control-id={`navigation.mobile.${item.href.replace(/^\//, "").replaceAll("/", ".")}`} key={item.href} href={item.href} data-link aria-current={isCurrent(path,item.href) ? 'page' : undefined}><item.icon/><span>{item.label}</span>{item.href === '/tasks' && <NavCount count={openTasks}/>}</a>)}<button type="button" data-control-id="navigation.more" className={overflowCurrent ? 'is-current' : undefined} aria-haspopup="dialog" aria-expanded={more} aria-label={overflowCurrent ? `${ja.navigation.more}（表示中：${overflowCurrent.label}）` : ja.navigation.more} onClick={() => setMore(true)}><MoreIcon/><span>{ja.navigation.more}</span></button></nav>
    </div>
    {more && <Drawer eyebrow="メニュー" title={ja.navigation.more} onClose={() => setMore(false)}><nav aria-label="その他の機能"><ul className="more-list">{overflow.map((item) => <li key={item.href}><a data-control-id={`navigation.more.${item.href.replace(/^\//, "").replaceAll("/", ".")}`} className="nav-link" href={item.href} data-link aria-current={isCurrent(path, item.match ?? item.href) ? 'page' : undefined}><item.icon width="20"/><span>{item.label}</span>{item.href === '/tasks' && <NavCount count={openTasks}/>}</a></li>)}{auditSurface && <li><a data-control-id="navigation.more.audit" className="nav-link" href={auditPath} data-link><SparkIcon width="20"/><span>内部監査</span></a></li>}</ul></nav><div className="identity mt-1"><span className="avatar" aria-hidden="true">{snapshot.user.displayName.slice(0, 1)}</span><span className="identity-copy"><strong>{snapshot.household.name}</strong><br/><span className="muted">{snapshot.user.displayName} · {roleLabels[snapshot.viewer.role]}</span></span></div></Drawer>}
    {search && <Suspense fallback={null}><SearchOverlay onClose={() => setSearch(false)}/></Suspense>}
    {notificationsOpen && <Drawer eyebrow="通知一覧" title="通知" onClose={() => setNotificationsOpen(false)}><div className="stack">{notificationsError && <div className="notice error" role="alert"><strong>{notificationsError}</strong><button data-control-id="notifications.retry" className="button mt-1" type="button" onClick={() => void loadNotifications()}>もう一度読み込む</button></div>}{notifications.length === 0 && !notificationsError ? <p className="muted">新しい通知はありません。</p> : notifications.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.status === 'stopped' ? 'neutral' : item.status === 'snoozed' ? 'attention' : 'success'}>{item.status === 'active' ? formatTime(item.remindAt) : notificationStatusLabels[item.status]}</StatusBadge>{!item.read && <StatusBadge tone="attention">{ja.states.unread}</StatusBadge>}</div>{hideContent && !revealed.includes(item.id) ? <><h3>{item.kind === 'todoDue' ? 'タスクのお知らせ' : '予定のお知らせ'}</h3><p className="muted">内容は表示しない設定です。</p><button data-control-id={`notifications.reveal.${item.id}`} className="button mb-1" type="button" onClick={() => setRevealed((ids) => [...ids, item.id])}><EyeIcon width="17"/>内容を表示</button></> : <><h3>{item.title}</h3><p className="muted">{item.body}</p></>}<p className="small muted">通知予定：{formatTime(item.remindAt)}</p><a data-control-id={`notifications.open-target.${item.id}`} className="button mb-1" href={item.destination} data-link onClick={() => setNotificationsOpen(false)}>{item.kind === 'todoDue' ? 'タスクを開く' : '予定を開く'}</a><div className="grid two">{!item.read && <button data-control-id={`notifications.read.${item.id}`} className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'read')}>既読にする</button>}{item.status !== 'stopped' ? <><button data-control-id={`notifications.snooze.${item.id}`} className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'snooze')}>{notificationBusy === `${item.id}:snooze` ? '変更中…' : '30分後に通知'}</button><button data-control-id={`notifications.stop.${item.id}`} className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'stop')}>{notificationBusy === `${item.id}:stop` ? '停止中…' : '通知を停止'}</button></> : <button data-control-id={`notifications.resume.${item.id}`} className="button" type="button" disabled={Boolean(notificationBusy)} onClick={() => void updateNotification(item.id, 'resume')}>通知を再開</button>}</div></article>)}</div></Drawer>}
    {queueOpen && <Drawer eyebrow="オフライン時に保存" title="未送信の変更" onClose={() => setQueueOpen(false)}><p className="muted">送信する内容を確認してください。接続が戻っても自動では送信しません。</p><div className="stack">{pendingCommands.map((item) => <article className="card flat" key={item.id}><div className="section-head"><StatusBadge tone={item.state === 'pending' ? 'attention' : 'danger'}>{item.state === 'pending' ? '未送信' : item.state === 'conflicted' ? '内容の確認が必要' : '権限の確認が必要'}</StatusBadge><span className="small muted">保存後24時間まで</span></div><h3>{item.summary}</h3><div className="grid two"><button data-control-id={`queue.retry.${item.id}`} className="button primary" type="button" onClick={() => void retryQueued(item.id)}>この変更を送信</button><button data-control-id={`queue.discard.${item.id}`} className="button" type="button" onClick={() => void discardQueued(item.id)}>削除</button></div></article>)}<button data-control-id="queue.retry-all" className="button primary full" type="button" onClick={() => void retryQueued()}>すべて送信</button></div></Drawer>}
  </div>;
}
