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
  const asideTitle = step === 1 ? '家族の設定を始める' : step === 2 ? '共有範囲を選ぶ' : '設定が完了しました';
  const asideText = step === 1 ? '家族グループの名前と、日時を表示する地域を設定します。' : step === 2 ? '予定やメモを共有する相手は、あとから変更できます。' : '架空の家族データで主な機能を試せます。';
  const next = async () => {
    setError('');
    if (step === 1 && mode === 'join') {
      const result = await gateway.household.acceptInvite(inviteCode);
      if (!result.ok) { setError(result.error.message); return; }
    }
    if (step === 2) {
      const result = await gateway.household.savePrivacySettings({ defaultAudience: householdOnly ? 'household' : 'creator', hideNotificationContent });
      if (!result.ok) { setError(result.error.message); return; }
      announce(`共有範囲を「${result.value.defaultAudience === 'household' ? '家族全員' : '作成した本人だけ'}」に設定しました。`);
    }
    if (step < 3) setStep(step + 1); else navigate('/today');
  };
  return <main className="auth-layout">
    <aside className="auth-aside"><Brand/><div><p className="eyebrow" style={{ color: '#ed9e7b' }}>初期設定 · {step}/3</p><h1>{asideTitle}</h1><p>{asideText}</p></div><ShieldIcon width="40"/></aside>
    <section className="auth-main"><div className="auth-card">
      <div className="stepper" role="progressbar" aria-label="初期設定の進み具合" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>{[1,2,3].map((value) => <span key={value} className={value <= step ? 'active' : ''}/>)}</div>
      {step === 1 && <div className="stack"><PeopleIcon width="34"/><h1>家族グループの設定</h1><div className="segmented"><button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>新しく作る</button><button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>招待コードで参加</button></div>{mode === 'create' ? <><label className="field"><span>家族グループの名前</span><input className="input" defaultValue="森さんち"/></label><label className="field"><span>日時の表示</span><select className="select" defaultValue="Asia/Tokyo"><option value="Asia/Tokyo">日本時間</option></select></label></> : <label className="field"><span>招待コード</span><input className="input" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="one-time-code"/><span className="field-help">招待コードは、有効期限と利用回数を確認してから受け付けます。</span></label>}{error && <p className="notice error" role="alert">{error}</p>}</div>}
      {step === 2 && <div className="stack"><h1>共有範囲</h1><div className="setting-row"><div><strong>家族全員と共有する</strong><p className="small muted mb-0">オフにすると、作成した本人だけに表示します</p></div><button type="button" className="toggle" aria-label="家族全員と共有する" aria-pressed={householdOnly} onClick={() => setHouseholdOnly(!householdOnly)}/></div><div className="setting-row"><div><strong>ロック画面に内容を表示しない</strong><p className="small muted mb-0">通知にはタイトルや内容を表示しません</p></div><button type="button" className="toggle" aria-label="通知の内容を表示しない" aria-pressed={hideNotificationContent} onClick={() => setHideNotificationContent(!hideNotificationContent)}/></div>{error && <p className="notice error" role="alert">{error}</p>}</div>}
      {step === 3 && <div className="stack"><h1>ようこそ、よりどころへ</h1><p className="lede">最初に「今日」の画面を開きます。確認が必要なこと、今日の予定、自分のタスク、未精算、天気の順に確認できます。</p><div className="card flat"><strong>デモ用の家族</strong><p className="small muted mb-0">碧・蓮・花・空・結衣の5人 · 2026年9月30日のデータ</p></div></div>}
      <div className="dialog-actions">{step > 1 && <button className="button" type="button" onClick={() => setStep(step-1)}>戻る</button>}<button className="button primary" type="button" onClick={() => void next()}>{step < 3 ? '次へ' : '今日の画面を開く'} <ArrowIcon width="17"/></button></div>
    </div></section>
  </main>;
}
