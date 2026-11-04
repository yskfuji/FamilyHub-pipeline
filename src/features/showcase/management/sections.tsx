import { useState } from 'react';
import { StatusBadge } from '../../../design-system/components';
import { collectionLabels, sections } from './fixtures';
import { consoleSummary, filterAudit, filterHouseholds, filterRecords, SAMPLE_OPERATOR } from './model';
import type { AuditCategory, ConsoleState, HouseholdStatus, RecordCollection, SectionId } from './model';
import type { ConsoleDispatch, PendingConfirmation } from './ManagementConsole';

interface SectionProps { state: ConsoleState; dispatch: ConsoleDispatch; confirm: (value: PendingConfirmation) => void }

const formatAt = (value: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));
const formatDay = (value: string) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(value));
const NOT_REAL = '本物の処理は動いていません。';

function SectionHead({ title, description }: { title: string; description: string }) {
  return <div><h2>{title}</h2><p className="muted small">{description}</p></div>;
}

function sectionHref(id: SectionId) { return sections.find((item) => item.id === id)!.href; }

export function OverviewSection({ state }: { state: ConsoleState }) {
  const summary = consoleSummary(state);
  const cards: readonly { label: string; value: string; note: string; link: string; section: SectionId }[] = [
    { label: '正常なサービス', value: `${summary.healthy} / ${summary.services}`, note: '残りは注意が必要なものです', link: 'サービスの状態を開く', section: 'services' },
    { label: '家族グループ', value: `${summary.households}件`, note: `利用中 ${summary.active}・試用中 ${summary.trial}・停止中 ${summary.stopped}`, link: '家族グループを開く', section: 'households' },
    { label: '記録', value: `${summary.activeRecords}件`, note: `削除待ち ${summary.waitingForDeletion}件`, link: '記録の閲覧を開く', section: 'records' },
    { label: '失敗したジョブ', value: `${summary.failedRuns}件`, note: '履歴の中で失敗したもの', link: 'ジョブの履歴を開く', section: 'jobs' },
    { label: '最新のバックアップ', value: summary.latestBackup ? formatAt(summary.latestBackup) : 'なし', note: `未検証 ${summary.unverifiedBackups}件`, link: 'バックアップを開く', section: 'backups' },
  ];
  return <section aria-labelledby="mgmt-overview">
    <h2 id="mgmt-overview">概要</h2>
    <p className="muted small">下の数字は架空のデータから計算しています。</p>
    <div className="mgmt-kpis">{cards.map((card) => <article className="card flat mgmt-kpi" key={card.section}>
      <p className="muted small">{card.label}</p>
      <p className="mgmt-kpi-value">{card.value}</p>
      <p className="small muted">{card.note}</p>
      <a data-control-id={`showcase.management.overview.open.${card.section}`} className="small standalone-link" href={sectionHref(card.section)} data-link>{card.link}</a>
    </article>)}</div>
    <h3 className="mt-1">最近の操作</h3>
    <ul className="mgmt-rows">{state.audit.slice(0, 3).map((entry) => <li className="mgmt-row" key={entry.id}><div><p>{entry.action}：{entry.target}</p><p className="small muted">{formatAt(entry.at)} · {entry.actor}</p></div></li>)}</ul>
  </section>;
}

export function ServicesSection({ state, dispatch }: SectionProps) {
  return <section>
    <SectionHead title="サービスの状態" description="状態はあらかじめ決めた架空の値です。確認し直しても、確認した時刻だけが変わります。"/>
    <ul className="mgmt-rows">{state.services.map((service) => <li className="mgmt-row" key={service.id}>
      <div><h3>{service.name}</h3><p className="small muted">{service.summary} · {service.measure}</p><p className="small muted">確認した時刻：{formatAt(service.checkedAt)}</p></div>
      <div className="mgmt-row-actions">
        <StatusBadge tone={service.status === 'ok' ? 'success' : 'attention'}>{service.status === 'ok' ? '正常' : '注意'}</StatusBadge>
        <button data-control-id={`showcase.management.service.recheck.${service.id}`} className="button" type="button" onClick={() => dispatch({ type: 'service.recheck', id: service.id }, `${service.name}を確認し直しました（見本）。`)}>確認し直す</button>
      </div>
    </li>)}</ul>
  </section>;
}

export function JobsSection({ state, dispatch, confirm }: SectionProps) {
  const titleOf = (id: string) => state.jobs.find((job) => job.id === id)?.title ?? id;
  return <section>
    <SectionHead title="ジョブ" description="試算は対象の件数を数えるだけです。実行には確認があり、見本では画面の中の件数だけが変わります。"/>
    <ul className="mgmt-rows">{state.jobs.map((job) => <li className="mgmt-row" key={job.id}>
      <div><h3>{job.title}</h3><p className="small muted">{job.description}</p><p className="small">対象：{job.pending}件</p></div>
      <div className="mgmt-row-actions">
        <button data-control-id={`showcase.management.job.dry-run.${job.id}`} className="button" type="button" onClick={() => dispatch({ type: 'job.dry-run', id: job.id }, `試算しました。対象は${job.pending}件です（見本）。何も変更していません。`)}>試算する</button>
        {job.changesRecords
          ? <button data-control-id={`showcase.management.job.run.${job.id}`} className="button" type="button" disabled={job.pending === 0} onClick={() => confirm({ title: `「${job.title}」を見本で実行しますか`, description: `対象の${job.pending}件を、この画面の中でだけ処理済みにします。${NOT_REAL}`, confirmLabel: '見本で実行する', action: { type: 'job.run', id: job.id }, done: `見本で実行しました。${NOT_REAL}` })}>見本で実行する</button>
          : <StatusBadge>読み取りだけ</StatusBadge>}
      </div>
    </li>)}</ul>
    <h3 className="mt-1">履歴</h3>
    <ul className="mgmt-rows" aria-label="ジョブの履歴">{state.runs.map((run) => <li className="mgmt-row" key={run.id}>
      <div><p>{titleOf(run.jobId)}</p><p className="small muted">{formatAt(run.at)} · {run.mode === 'run' ? '実行' : '試算'} · {run.count}件 · {run.actor}</p></div>
      <div className="mgmt-row-actions"><StatusBadge tone={run.status === 'succeeded' ? 'success' : 'danger'}>{run.status === 'succeeded' ? '完了' : '失敗'}</StatusBadge></div>
    </li>)}</ul>
  </section>;
}

export function BackupsSection({ state, dispatch }: SectionProps) {
  return <section>
    <div className="split"><SectionHead title="バックアップ" description="名前、大きさ、確認用の値はすべて架空です。ファイルは存在しません。"/><button data-control-id="showcase.management.backup.create" className="button" type="button" onClick={() => dispatch({ type: 'backup.create' }, `見本の一覧に1件追加しました。${NOT_REAL}`)}>見本を追加する</button></div>
    <ul className="mgmt-rows">{state.backups.map((backup) => <li className="mgmt-row" key={backup.id}>
      <div><h3>{backup.name}</h3><p className="small muted">{formatAt(backup.createdAt)} · {backup.sizeMb}MB · 確認用の値 {backup.checksum}</p></div>
      <div className="mgmt-row-actions">
        <StatusBadge tone={backup.status === 'verified' ? 'success' : 'attention'}>{backup.status === 'verified' ? '検証済み（見本）' : '未検証'}</StatusBadge>
        {backup.status === 'unverified' && <button data-control-id={`showcase.management.backup.verify.${backup.id}`} className="button" type="button" onClick={() => dispatch({ type: 'backup.verify', id: backup.id }, `${backup.name}を検証済みにしました（見本）。`)}>検証する</button>}
      </div>
    </li>)}</ul>
  </section>;
}

const auditFilters: readonly { value: AuditCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' }, { value: 'service', label: 'サービス' }, { value: 'job', label: 'ジョブ' }, { value: 'backup', label: 'バックアップ' }, { value: 'household', label: '家族グループ' },
];

export function AuditLogSection({ state }: { state: ConsoleState }) {
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const entries = filterAudit(state.audit, category, query);
  return <section>
    <SectionHead title="操作の記録" description={`この画面で行った見本の操作も、ここに加わります。記録する人の名前は「${SAMPLE_OPERATOR}」のような架空のものです。`}/>
    <div className="mgmt-filters">
      <div className="segmented" role="group" aria-label="種類で絞り込む">{auditFilters.map((item) => <button data-control-id={`showcase.management.audit.filter.${item.value}`} key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
      <label className="field"><span>言葉で探す</span><input data-control-id="showcase.management.audit.search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
    </div>
    <p className="small muted" role="status">{entries.length}件</p>
    {entries.length > 0
      ? <ul className="mgmt-rows" aria-label="操作の記録">{entries.map((entry) => <li className="mgmt-row" key={entry.id}><div><p>{entry.action}：{entry.target}</p><p className="small muted">{formatAt(entry.at)} · {entry.actor}</p></div></li>)}</ul>
      : <p className="muted">条件に合う記録はありません。</p>}
  </section>;
}

const householdStatus: Record<HouseholdStatus, { label: string; tone: 'success' | 'attention' | 'danger' }> = {
  active: { label: '利用中', tone: 'success' }, trial: { label: '試用中', tone: 'attention' }, stopped: { label: '停止中', tone: 'danger' },
};

export function HouseholdsSection({ state, dispatch, confirm }: SectionProps) {
  const [query, setQuery] = useState('');
  const households = filterHouseholds(state.households, query);
  return <section>
    <SectionHead title="家族グループ" description="架空の家族グループです。利用期間の変更はこの画面の中でだけ行われます。"/>
    <div className="mgmt-filters"><label className="field"><span>名前やIDで探す</span><input data-control-id="showcase.management.household.search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div>
    <p className="small muted" role="status">{households.length}件</p>
    {households.length > 0
      ? <ul className="mgmt-rows" aria-label="家族グループ">{households.map((household) => <li className="mgmt-row" key={household.id}>
        <div><h3>{household.name}</h3><p className="small muted">{household.id} · メンバー {household.members}人 · {household.endsAt ? `${formatDay(household.endsAt)}まで` : '期限なし'}</p></div>
        <div className="mgmt-row-actions">
          <StatusBadge tone={householdStatus[household.status].tone}>{householdStatus[household.status].label}</StatusBadge>
          {household.status === 'stopped'
            ? <button data-control-id={`showcase.management.household.resume.${household.id}`} className="button" type="button" onClick={() => dispatch({ type: 'household.resume', id: household.id }, `${household.name}を再開しました（見本）。`)}>再開する</button>
            : <>
              <button data-control-id={`showcase.management.household.extend.${household.id}`} className="button" type="button" onClick={() => dispatch({ type: 'household.extend', id: household.id }, `${household.name}の利用期間を30日延ばしました（見本）。`)}>30日延ばす</button>
              <button data-control-id={`showcase.management.household.stop.${household.id}`} className="button danger" type="button" onClick={() => confirm({ title: `${household.name}の利用を止めますか`, description: `この画面の中でだけ停止中にします。${NOT_REAL}`, confirmLabel: '見本で止める', action: { type: 'household.stop', id: household.id }, done: `${household.name}を停止中にしました（見本）。` })}>止める</button>
            </>}
        </div>
      </li>)}</ul>
      : <p className="muted">条件に合う家族グループはありません。</p>}
  </section>;
}

export function RecordsSection({ state }: { state: ConsoleState }) {
  const [collection, setCollection] = useState<RecordCollection>('events');
  const [query, setQuery] = useState('');
  const [showWaiting, setShowWaiting] = useState(false);
  const records = filterRecords(state.records, collection, query, showWaiting);
  return <section>
    <SectionHead title="記録の閲覧" description="架空の記録を読むだけの画面で、変更はできません。個人に関わる項目は伏せて表示します。"/>
    <div className="mgmt-filters">
      <div className="field"><label htmlFor="mgmt-record-collection">種類</label>
        <select data-control-id="showcase.management.record.collection" id="mgmt-record-collection" className="select" value={collection} onChange={(event) => setCollection(event.target.value as RecordCollection)}>
          {(Object.keys(collectionLabels) as RecordCollection[]).map((value) => <option key={value} value={value}>{collectionLabels[value]}</option>)}
        </select>
      </div>
      <label className="field"><span>題名やIDで探す</span><input data-control-id="showcase.management.record.search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <label className="mgmt-check"><input data-control-id="showcase.management.record.waiting" type="checkbox" checked={showWaiting} onChange={(event) => setShowWaiting(event.target.checked)}/><span>削除待ちも表示する</span></label>
    </div>
    <p className="small muted" role="status">{records.length}件</p>
    {records.length > 0
      ? <ul className="mgmt-rows" aria-label="記録">{records.map((record) => <li className="mgmt-row" key={record.id}>
        <div><h3>{record.title}</h3><p className="small muted">{record.id} · {record.household} · 更新 {formatAt(record.updatedAt)}</p></div>
        {record.waitingForDeletion && <div className="mgmt-row-actions"><StatusBadge tone="attention">削除待ち</StatusBadge></div>}
        <dl className="mgmt-fields">{record.fields.map(([name, value]) => <div className="mgmt-field" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      </li>)}</ul>
      : <p className="muted">条件に合う記録はありません。</p>}
  </section>;
}
