import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { capabilityCeilingFor, defaultCapabilitiesFor } from '../../authz/policy';
import { externalLinkLabel, ja, membershipStatusLabels, roleLabels } from '../../content/ja';
import { Dialog, PageHeader, StatusBadge, formatDate, formatRelative, formatTime } from '../../design-system/components';
import { navigate } from '../../app/router';
import { ArrowIcon, LinkIcon, LockIcon, PeopleIcon, ShieldIcon } from '../../design-system/icons';
import { passwordSchema, safeHttpsUrlSchema } from '../../domain/schemas';
import { usePlaceLookupConsent } from '../place/PlaceField';
import { OPENPOI_ATTRIBUTION_URL, OPENPOI_TERMS_URL } from '../place/openPoi';
import type { Capability, HouseholdInvite, HouseholdMembership, MembershipRole, NotificationPreferences, PermissionOverride, SecurityOverview } from '../../domain/types';

/** 設定のタブと、その表示に必要な能力。経路の許可（App.tsx）とタブの表示はこの表だけを参照する。 */
export const settingsTabs: ReadonlyArray<{ href: string; label: string; capability: Capability }> = [
  { href: '/settings/household', label: '家族', capability: 'household.members.read' },
  { href: '/settings/security', label: 'サインインとセキュリティ', capability: 'settings.own' },
  { href: '/settings/privacy', label: '共有とプライバシー', capability: 'settings.own' },
  { href: '/settings/notifications', label: '通知', capability: 'notification.manage' },
  { href: '/settings/location', label: ja.place.settings.tab, capability: 'place.read' },
  { href: '/settings/accessibility', label: '表示・操作', capability: 'settings.own' },
  { href: '/settings/resources', label: '関連リンク', capability: 'resource.read' },
];
export const settingsTabFor = (path: string) => settingsTabs.find((tab) => path === tab.href || path.startsWith(`${tab.href}/`));
const inviteRoles: Array<Exclude<MembershipRole, 'owner'>> = ['adult', 'child', 'guest'];

export function SettingsPage({ path }: { path: string }) {
  const { theme, setTheme, can } = useApp();
  const current = settingsTabFor(path)?.label ?? '';
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
      {settingsTabs.filter((tab) => can(tab.capability)).map(({ href, label }) => <a data-control-id={`settings.section.${href.split("/").at(-1)}`} key={href} className="button" href={href} data-link aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</a>)}
    </nav>
    {path.startsWith('/settings/security') ? <Security/>
      : path.startsWith('/settings/privacy') ? <Privacy/>
      : path.startsWith('/settings/notifications') ? <Notifications/>
        : path.startsWith('/settings/location') ? <LocationPrivacy/>
        : path.startsWith('/settings/accessibility') ? <Accessibility theme={theme} setTheme={setTheme} reduced={reduced} setReduced={setReduced}/>
          : path.startsWith('/settings/resources') ? <Resources/>
            : path.startsWith('/settings/household') ? <Household/>
              : null}
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
    if (!invite?.token) return;
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

  const renameHousehold = async (form: HTMLFormElement) => {
    const name = String(new FormData(form).get('householdName') ?? '');
    const result = await gateway.household.updateProfile({ name });
    if (!result.ok) { announce(result.error.message); return; }
    await refresh(); announce(`家族グループの名前を「${result.value.name}」にしました。`);
  };
  return <>
    {canManage && <section className="card household-profile"><h2>家族グループの名前</h2><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void renameHousehold(event.currentTarget); }}><label className="field"><span>名前</span><input data-control-id="settings.household.name" className="input" name="householdName" required maxLength={40} defaultValue={snapshot.household.name} key={snapshot.household.name}/></label><button data-control-id="settings.household.name-save" className="button" type="submit">名前を保存</button></form><p className="small muted mb-0">日時は日本時間で表示します。</p></section>}
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
        {invite && <div className="notice invite-result" role="status"><strong>この画面でのみ表示する招待コード</strong><code>{invite.token}</code><span className="small">有効期限：{formatDate(invite.expiresAt)} {formatTime(invite.expiresAt)} · 残り{invite.remainingUses}回</span><button data-control-id="settings.invite.copy" className="button" type="button" onClick={() => void copyInvite()}>招待コードをコピー</button></div>}
        <h3 className="mt-1">作成した招待</h3>
        {invites.length === 0 ? <p className="muted small">使用できる招待コードはありません。</p> : <ul className="list">{invites.map((item) => <li className="list-row" key={item.id}><div className="row-main"><strong>{roleLabels[item.role]}として招待</strong><span className="meta">{item.revokedAt ? '無効' : `残り${item.remainingUses}回 · ${`${formatDate(item.expiresAt)} ${formatTime(item.expiresAt)}`}まで`}</span></div>{!item.revokedAt && <button data-control-id={`settings.invite.revoke.${item.id}`} className="button danger" type="button" onClick={async () => {
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
  const { gateway, announce, snapshot } = useApp();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    const result = await gateway.auth.signOut();
    if (!result.ok) { announce(result.error.message); return; }
    setSigningOut(false); navigate('/welcome'); announce('この端末からサインアウトしました。');
  };
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
      <section className="card"><h2>サインイン中の端末</h2><ul className="list">{overview?.sessions.map((session) => <li className="list-row" key={session.id}><span className="status-dot" style={{ color: session.current ? 'var(--success)' : undefined }}/><div className="row-main"><strong>{session.label}</strong><span className="meta">{session.location} · {session.current ? 'この端末' : `最終利用：${formatRelative(session.lastSeenAt, snapshot.context.asOf)}`}</span></div>{session.current ? <StatusBadge tone="success">利用中</StatusBadge> : <button data-control-id={`settings.session.revoke-open.${session.id}`} className="button danger" type="button" onClick={() => setRevoke(session.id)}>サインアウト</button>}</li>)}</ul></section>
      <section className="card"><h2>この端末からサインアウト</h2><p>共用の端末や、しばらく使わない端末では、使い終わったらサインアウトしてください。次回の利用時には、もう一度本人確認が必要です。</p><button data-control-id="settings.session.sign-out-current" className="button full" type="button" onClick={() => setSigningOut(true)}>この端末からサインアウト</button><p className="small muted mt-1 mb-0">紛失した端末は、左の一覧から個別にサインアウトできます。</p></section>
    </div>
    {passwordOpen && <Dialog title="パスワードを変更" description="この画面を閉じると、入力中のパスワードは消去されます。" onClose={() => { setPasswordOpen(false); setPasswordError(''); }}><form className="stack" onSubmit={(event) => { event.preventDefault(); void changePassword(event.currentTarget); }}><label className="field"><span>現在のパスワード</span><input data-control-id="settings.password.current" className="input" name="current" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード</span><input data-control-id="settings.password.new" className="input" name="next" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label><label className="field"><span>新しいパスワード（確認）</span><input data-control-id="settings.password.confirm" className="input" name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></label>{passwordError && <p className="field-error" role="alert">{passwordError}</p>}<div className="dialog-actions"><button data-control-id="settings.password.cancel" className="button" type="button" onClick={() => setPasswordOpen(false)}>{ja.actions.cancel}</button><button data-control-id="settings.password.submit" className="button primary" type="submit">変更する</button></div></form></Dialog>}
    {signingOut && <Dialog title="この端末からサインアウトしますか" description="未送信の変更があれば、この端末に残ります。もう一度サインインすると送信できます。" onClose={() => setSigningOut(false)} actions={<><button data-control-id="settings.session.sign-out-cancel" className="button" type="button" onClick={() => setSigningOut(false)}>{ja.actions.cancel}</button><button data-control-id="settings.session.sign-out-confirm" className="button danger" type="button" onClick={() => void signOut()}>サインアウト</button></>}/>}
    {revoke && <Dialog title="この端末からサインアウトしますか" description="現在使用中の端末はサインアウトされません。" onClose={() => setRevoke(null)} actions={<><button data-control-id="settings.session.revoke-cancel" className="button" type="button" onClick={() => setRevoke(null)}>{ja.actions.cancel}</button><button data-control-id="settings.session.revoke-confirm" className="button danger" type="button" onClick={() => void revokeSession()}>サインアウト</button></>}/>}
  </>;
}

function LocationPrivacy() {
  const { announce } = useApp();
  const consent = usePlaceLookupConsent();
  const [saving, setSaving] = useState(false);
  const granted = consent.status === 'granted';
  const toggle = async () => {
    if (saving || consent.status === 'loading' || consent.status === 'unavailable') return;
    setSaving(true);
    const result = granted ? await consent.revoke() : await consent.grant();
    setSaving(false);
    announce(result.ok ? (granted ? ja.place.settings.consentRevoked : ja.place.settings.consentGranted) : ja.place.failures['consent-failed']);
  };
  return <div className="grid two">
    <section className="card"><h2>{ja.place.settings.title}</h2><p className="muted">{ja.place.settings.description}</p>
      <dl className="place-disclosure">{ja.place.settings.rows.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
    </section>
    <section className="card"><h2>{ja.place.settings.consentLabel}</h2>
      <div className="setting-row"><div><strong>{granted ? ja.place.settings.consentOn : ja.place.settings.consentOff}</strong><p className="small muted mb-0">{ja.place.settings.revokeNote}</p></div><button data-control-id="settings.location.lookup-consent" type="button" className="toggle" aria-label={ja.place.settings.consentLabel} aria-pressed={granted} disabled={saving || consent.status === 'loading' || consent.status === 'unavailable'} onClick={() => void toggle()}/></div>
      <ul className="list">
        <li className="list-row"><LinkIcon width="20"/><div className="row-main"><a data-control-id="settings.location.terms" href={OPENPOI_TERMS_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={externalLinkLabel(ja.place.settings.terms)}>{ja.place.settings.terms}</a></div></li>
        <li className="list-row"><LinkIcon width="20"/><div className="row-main"><a data-control-id="settings.location.attribution" href={OPENPOI_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={externalLinkLabel(ja.place.settings.attribution)}>{ja.place.settings.attribution}</a></div></li>
      </ul>
    </section>
  </div>;
}

function Notifications() {
  const { gateway, announce, privacy } = useApp();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    let mounted = true;
    void gateway.notifications.getPreferences().then((result) => { if (mounted && result.ok) setPreferences(result.value); });
    return () => { mounted = false; };
  }, [gateway]);
  const toggle = async (key: keyof NotificationPreferences) => {
    if (!preferences) return;
    const result = await gateway.notifications.updatePreferences({ [key]: !preferences[key] });
    if (!result.ok) { announce(result.error.message); return; }
    setPreferences(result.value); announce('通知設定を保存しました。');
  };
  const rows: Array<[keyof NotificationPreferences, string, string, string]> = [
    ['todoDue', 'タスクの期限', '期限の30分前に通知', 'タスクの期限を通知'],
    ['eventDeparture', '予定の出発時刻', '移動時間を含めた出発時刻を通知', '予定の出発時刻を通知'],
    ['quietHours', '夜間は通知しない', '21:00から翌朝7:00までの通知は、7:00にまとめて届けます', '夜間は通知しない'],
  ];
  const hidden = privacy?.hideNotificationContent ?? true;
  return <div className="grid two">
    <section className="card"><h2>通知する内容</h2>{preferences && rows.map(([key, title, description, label]) => <div className="setting-row" key={key}><div><strong>{title}</strong><p className="small muted mb-0">{description}</p></div><button data-control-id={`settings.notifications.${key === 'todoDue' ? 'todo-due' : key === 'eventDeparture' ? 'event-departure' : 'quiet-hours'}`} type="button" className="toggle" aria-label={label} aria-pressed={preferences[key]} onClick={() => void toggle(key)}/></div>)}<p className="small muted mt-1 mb-0">通知を受け取ったら、上部のベルから既読・延期・停止を選べます。</p></section>
    <section className="card"><h2>通知の表示例</h2><p className="small muted">見本です。実際の通知は変わりません。</p><div className="card flat notification-sample" aria-label="通知の見本"><StatusBadge tone="success">18:00</StatusBadge>{hidden ? <><h3 className="mt-1">タスクのお知らせ</h3><p className="muted mb-0">内容は表示しない設定です。開くと題名と内容を確認できます。</p></> : <><h3 className="mt-1">図書館の本を返す</h3><p className="muted mb-0">18:00まで・担当：碧さん</p></>}</div><p className="small muted mt-1 mb-0">題名や内容を表示するかどうかは「共有とプライバシー」で変えられます。</p></section>
  </div>;
}

/** 共有の初期値と、通知に内容を表示するかどうか。保存は AppContext 経由で、別の画面の変更を上書きしない。 */
function Privacy() {
  const { privacy: saved, updatePrivacy, announce } = useApp();
  const [saving, setSaving] = useState(false);
  // 操作をすぐ画面に反映し、保存に失敗したら保存済みの値へ戻す。
  const [draft, setDraft] = useState<Partial<NonNullable<typeof saved>>>({});
  const privacy = saved ? { ...saved, ...draft } : null;
  const save = async (patch: Parameters<typeof updatePrivacy>[0], message: string) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaving(true);
    const result = await updatePrivacy(patch);
    setSaving(false);
    setDraft({});
    announce(result.ok ? message : result.error.message);
  };
  if (!privacy) return <div className="grid two" aria-busy="true"><div className="skeleton"/><div className="skeleton"/></div>;
  return <div className="grid two">
    <section className="card"><h2>新しく作る予定・タスク・メモの共有範囲</h2><p className="muted">あとから作るものに使う初期値です。作成済みのものは変わりません。</p>
      <fieldset className="fieldset" disabled={saving}><legend>共有範囲の初期値</legend>
        {(['household', 'creator'] as const).map((value) => <label className="check-row" key={value}><input data-control-id={`settings.privacy.audience.${value}`} type="radio" name="defaultAudience" value={value} checked={privacy.defaultAudience === value} onChange={() => void save({ defaultAudience: value }, `共有範囲の初期値を「${value === 'household' ? '家族全員' : '作成した本人だけ'}」にしました。`)}/>{value === 'household' ? '家族全員（子どもメンバーには、本人に関係するものだけ）' : '作成した本人だけ'}</label>)}
      </fieldset>
    </section>
    <section className="card"><h2>通知の内容</h2><div className="setting-row"><div><strong>通知の題名と内容を表示しない</strong><p className="small muted mb-0">ほかの人に画面を見られても、予定やタスクの中身が分からないようにします。開いたときだけ表示します。</p></div><button data-control-id="settings.privacy.hide-notification-content" type="button" className="toggle" aria-label="通知の題名と内容を表示しない" aria-pressed={privacy.hideNotificationContent} disabled={saving} onClick={() => void save({ hideNotificationContent: !privacy.hideNotificationContent }, privacy.hideNotificationContent ? '通知の題名と内容を表示するようにしました。' : '通知の題名と内容を表示しないようにしました。')}/></div></section>
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
  const target = decodeURIComponent(window.location.hash.slice(1));
  // 検索や予定から開いたときは、対象のリンクへ移動して示す。
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(target);
    element?.scrollIntoView({ block: 'center' });
    element?.focus();
  }, [target]);
  return <div className="grid two">{snapshot.resources.map((resource) => {
    const parsed = safeHttpsUrlSchema.safeParse(resource.url);
    return <article className={`card${resource.id === target ? ' is-target' : ''}`} key={resource.id} id={resource.id} tabIndex={-1}>
      <div className="split"><LinkIcon width="24"/><StatusBadge>{ja.resourceKinds[resource.kind]}</StatusBadge></div>
      <h2>{resource.label}</h2><p className="muted wrap">{resource.url}</p>
      {parsed.success ? <a data-control-id={`settings.resource.open.${resource.id}`} className="button full" href={parsed.data} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{externalLinkLabel(resource.label)} <ArrowIcon width="16"/></a> : <p className="notice error" role="alert">このリンクは開けません。管理者にリンク先の確認を依頼してください。</p>}
    </article>;
  })}</div>;
}
