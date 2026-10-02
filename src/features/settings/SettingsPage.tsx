import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { capabilityCeilingFor, defaultCapabilitiesFor } from '../../authz/policy';
import { externalLinkLabel, ja, membershipStatusLabels, notificationStatusLabels, roleLabels } from '../../content/ja';
import { Dialog, PageHeader, StatusBadge, formatTime } from '../../design-system/components';
import { ArrowIcon, LinkIcon, LockIcon, PeopleIcon, ShieldIcon } from '../../design-system/icons';
import { passwordSchema, safeHttpsUrlSchema } from '../../domain/schemas';
import type { Capability, HouseholdInvite, HouseholdMembership, HouseholdNotification, MembershipRole, NotificationPreferences, PermissionOverride, SecurityOverview } from '../../domain/types';

const tabs = [
  ['/settings/household', '家族'],
  ['/settings/security', 'サインインとセキュリティ'],
  ['/settings/notifications', '通知'],
  ['/settings/accessibility', '表示・操作'],
  ['/settings/resources', '関連リンク'],
] as const;
const inviteRoles: Array<Exclude<MembershipRole, 'owner'>> = ['adult', 'child', 'guest'];

export function SettingsPage({ path }: { path: string }) {
  const { theme, setTheme, can } = useApp();
  const current = tabs.find(([href]) => path.startsWith(href))?.[1] ?? '家族';
  const [reduced, setReducedState] = useState(() => localStorage.getItem('family-hub-reduced-motion') === 'true');
  const setReduced = (value: boolean) => {
    setReducedState(value);
    document.documentElement.dataset.reduceMotion = String(value);
    localStorage.setItem('family-hub-reduced-motion', String(value));
  };
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(reduced); }, [reduced]);

  return <div className="page">
    <PageHeader eyebrow="設定" title={current} description="家族との共有範囲や、表示・通知・サインイン方法を変更できます。"/>
    <nav className="segmented settings-tabs" aria-label="設定項目">
      {tabs.filter(([href]) => href !== '/settings/household' || can('household.members.read')).map(([href, label]) => <a data-control-id={`settings.section.${href.split("/").at(-1)}`} key={href} className="button" href={href} data-link aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</a>)}
    </nav>
    {path.startsWith('/settings/security') ? <Security/>
      : path.startsWith('/settings/notifications') ? <Notifications/>
        : path.startsWith('/settings/accessibility') ? <Accessibility theme={theme} setTheme={setTheme} reduced={reduced} setReduced={setReduced}/>
          : path.startsWith('/settings/resources') ? <Resources/>
            : <Household/>}
  </div>;
}

function Household() {
  const { snapshot, gateway, refresh, announce, can } = useApp();
  const [member, setMember] = useState<HouseholdMembership | null>(null);
  const [role, setRole] = useState<MembershipRole>('adult');
  const [roleError, setRoleError] = useState('');
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [saving, setSaving] = useState(false);
  const [inviteRole, setInviteRole] = useState<Exclude<MembershipRole, 'owner'>>('adult');
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const canManage = can('household.members.manage');
  const canInvite = can('household.invites.manage');

  const loadInvites = async () => {
    if (!canInvite) return;
    const result = await gateway.household.listInvites();
    if (result.ok) setInvites(result.value);
    else announce(result.error.message);
  };
  useEffect(() => {
    let mounted = true;
    if (canInvite) void gateway.household.listInvites().then((result) => {
      if (!mounted) return;
      if (result.ok) setInvites(result.value);
      else announce(result.error.message);
    });
    return () => { mounted = false; };
  }, [canInvite, gateway, announce]);

  const openPermissions = async (item: HouseholdMembership) => {
    setMember(item); setRole(item.role); setRoleError(''); setOverrides([]);
    if (!canManage) return;
    const result = await gateway.household.getPermissionOverrides(item.id);
    if (result.ok) setOverrides(result.value);
    else setRoleError(result.error.message);
  };
  const saveRole = async () => {
    if (!member || saving) return;
    setSaving(true);
    const result = await gateway.household.updateMembershipRole(member.id, role, member.version);
    setSaving(false);
    if (!result.ok) { setRoleError(result.error.message); return; }
    await refresh(); setMember(null);
    announce(`${result.value.displayName}さんの役割を「${roleLabels[result.value.role]}」に変更しました。`);
  };
  const saveOverrides = async () => {
    if (!member || saving) return;
    setSaving(true); setRoleError('');
    const result = await gateway.household.updatePermissionOverrides(member.id, overrides, snapshot.viewer.permissionRevision);
    setSaving(false);
    if (!result.ok) { setRoleError(result.error.message); return; }
    await refresh(); setMember(null);
    announce(`${member.displayName}さんの個別設定を保存しました。`);
  };
  const resetOverrides = async () => {
    if (!member || saving) return;
    setSaving(true);
    const result = await gateway.household.resetPermissionOverrides(member.id, snapshot.viewer.permissionRevision);
    setSaving(false);
    if (!result.ok) { setRoleError(result.error.message); return; }
    setOverrides([]); await refresh(); announce('役割の標準設定に戻しました。');
  };
  const createInvite = async () => {
    const result = await gateway.household.createInvite(inviteRole);
    if (!result.ok) { announce(result.error.message); return; }
    setInvite(result.value); await loadInvites(); announce('招待コードを作成しました。');
  };
  const copyInvite = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.token); announce('招待コードをコピーしました。'); }
    catch { announce('コピーできませんでした。表示中のコードを選択してコピーしてください。'); }
  };
  const permissionLabels: Partial<Record<Capability, string>> = ja.capability;
  const editableCapabilities = member ? capabilityCeilingFor(role).filter((item) => permissionLabels[item]) : [];
  const overrideValue = (capability: Capability) => overrides.find((item) => item.capability === capability)?.effect ?? 'default';
  const changeOverride = (capability: Capability, effect: 'default' | 'allow' | 'deny') => setOverrides((current) => [
    ...current.filter((item) => item.capability !== capability),
    ...(effect === 'default' || !member ? [] : [{ membershipId: member.id, capability, effect }]),
  ]);

  return <>
    <div className="grid two">
      <section className="card">
        <p className="eyebrow">家族</p><h2>{snapshot.household.name}</h2><p className="muted">日時の表示 · 日本時間</p>
        <ul className="list">{snapshot.memberships.map((item) => <li className="list-row" key={item.id}>
          <span className="avatar" style={{ background: item.color }} aria-hidden="true">{item.displayName.slice(0, 1)}</span>
          <div className="row-main"><strong>{item.displayName}</strong><span className="meta">{roleLabels[item.role]} · {membershipStatusLabels[item.status]}</span></div>
          {canManage ? <button data-control-id={`settings.member.permissions.${item.id}`} className="button" type="button" aria-label={`${item.displayName}さんの権限を設定`} onClick={() => void openPermissions(item)}>権限を設定</button> : <StatusBadge>{roleLabels[item.role]}</StatusBadge>}
        </li>)}</ul>
        {!canManage && <p className="small muted">メンバーの権限変更と招待は、管理者だけが行えます。</p>}
      </section>
      {canInvite && <section className="card">
        <p className="eyebrow">招待</p><h2>家族を招待</h2>
        <p>招待コードは24時間以内に1回だけ使えます。招待された人は、サインイン後に共有された情報を表示できます。</p>
        <div className="field"><label htmlFor="invite-role">役割</label><select data-control-id="settings.invite.role" className="select" id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<MembershipRole, 'owner'>)}>{inviteRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></div>
        <button data-control-id="settings.invite.create" className="button primary full mt-1" type="button" onClick={() => void createInvite()}><PeopleIcon width="18"/>招待コードを作成</button>
        <p className="small muted mt-1">有効期間：24時間 · 使用回数：1回 · 管理者はいつでも無効にできます</p>
        {invite && <div className="notice invite-result" role="status"><strong>この画面でのみ表示する招待コード</strong><code>{invite.token}</code><span className="small">有効期限：{formatTime(invite.expiresAt)} · 残り{invite.remainingUses}回</span><button data-control-id="settings.invite.copy" className="button" type="button" onClick={() => void copyInvite()}>招待コードをコピー</button></div>}
        <h3 className="mt-1">作成した招待</h3>
        {invites.length === 0 ? <p className="muted small">使用できる招待コードはありません。</p> : <ul className="list">{invites.map((item) => <li className="list-row" key={item.id}><div className="row-main"><strong>{roleLabels[item.role]}として招待</strong><span className="meta">{item.revokedAt ? '無効' : `残り${item.remainingUses}回 · ${formatTime(item.expiresAt)}まで`}</span></div>{!item.revokedAt && <button data-control-id={`settings.invite.revoke.${item.id}`} className="button danger" type="button" onClick={async () => {
          const result = await gateway.household.revokeInvite(item.id);
          if (!result.ok) { announce(result.error.message); return; }
          await loadInvites(); announce('招待コードを無効にしました。');
        }}>無効にする</button>}</li>)}</ul>}
      </section>}
    </div>
    {member && <Dialog title={`${member.displayName}さんの権限`} description="役割の標準設定を基準に、必要な項目だけを個別に変更できます。" onClose={() => { if (!saving) setMember(null); }}>
      <div className="stack">
        <label className="field" htmlFor="member-role"><span>メンバーの役割</span></label><select data-control-id={`settings.member.role.${member.id}`} className="select" id="member-role" value={role} disabled={saving} onChange={(event) => { setRole(event.target.value as MembershipRole); setOverrides([]); }}>{(Object.keys(roleLabels) as MembershipRole[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>
        {role !== member.role && <div className="notice"><strong>役割を変更すると、個別設定の確認が必要です。</strong><p className="small mb-0">まず役割を保存し、もう一度この画面を開いて個別設定を確認してください。</p></div>}
        <fieldset className="fieldset" disabled={role !== member.role || saving}><legend>個別設定</legend><div className="stack">{editableCapabilities.map((capability) => <label className="setting-row" key={capability}><span><strong>{permissionLabels[capability]}</strong><span className="small muted">標準：{defaultCapabilitiesFor(role).includes(capability) ? '利用できる' : '利用できない'}</span></span><select data-control-id={`settings.member.permission.${member.id}.${capability}`} className="select permission-select" aria-label={`${permissionLabels[capability]}の個別設定`} value={overrideValue(capability)} onChange={(event) => changeOverride(capability, event.target.value as 'default' | 'allow' | 'deny')}><option value="default">役割の標準</option><option value="allow">利用を許可</option><option value="deny">利用を制限</option></select></label>)}</div></fieldset>
        {roleError && <p className="field-error" role="alert">{roleError}</p>}
        <div className="dialog-actions"><button data-control-id={`settings.member.cancel.${member.id}`} className="button" type="button" disabled={saving} onClick={() => setMember(null)}>{ja.actions.cancel}</button>{role === member.role ? <><button data-control-id={`settings.member.reset.${member.id}`} className="button" type="button" disabled={saving || overrides.length === 0} onClick={() => void resetOverrides()}>標準に戻す</button><button data-control-id={`settings.member.save-overrides.${member.id}`} className="button primary" type="button" disabled={saving} onClick={() => void saveOverrides()}>{saving ? ja.actions.saving : '個別設定を保存'}</button></> : <button data-control-id={`settings.member.save-role.${member.id}`} className="button primary" type="button" disabled={saving} onClick={() => void saveRole()}>{saving ? ja.actions.saving : '役割を保存'}</button>}</div>
      </div>
    </Dialog>}
  </>;
}

function Security() {
  const { gateway, announce } = useApp();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [revoke, setRevoke] = useState<string | null>(null);
  const load = async () => {
    const result = await gateway.auth.getSecurityOverview();
    if (result.ok) setOverview(result.value); else announce(result.error.message);
  };
  useEffect(() => {
    let mounted = true;
    void gateway.auth.getSecurityOverview().then((result) => {
      if (!mounted) return;
      if (result.ok) setOverview(result.value); else announce(result.error.message);
    });
    return () => { mounted = false; };
  }, [gateway, announce]);
  const addPasskey = async () => {
    const begun = await gateway.auth.beginPasskeyRegistration();
    if (!begun.ok) { announce(begun.error.message); return; }
    const credential = await gateway.credentials.create(begun.value.publicKey);
    if (!credential.ok) { announce(credential.error.message); return; }
    const finished = await gateway.auth.finishPasskeyRegistration(begun.value.challengeId, credential.value);
    if (!finished.ok) { announce(finished.error.message); return; }
    await load(); announce('この端末のパスキーをデモ登録しました。');
  };
  const changePassword = async (form: HTMLFormElement) => {
    setPasswordError('');
    const values = new FormData(form);
    const current = String(values.get('current'));
    const next = String(values.get('next'));
    const confirm = String(values.get('confirm'));
    if (next !== confirm) { setPasswordError('新しいパスワードと確認用の入力が一致しません。'); return; }
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) { setPasswordError(parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。'); return; }
    const result = await gateway.auth.changePassword(current, next);
    if (!result.ok) { setPasswordError(result.error.message); return; }
    form.reset(); setPasswordOpen(false); announce('パスワードを変更しました。入力内容は残していません。');
  };
  const revokeSession = async () => {
    if (!revoke) return;
    const result = await gateway.auth.revokeSession(revoke);
    if (!result.ok) { announce(result.error.message); return; }
    setRevoke(null); await load(); announce('指定した端末からサインアウトしました。');
  };

  return <>
    <div className="grid two">
      <section className="card accent"><ShieldIcon width="30"/><p className="eyebrow">おすすめ</p><h2>パスキー</h2><p>端末の画面ロックを使って本人確認します。パスワードのみを使うより、偽のサインイン画面に情報を入力するリスクを減らせます。</p>{overview?.authenticators.map((item) => <div className="setting-row" key={item.id}><div><strong>{item.label}</strong><p className="small muted mb-0">{item.demo ? 'デモ登録' : '登録済み'}</p></div><StatusBadge tone="success">利用中</StatusBadge></div>)}<button data-control-id="settings.passkey.add" className="button full" type="button" onClick={() => void addPasskey()}>別のパスキーを追加</button><p className="small muted mt-1">このデモでは実際のパスキーは登録されません。実際の利用時は、ブラウザの本人確認画面が開きます。</p></section>
      <section className="card"><LockIcon width="30"/><p className="eyebrow">別の方法</p><h2>パスワード</h2><p>15文字以上64文字以内で設定します。数字や記号を必ず混ぜる必要はありません。安全性が低いと判断されたパスワードは使用できません。</p><button data-control-id="settings.password.open" className="button full" type="button" onClick={() => setPasswordOpen(true)}>パスワードを変更</button></section>
      <section className="card"><h2>サインイン中の端末</h2><ul className="list">{overview?.sessions.map((session) => <li className="list-row" key={session.id}><span className="status-dot" style={{ color: session.current ? 'var(--success)' : undefined }}/><div className="row-main"><strong>{session.label}</strong><span className="meta">{session.location} · {session.current ? 'この端末' : '最終利用：2時間前'}</span></div>{session.current ? <StatusBadge tone="success">利用中</StatusBadge> : <button data-control-id={`settings.session.revoke-open.${session.id}`} className="button danger" type="button" onClick={() => setRevoke(session.id)}>サインアウト</button>}</li>)}</ul></section>
      <section className="card"><h2>端末を紛失したとき</h2><p>使わない端末や紛失した端末から、個別にサインアウトできます。次回の利用時には、もう一度本人確認が必要です。</p></section>
    </div>
    {passwordOpen && <Dialog title="パスワードを変更" description="この画面を閉じると、入力中のパスワードは消去されます。" onClose={() => { setPasswordOpen(false); setPasswordError(''); }}><form className="stack" onSubmit={(event) => { event.preventDefault(); void changePassword(event.currentTarget); }}><label className="field"><span>現在のパスワード</span><input data-control-id="settings.password.current" className="input" name="current" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード</span><input data-control-id="settings.password.new" className="input" name="next" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード（確認）</span><input data-control-id="settings.password.confirm" className="input" name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label>{passwordError && <p className="field-error" role="alert">{passwordError}</p>}<div className="dialog-actions"><button data-control-id="settings.password.cancel" className="button" type="button" onClick={() => setPasswordOpen(false)}>{ja.actions.cancel}</button><button data-control-id="settings.password.submit" className="button primary" type="submit">変更する</button></div></form></Dialog>}
    {revoke && <Dialog title="この端末からサインアウトしますか" description="現在使用中の端末はサインアウトされません。" onClose={() => setRevoke(null)} actions={<><button data-control-id="settings.session.revoke-cancel" className="button" type="button" onClick={() => setRevoke(null)}>{ja.actions.cancel}</button><button data-control-id="settings.session.revoke-confirm" className="button danger" type="button" onClick={() => void revokeSession()}>サインアウト</button></>}/>}
  </>;
}

function Notifications() {
  const { gateway, announce } = useApp();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [notifications, setNotifications] = useState<HouseholdNotification[]>([]);
  const [preview, setPreview] = useState(true);
  const load = async () => {
    const [prefs, list] = await Promise.all([gateway.notifications.getPreferences(), gateway.notifications.list()]);
    if (prefs.ok) setPreferences(prefs.value);
    if (list.ok) setNotifications(list.value);
  };
  useEffect(() => {
    let mounted = true;
    void Promise.all([gateway.notifications.getPreferences(), gateway.notifications.list()]).then(([prefs, list]) => {
      if (!mounted) return;
      if (prefs.ok) setPreferences(prefs.value);
      if (list.ok) setNotifications(list.value);
    });
    return () => { mounted = false; };
  }, [gateway]);
  const toggle = async (key: keyof NotificationPreferences) => {
    if (!preferences) return;
    const result = await gateway.notifications.updatePreferences({ [key]: !preferences[key] });
    if (!result.ok) { announce(result.error.message); return; }
    setPreferences(result.value); announce('通知設定を保存しました。');
  };
  const notice = notifications[0];
  return <div className="grid two">
    <section className="card"><h2>通知する内容</h2>{preferences && <><div className="setting-row"><div><strong>タスクの期限</strong><p className="small muted mb-0">期限の30分前に通知</p></div><button data-control-id="settings.notifications.todo-due" type="button" className="toggle" aria-label="タスクの期限を通知" aria-pressed={preferences.todoDue} onClick={() => void toggle('todoDue')}/></div><div className="setting-row"><div><strong>予定の出発時刻</strong><p className="small muted mb-0">移動時間を含めた出発時刻を通知</p></div><button data-control-id="settings.notifications.event-departure" type="button" className="toggle" aria-label="予定の出発時刻を通知" aria-pressed={preferences.eventDeparture} onClick={() => void toggle('eventDeparture')}/></div><div className="setting-row"><div><strong>夜間は通知しない</strong><p className="small muted mb-0">21:00から翌朝7:00まで</p></div><button data-control-id="settings.notifications.quiet-hours" type="button" className="toggle" aria-label="夜間は通知しない" aria-pressed={preferences.quietHours} onClick={() => void toggle('quietHours')}/></div></>}</section>
    <section className="card"><div className="section-head"><h2>通知の表示例</h2><button data-control-id="settings.notifications.preview" className="button" type="button" onClick={() => setPreview(!preview)}>{preview ? '閉じる' : '表示する'}</button></div>{preview && notice && <div className="card flat"><StatusBadge>{notice.status === 'active' ? formatTime(notice.remindAt) : notificationStatusLabels[notice.status]}</StatusBadge><h3 className="mt-1">{notice.title}</h3><p className="muted">{notice.body}</p><div className="grid two">{notice.status === 'stopped' ? <button data-control-id={`settings.notifications.resume.${notice.id}`} className="button" type="button" onClick={async () => {
      const result = await gateway.notifications.resume(notice.id);
      if (!result.ok) { announce(result.error.message); return; }
      await load(); announce('通知を再開しました。');
    }}>通知を再開</button> : <><button data-control-id={`settings.notifications.snooze.${notice.id}`} className="button" type="button" onClick={async () => {
      const result = await gateway.notifications.snooze(notice.id, 30);
      if (!result.ok) { announce(result.error.message); return; }
      await load(); announce('通知を30分後に変更しました。');
    }}>30分後に通知</button><button data-control-id={`settings.notifications.stop.${notice.id}`} className="button" type="button" onClick={async () => {
      const result = await gateway.notifications.stop(notice.id);
      if (!result.ok) { announce(result.error.message); return; }
      await load(); announce('この通知を停止しました。');
    }}>この通知を停止</button></>}</div></div>}<p className="small muted mt-1">通知には、期限や出発時刻と、対象の予定・タスクを表示します。後で通知するか、停止するかを選べます。</p></section>
  </div>;
}

function Accessibility({ theme, setTheme, reduced, setReduced }: { theme: 'light' | 'dusk'; setTheme: (value: 'light' | 'dusk') => void; reduced: boolean; setReduced: (value: boolean) => void }) {
  return <div className="grid two">
    <section className="card"><h2>表示テーマ</h2><div className="segmented"><button data-control-id="settings.theme.light" type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>明るいテーマ</button><button data-control-id="settings.theme.dusk" type="button" aria-pressed={theme === 'dusk'} onClick={() => setTheme('dusk')}>暗いテーマ</button></div><div className="setting-row"><div><strong>動きを減らす</strong><p className="small muted mb-0">端末の設定で動きを減らしている場合にも適用されます。</p></div><button data-control-id="settings.motion.reduce" type="button" className="toggle" aria-label="動きを減らす" aria-pressed={reduced} onClick={() => setReduced(!reduced)}/></div></section>
    <section className="card"><h2>操作と読みやすさ</h2><p>文字を大きくした場合も、項目が重なったり、操作ボタンが隠れたりしないように調整しています。</p><p className="small muted">色だけで状態を区別せず、キーボードで操作中の場所も画面に表示します。</p></section>
  </div>;
}

function Resources() {
  const { snapshot } = useApp();
  return <div className="grid two">{snapshot.resources.map((resource) => {
    const parsed = safeHttpsUrlSchema.safeParse(resource.url);
    return <article className="card" key={resource.id}>
      <div className="split"><LinkIcon width="24"/><StatusBadge>{ja.resourceKinds[resource.kind]}</StatusBadge></div>
      <h2>{resource.label}</h2><p className="muted wrap">{resource.url}</p>
      {parsed.success ? <a data-control-id={`settings.resource.open.${resource.id}`} className="button full" href={parsed.data} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{externalLinkLabel(resource.label)} <ArrowIcon width="16"/></a> : <p className="notice error" role="alert">このリンクは開けません。管理者にリンク先の確認を依頼してください。</p>}
    </article>;
  })}</div>;
}
