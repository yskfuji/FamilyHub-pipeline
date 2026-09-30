import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { Brand } from '../../design-system/components';
import { ArrowIcon, PeopleIcon, ShieldIcon } from '../../design-system/icons';

export function OnboardingPage() {
  const { gateway, announce } = useApp();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [inviteCode, setInviteCode] = useState('FAMILY-2026-VALID-CODE');
  const [error, setError] = useState('');
  const [householdOnly, setHouseholdOnly] = useState(true);
  const [hideNotificationContent, setHideNotificationContent] = useState(true);
  const asideTitle = step === 1 ? '家族の居場所をつくる' : step === 2 ? '共有の範囲を決める' : '準備ができました';
  const asideText = step === 1 ? '名前と時間帯だけで始められます。' : step === 2 ? '情報ごとに誰が見られるか、あとから変更できます。' : '東京の架空データで主要機能を試せます。';
  const next = async () => {
    setError('');
    if (step === 1 && mode === 'join') {
      const result = await gateway.household.acceptInvite(inviteCode);
      if (!result.ok) { setError(result.error.message); return; }
    }
    if (step === 2) {
      const result = await gateway.household.savePrivacySettings({ defaultAudience: householdOnly ? 'household' : 'creator', hideNotificationContent });
      if (!result.ok) { setError(result.error.message); return; }
      announce(`共有範囲を${result.value.defaultAudience === 'household' ? '世帯メンバーのみ' : '作成者のみ'}で保存しました`);
    }
    if (step < 3) setStep(step + 1); else navigate('/today');
  };
  return <main className="auth-layout">
    <aside className="auth-aside"><Brand/><div><p className="eyebrow" style={{ color: '#ed9e7b' }}>Set up · {step}/3</p><h1>{asideTitle}</h1><p>{asideText}</p></div><ShieldIcon width="40"/></aside>
    <section className="auth-main"><div className="auth-card">
      <div className="stepper" role="progressbar" aria-label="初期設定の進み具合" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>{[1,2,3].map((value) => <span key={value} className={value <= step ? 'active' : ''}/>)}</div>
      {step === 1 && <div className="stack"><PeopleIcon width="34"/><h1>世帯の基本</h1><div className="segmented"><button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>新しく作る</button><button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>招待で参加</button></div>{mode === 'create' ? <><label className="field"><span>世帯の表示名</span><input className="input" defaultValue="森さんち"/></label><label className="field"><span>タイムゾーン</span><select className="select" defaultValue="Asia/Tokyo"><option value="Asia/Tokyo">Asia/Tokyo（日本時間）</option></select></label></> : <label className="field"><span>招待コード</span><input className="input" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="one-time-code"/><span className="field-help">招待は期限と利用回数をサーバーで検証します。</span></label>}{error && <p className="notice error" role="alert">{error}</p>}</div>}
      {step === 2 && <div className="stack"><h1>プライバシー</h1><div className="setting-row"><div><strong>世帯メンバーのみ</strong><p className="small muted mb-0">オフの場合は公開せず、作成者のみが初期値です</p></div><button type="button" className="toggle" aria-label="世帯メンバーのみに共有" aria-pressed={householdOnly} onClick={() => setHouseholdOnly(!householdOnly)}/></div><div className="setting-row"><div><strong>通知プレビュー</strong><p className="small muted mb-0">ロック画面では内容を伏せます</p></div><button type="button" className="toggle" aria-label="通知内容を伏せる" aria-pressed={hideNotificationContent} onClick={() => setHideNotificationContent(!hideNotificationContent)}/></div>{error && <p className="notice error" role="alert">{error}</p>}</div>}
      {step === 3 && <div className="stack"><h1>ようこそ、よりどころへ</h1><p className="lede">最初にTodayを開きます。確認が必要なこと、時間軸、自分の担当、未精算、天気の順に見られます。</p><div className="card flat"><strong>サンプル世帯</strong><p className="small muted mb-0">碧・蓮・花・空の4人 · 固定日時 2026年9月30日</p></div></div>}
      <div className="dialog-actions">{step > 1 && <button className="button" type="button" onClick={() => setStep(step-1)}>戻る</button>}<button className="button primary" type="button" onClick={() => void next()}>{step < 3 ? '次へ' : 'Todayを開く'} <ArrowIcon width="17"/></button></div>
    </div></section>
  </main>;
}
