import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Dialog, PageHeader, StatusBadge, formatTime } from '../../design-system/components';
import { ArrowIcon, LinkIcon, LockIcon, PeopleIcon, ShieldIcon } from '../../design-system/icons';
import { passwordSchema, safeHttpsUrlSchema } from '../../domain/schemas';
import type { HouseholdInvite, HouseholdMembership, HouseholdNotification, MembershipRole, NotificationPreferences, SecurityOverview } from '../../domain/types';

const tabs = [
  ['/settings/household','世帯'],['/settings/security','セキュリティ'],['/settings/notifications','通知'],['/settings/accessibility','表示・操作'],['/settings/resources','リソース'],
] as const;

export function SettingsPage({ path }: { path: string }) {
  const { theme, setTheme } = useApp();
  const current = tabs.find(([href]) => path.startsWith(href))?.[1] ?? '世帯';
  const [reduced, setReducedState] = useState(() => localStorage.getItem('family-hub-reduced-motion') === 'true');
  const setReduced = (value: boolean) => { setReducedState(value); document.documentElement.dataset.reduceMotion = String(value); localStorage.setItem('family-hub-reduced-motion', String(value)); };
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(reduced); }, [reduced]);
  return <div className="page">
    <PageHeader eyebrow="Settings" title={current} description="家族の共有範囲と、自分の使い心地を分けて管理します。"/>
    <nav className="segmented settings-tabs" aria-label="設定カテゴリ">
      {tabs.map(([href,label]) => <a key={href} className="button" href={href} data-link aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</a>)}
    </nav>
    {path.startsWith('/settings/security') ? <Security/> : path.startsWith('/settings/notifications') ? <Notifications/> : path.startsWith('/settings/accessibility') ? <Accessibility theme={theme} setTheme={setTheme} reduced={reduced} setReduced={setReduced}/> : path.startsWith('/settings/resources') ? <Resources/> : <Household/>}
  </div>;
}

function Household() {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [member, setMember] = useState<HouseholdMembership | null>(null);
  const [role, setRole] = useState<MembershipRole>('adult');
  const [roleError, setRoleError] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<MembershipRole,'owner'>>('adult');
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);
  const saveRole = async () => {
    if (!member) return;
    const result = await gateway.household.updateMembershipRole(member.id, role, member.version);
    if (!result.ok) { setRoleError(result.error.message); return; }
    await refresh(); setMember(null); announce(`${result.value.displayName}の権限を${result.value.role}に変更しました`);
  };
  const createInvite = async () => {
    const result = await gateway.household.createInvite(inviteRole);
    if (!result.ok) return announce(result.error.message);
    setInvite(result.value); announce('1回限りの招待を作成しました');
  };
  const copyInvite = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.token); announce('招待コードをコピーしました'); }
    catch { announce('コピーできませんでした。表示中のコードを選択してください'); }
  };
  return <><div className="grid two"><section className="card"><p className="eyebrow">Household</p><h2>{snapshot.household.name}</h2><p className="muted">タイムゾーン · Asia/Tokyo</p><ul className="list">{snapshot.memberships.map((item) => <li className="list-row" key={item.id}><span className="avatar" style={{ background: item.color }} aria-hidden="true">{item.displayName.slice(0,1)}</span><div className="row-main"><strong>{item.displayName}</strong><span className="meta">{item.role} · {item.status}</span></div><button className="button" type="button" onClick={() => { setMember(item); setRole(item.role); setRoleError(''); }}>権限</button></li>)}</ul></section><section className="card"><p className="eyebrow">Invite</p><h2>家族を招待</h2><p>招待には期限と利用回数があります。URLを知っているだけでは、世帯の情報へ入れません。</p><div className="field"><label htmlFor="invite-role">役割</label><select className="select" id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<MembershipRole,'owner'>)}><option value="adult">大人</option><option value="child">子ども</option><option value="guest">ゲスト</option></select></div><button className="button primary full mt-1" type="button" onClick={() => void createInvite()}><PeopleIcon width="18"/>1回限りの招待を作る</button><p className="small muted mt-1">有効期間24時間 · 利用1回 · 管理者がいつでも失効可能</p>{invite && <div className="notice invite-result" role="status"><strong>今回だけ表示する招待コード</strong><code>{invite.token}</code><span className="small">期限 {formatTime(invite.expiresAt)} · 残り{invite.remainingUses}回</span><button className="button" type="button" onClick={() => void copyInvite()}>コードをコピー</button></div>}</section></div>
    {member && <Dialog title={`${member.displayName}の権限`} description="サーバー側でも現在の操作者と世帯のowner数を検証します。" onClose={() => setMember(null)}><div className="stack"><label className="field"><span>役割</span><select className="select" value={role} onChange={(event) => setRole(event.target.value as MembershipRole)}><option value="owner">owner</option><option value="adult">adult</option><option value="child">child</option><option value="guest">guest</option></select></label>{roleError && <p className="field-error" role="alert">{roleError}</p>}<div className="dialog-actions"><button className="button" type="button" onClick={() => setMember(null)}>キャンセル</button><button className="button primary" type="button" onClick={() => void saveRole()}>権限を保存</button></div></div></Dialog>}</>;
}

function Security() {
  const { gateway, announce } = useApp();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [revoke, setRevoke] = useState<string | null>(null);
  const load = async () => { const result = await gateway.auth.getSecurityOverview(); if (result.ok) setOverview(result.value); else announce(result.error.message); };
  useEffect(() => { let active = true; void gateway.auth.getSecurityOverview().then((result) => { if (!active) return; if (result.ok) setOverview(result.value); else announce(result.error.message); }); return () => { active = false; }; }, [gateway, announce]);
  const addPasskey = async () => {
    const begun = await gateway.auth.beginPasskeyRegistration(); if (!begun.ok) return announce(begun.error.message);
    const credential = await gateway.credentials.create(begun.value.publicKey); if (!credential.ok) return announce(credential.error.message);
    const finished = await gateway.auth.finishPasskeyRegistration(begun.value.challengeId, credential.value); if (!finished.ok) return announce(finished.error.message);
    await load(); announce('デモ用パスキーを追加しました。認証情報はWeb Storageへ保存していません');
  };
  const changePassword = async (form: HTMLFormElement) => {
    setPasswordError(''); const values = new FormData(form);
    const current = String(values.get('current')); const next = String(values.get('next')); const confirm = String(values.get('confirm'));
    if (next !== confirm) { setPasswordError('新しいパスワードと確認入力が一致しません。'); return; }
    const parsed = passwordSchema.safeParse(next); if (!parsed.success) { setPasswordError(parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。'); return; }
    const result = await gateway.auth.changePassword(current, next); if (!result.ok) { setPasswordError(result.error.message); return; }
    form.reset(); setPasswordOpen(false); announce('パスワードを変更しました。入力内容は破棄しました');
  };
  const revokeSession = async () => {
    if (!revoke) return; const result = await gateway.auth.revokeSession(revoke); if (!result.ok) return announce(result.error.message);
    setRevoke(null); await load(); announce('指定したセッションだけを終了しました');
  };
  return <><div className="grid two"><section className="card accent"><ShieldIcon width="30"/><p className="eyebrow">Recommended</p><h2>パスキー</h2><p>端末の画面ロックを使って、フィッシングに強い方法で本人確認します。</p>{overview?.authenticators.map((item) => <div className="setting-row" key={item.id}><div><strong>{item.label}</strong><p className="small muted mb-0">{item.demo ? '参照フロントのデモ登録' : '登録済みパスキー'}</p></div><StatusBadge tone="success">有効</StatusBadge></div>)}<button className="button full" type="button" onClick={() => void addPasskey()}>別のパスキーを追加</button><p className="small muted mt-1">mockではデモ登録です。HTTP経路はsecure context上のWebAuthn ceremonyを要求します。</p></section><section className="card"><LockIcon width="30"/><p className="eyebrow">Fallback</p><h2>パスワード</h2><p>15文字以上、最大64文字。文字種の強制や定期変更は求めません。既知の漏えい値は理由を示して拒否します。</p><button className="button full" type="button" onClick={() => setPasswordOpen(true)}>パスワードを変更</button></section><section className="card"><h2>セッション</h2><ul className="list">{overview?.sessions.map((session) => <li className="list-row" key={session.id}><span className="status-dot" style={{ color: session.current ? 'var(--success)' : undefined }}/><div className="row-main"><strong>{session.label}</strong><span className="meta">{session.location} · {session.current ? 'いま使用中' : '2時間前'}</span></div>{session.current ? <StatusBadge tone="success">現在</StatusBadge> : <button className="button danger" type="button" onClick={() => setRevoke(session.id)}>終了</button>}</li>)}</ul></section><section className="card"><h2>サーバー側の必須契約</h2><p className="muted">この参照フロントだけでは成立しない制御です。</p><ul><li><code>__Host-</code> Secure / HttpOnly / SameSite Cookie</li><li>CSRF token + Origin + Fetch Metadata</li><li>セッションIDのローテーションと失効</li><li>認証情報をWeb Storageへ保存しない</li></ul></section></div>
    {passwordOpen && <Dialog title="パスワードを変更" description="この画面を閉じると入力値を破棄します。" onClose={() => { setPasswordOpen(false); setPasswordError(''); }}><form className="stack" onSubmit={(event) => { event.preventDefault(); void changePassword(event.currentTarget); }}><label className="field"><span>現在のパスワード</span><input className="input" name="current" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード</span><input className="input" name="next" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード（確認）</span><input className="input" name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label>{passwordError && <p className="field-error" role="alert">{passwordError}</p>}<div className="dialog-actions"><button className="button" type="button" onClick={() => setPasswordOpen(false)}>キャンセル</button><button className="button primary" type="submit">変更する</button></div></form></Dialog>}
    {revoke && <Dialog title="このセッションを終了しますか" description="現在使用中のブラウザは終了しません。" onClose={() => setRevoke(null)} actions={<><button className="button" type="button" onClick={() => setRevoke(null)}>キャンセル</button><button className="button danger" type="button" onClick={() => void revokeSession()}>セッションを終了</button></>}/>}</>;
}

function Notifications() {
  const { gateway, announce } = useApp();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [notifications, setNotifications] = useState<HouseholdNotification[]>([]);
  const [preview, setPreview] = useState(true);
  const load = async () => { const [prefs, list] = await Promise.all([gateway.notifications.getPreferences(), gateway.notifications.list()]); if (prefs.ok) setPreferences(prefs.value); if (list.ok) setNotifications(list.value); };
  useEffect(() => { let active = true; void Promise.all([gateway.notifications.getPreferences(), gateway.notifications.list()]).then(([prefs, list]) => { if (!active) return; if (prefs.ok) setPreferences(prefs.value); if (list.ok) setNotifications(list.value); }); return () => { active = false; }; }, [gateway]);
  const toggle = async (key: keyof NotificationPreferences) => {
    if (!preferences) return; const result = await gateway.notifications.updatePreferences({ [key]: !preferences[key] });
    if (!result.ok) return announce(result.error.message); setPreferences(result.value); announce('通知設定を保存しました');
  };
  const notice = notifications[0];
  return <div className="grid two"><section className="card"><h2>リマインダー</h2>{preferences && <><div className="setting-row"><div><strong>Todoの期限</strong><p className="small muted mb-0">期限の30分前</p></div><button type="button" className="toggle" aria-label="Todo期限の通知" aria-pressed={preferences.todoDue} onClick={() => void toggle('todoDue')}/></div><div className="setting-row"><div><strong>予定の出発時刻</strong><p className="small muted mb-0">移動時間を含めて表示</p></div><button type="button" className="toggle" aria-label="出発時刻の通知" aria-pressed={preferences.eventDeparture} onClick={() => void toggle('eventDeparture')}/></div><div className="setting-row"><div><strong>夜間は停止</strong><p className="small muted mb-0">21:00〜7:00</p></div><button type="button" className="toggle" aria-label="夜間停止" aria-pressed={preferences.quietHours} onClick={() => void toggle('quietHours')}/></div></>}</section><section className="card"><div className="section-head"><h2>通知プレビュー</h2><button className="button" type="button" onClick={() => setPreview(!preview)}>{preview ? '隠す' : '表示'}</button></div>{preview && notice && <div className="card flat"><StatusBadge>{notice.status === 'stopped' ? '停止済み' : formatTime(notice.remindAt)}</StatusBadge><h3 className="mt-1">{notice.title}</h3><p className="muted">{notice.body}</p><div className="grid two"><button className="button" type="button" disabled={notice.status === 'stopped'} onClick={async () => { const result = await gateway.notifications.snooze(notice.id, 30); if (!result.ok) return announce(result.error.message); await load(); announce('通知を30分延期しました'); }}>30分延期</button><button className="button" type="button" disabled={notice.status === 'stopped'} onClick={async () => { const result = await gateway.notifications.stop(notice.id); if (!result.ok) return announce(result.error.message); await load(); announce('この通知を停止しました'); }}>この通知を停止</button></div></div>}<p className="small muted mt-1">通知は「いつ・何をする」を示し、延期と停止の経路を常に提供します。</p></section></div>;
}

function Accessibility({ theme, setTheme, reduced, setReduced }: { theme: 'light'|'dusk'; setTheme: (value: 'light'|'dusk') => void; reduced: boolean; setReduced: (value: boolean) => void }) {
  return <div className="grid two"><section className="card"><h2>テーマ</h2><div className="segmented"><button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>明るい紙面</button><button type="button" aria-pressed={theme === 'dusk'} onClick={() => setTheme('dusk')}>藍色の夕景</button></div><div className="setting-row"><div><strong>動きを減らす</strong><p className="small muted mb-0">OS設定も自動で尊重します</p></div><button type="button" className="toggle" aria-label="動きを減らす" aria-pressed={reduced} onClick={() => setReduced(!reduced)}/></div></section><section className="card"><h2>操作と読みやすさ</h2><ul><li>タッチ対象は原則44px以上</li><li>状態を色だけで表さない</li><li>200%ズームでも横スクロールなし</li><li>キーボードフォーカスを常時表示</li></ul><p className="small muted">VoiceOver + Safariの実機確認は、自動axe検査とは別に <code>evidence-pending</code> です。</p></section></div>;
}

function Resources() {
  const { snapshot } = useApp();
  return <div className="grid two">{snapshot.resources.map((resource) => { const parsed = safeHttpsUrlSchema.safeParse(resource.url); return <article className="card" key={resource.id}><div className="split"><LinkIcon width="24"/><StatusBadge>{resource.kind}</StatusBadge></div><h2>{resource.label}</h2><p className="muted wrap">{resource.url}</p>{parsed.success ? <a className="button full" href={parsed.data} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">安全な新しいタブで開く <ArrowIcon width="16"/></a> : <p className="notice error" role="alert">安全でないURLのため開けません</p>}</article>; })}</div>;
}
