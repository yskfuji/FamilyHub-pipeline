import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { PageHeader, StatusBadge } from '../../design-system/components';
import { ArrowIcon, LinkIcon, LockIcon, PeopleIcon, ShieldIcon } from '../../design-system/icons';

const tabs = [
  ['/settings/household','世帯'],['/settings/security','セキュリティ'],['/settings/notifications','通知'],['/settings/accessibility','表示・操作'],['/settings/resources','リソース'],
] as const;

export function SettingsPage({ path }: { path: string }) {
  const { theme, setTheme } = useApp();
  const current = tabs.find(([href]) => path.startsWith(href))?.[1] ?? '世帯';
  const [preview, setPreview] = useState(true);
  const [reduced, setReduced] = useState(false);
  return <div className="page">
    <PageHeader eyebrow="Settings" title={current} description="家族の共有範囲と、自分の使い心地を分けて管理します。"/>
    <nav className="segmented" aria-label="設定カテゴリ" style={{ marginBottom: '1.5rem', flexWrap: 'wrap', width: '100%', borderRadius: 'var(--radius-md)' }}>
      {tabs.map(([href,label]) => <a key={href} className="button" href={href} data-link aria-current={path.startsWith(href) ? 'page' : undefined} style={{ border: 0, background: path.startsWith(href) ? 'var(--sheet)' : 'transparent' }}>{label}</a>)}
    </nav>
    {path.startsWith('/settings/security') ? <Security/> : path.startsWith('/settings/notifications') ? <Notifications preview={preview} setPreview={setPreview}/> : path.startsWith('/settings/accessibility') ? <Accessibility theme={theme} setTheme={setTheme} reduced={reduced} setReduced={setReduced}/> : path.startsWith('/settings/resources') ? <Resources/> : <Household/>}
  </div>;
}

function Household() {
  const { snapshot } = useApp();
  return <div className="grid two"><section className="card"><p className="eyebrow">Household</p><h2>{snapshot.household.name}</h2><p className="muted">タイムゾーン · Asia/Tokyo</p><ul className="list">{snapshot.memberships.map((member) => <li className="list-row" key={member.id}><span className="avatar" style={{ background: member.color }} aria-hidden="true">{member.displayName.slice(0,1)}</span><div className="row-main"><strong>{member.displayName}</strong><span className="meta">{member.role} · {member.status}</span></div><button className="button" type="button">権限</button></li>)}</ul></section><section className="card"><p className="eyebrow">Invite</p><h2>家族を招待</h2><p>招待には期限と利用回数があります。URLを知っているだけでは、世帯の情報へ入れません。</p><div className="field"><label htmlFor="invite-role">役割</label><select className="select" id="invite-role"><option>大人</option><option>子ども</option><option>ゲスト</option></select></div><button className="button primary full mt-1" type="button"><PeopleIcon width="18"/>1回限りの招待を作る</button><p className="small muted mt-1">有効期間24時間 · 利用1回 · 管理者がいつでも失効可能</p></section></div>;
}

function Security() {
  return <div className="grid two"><section className="card accent"><ShieldIcon width="30"/><p className="eyebrow">Recommended</p><h2>パスキー</h2><p>端末の画面ロックを使って、フィッシングに強い方法で本人確認します。</p><div className="setting-row"><div><strong>この端末のパスキー</strong><p className="small muted mb-0">MacBook · 2026年9月28日登録</p></div><StatusBadge tone="success">有効</StatusBadge></div><button className="button full" type="button">別のパスキーを追加</button></section><section className="card"><LockIcon width="30"/><p className="eyebrow">Fallback</p><h2>パスワード</h2><p>15文字以上、最大64文字。文字種の強制や定期変更は求めません。既知の漏えい値は理由を示して拒否します。</p><button className="button full" type="button">パスワードを変更</button></section><section className="card"><h2>セッション</h2><ul className="list"><li className="list-row"><span className="status-dot" style={{ color: 'var(--success)' }}/><div className="row-main"><strong>このブラウザ</strong><span className="meta">東京 · いま使用中</span></div><StatusBadge tone="success">現在</StatusBadge></li><li className="list-row"><span className="status-dot"/><div className="row-main"><strong>iPhone Safari</strong><span className="meta">東京 · 2時間前</span></div><button className="button danger" type="button">終了</button></li></ul></section><section className="card"><h2>サーバー側の必須契約</h2><p className="muted">この参照フロントだけでは成立しない制御です。</p><ul><li><code>__Host-</code> Secure / HttpOnly / SameSite Cookie</li><li>CSRF token + Origin + Fetch Metadata</li><li>セッションIDのローテーションと失効</li><li>認証情報をWeb Storageへ保存しない</li></ul></section></div>;
}

function Notifications({ preview, setPreview }: { preview: boolean; setPreview: (value: boolean) => void }) {
  return <div className="grid two"><section className="card"><h2>リマインダー</h2><div className="setting-row"><div><strong>Todoの期限</strong><p className="small muted mb-0">期限の30分前</p></div><button type="button" className="toggle" aria-label="Todo期限の通知" aria-pressed={true}/></div><div className="setting-row"><div><strong>予定の出発時刻</strong><p className="small muted mb-0">移動時間を含めて表示</p></div><button type="button" className="toggle" aria-label="出発時刻の通知" aria-pressed={true}/></div><div className="setting-row"><div><strong>夜間は停止</strong><p className="small muted mb-0">21:00〜7:00</p></div><button type="button" className="toggle" aria-label="夜間停止" aria-pressed={true}/></div></section><section className="card"><div className="section-head"><h2>通知プレビュー</h2><button className="button" type="button" onClick={() => setPreview(!preview)}>{preview ? '隠す' : '表示'}</button></div>{preview && <div className="card flat"><StatusBadge>今日 17:30</StatusBadge><h3 className="mt-1">図書館の本を返す</h3><p className="muted">18:00まで · 担当は碧さんです</p><div className="grid two"><button className="button" type="button">30分延期</button><button className="button" type="button">この通知を停止</button></div></div>}<p className="small muted mt-1">通知は「いつ・何をする」を示し、延期と停止の経路を常に提供します。</p></section></div>;
}

function Accessibility({ theme, setTheme, reduced, setReduced }: { theme: 'light'|'dusk'; setTheme: (value: 'light'|'dusk') => void; reduced: boolean; setReduced: (value: boolean) => void }) {
  return <div className="grid two"><section className="card"><h2>テーマ</h2><div className="segmented"><button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>明るい紙面</button><button type="button" aria-pressed={theme === 'dusk'} onClick={() => setTheme('dusk')}>藍色の夕景</button></div><div className="setting-row"><div><strong>動きを減らす</strong><p className="small muted mb-0">OS設定も自動で尊重します</p></div><button type="button" className="toggle" aria-label="動きを減らす" aria-pressed={reduced} onClick={() => setReduced(!reduced)}/></div></section><section className="card"><h2>操作と読みやすさ</h2><ul><li>タッチ対象は原則44px以上</li><li>状態を色だけで表さない</li><li>200%ズームでも横スクロールなし</li><li>キーボードフォーカスを常時表示</li></ul><p className="small muted">VoiceOver + Safariの実機確認は、自動axe検査とは別に `evidence-pending` です。</p></section></div>;
}

function Resources() {
  const { snapshot } = useApp();
  return <div className="grid two">{snapshot.resources.map((resource) => <article className="card" key={resource.id}><div className="split"><LinkIcon width="24"/><StatusBadge>{resource.kind}</StatusBadge></div><h2>{resource.label}</h2><p className="muted wrap">{resource.url}</p><button className="button full" type="button">安全な新しいタブで開く <ArrowIcon width="16"/></button></article>)}</div>;
}
