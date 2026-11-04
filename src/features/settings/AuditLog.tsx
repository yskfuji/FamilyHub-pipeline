import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate, useSearch } from '../../app/router';
import { auditActionLabel, auditCopy, auditFieldsText, auditGroupLabels, auditTargetLabels } from '../../content/auditLabels';
import { EmptyState, StatusBadge, formatDate, formatTime } from '../../design-system/components';
import { ShieldIcon } from '../../design-system/icons';
import { auditGroups } from '../../domain/auditLog';
import type { AccountAuditEntry, AuditChainStatus, AuditEntry } from '../../domain/auditLog';
import { AUDIT_PAGE_SIZE, auditPeriods, auditQueryFor, auditSearch, auditTargetHref, groupByDay, readAuditFilters, type AuditFilters } from '../../domain/auditView';
import type { GatewayError, Result } from '../../domain/types';

type Loaded<T> = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; items: T[]; nextCursor: string | null; chain?: AuditChainStatus };

const dayLabel = (day: string) => formatDate(`${day}T12:00:00+09:00`);
const dateTime = (at: string) => `${formatDate(at)} ${formatTime(at)}`;

/**
 * 記録を読み、「もっと見る」で続きを足す。条件が変わったら、呼ぶ側が key を変えて作り直す（最初は読み込み中）。
 * 続きの読み込みに失敗したときは、読めた分を残して知らせる。
 */
function usePagedRecord<T>(load: (cursor?: string) => Promise<Result<{ items: T[]; nextCursor: string | null; chain?: AuditChainStatus }>>, announce: (message: string) => void) {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void load().then((result) => {
      if (!active) return;
      setState(result.ok ? { status: 'ready', ...result.value } : { status: 'failed', message: result.error.message });
    });
    return () => { active = false; };
    // 条件が変わるときは key で作り直すので、ここでは attempt（もう一度読み込む）だけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const loadMore = async () => {
    if (state.status !== 'ready' || !state.nextCursor || more) return;
    setMore(true);
    const result = await load(state.nextCursor);
    setMore(false);
    if (!result.ok) { announce((result.error as GatewayError).message); return; }
    setState({ status: 'ready', items: [...state.items, ...result.value.items], nextCursor: result.value.nextCursor, chain: result.value.chain ?? state.chain });
  };
  const retry = () => { setState({ status: 'loading' }); setAttempt((value) => value + 1); };
  return { state, more, loadMore, retry };
}

function Loading() {
  return <div className="audit-loading" aria-busy="true" aria-label={auditCopy.loadingMore}><div className="skeleton skeleton-line title-line"/><div className="skeleton audit-skeleton"/><div className="skeleton audit-skeleton"/></div>;
}

function Failed({ message, onRetry, id }: { message: string; onRetry: () => void; id: string }) {
  return <div className="notice error" role="alert"><strong>{auditCopy.failed}</strong><p className="small mb-0">{message}</p><button data-control-id={`settings.audit.retry.${id}`} className="button mt-1" type="button" onClick={onRetry}>{auditCopy.retry}</button></div>;
}

function MoreButton({ id, busy, onClick }: { id: string; busy: boolean; onClick: () => void }) {
  return <div className="audit-more"><button data-control-id={`settings.audit.more.${id}`} className="button" type="button" disabled={busy} aria-busy={busy} onClick={onClick}>{busy ? auditCopy.loadingMore : auditCopy.more}</button></div>;
}

function ChainStatus({ chain }: { chain: AuditChainStatus }) {
  const tone = chain.state === 'ok' ? 'success' : chain.state === 'problem' ? 'danger' : 'neutral';
  const text = chain.state === 'ok' ? auditCopy.chainOk : chain.state === 'problem' ? auditCopy.chainProblem : auditCopy.chainUnchecked;
  return <section className={`callout audit-chain ${chain.state === 'problem' ? 'danger' : 'info'}`} aria-labelledby="audit-chain-title" role={chain.state === 'problem' ? 'alert' : undefined}>
    <ShieldIcon/>
    <div><h2 className="callout-title" id="audit-chain-title">{auditCopy.chainHeading}</h2><p className="mb-0"><StatusBadge tone={tone}>{chain.state === 'ok' ? '正常' : chain.state === 'problem' ? '要確認' : '未確認'}</StatusBadge> {text}</p>
      {chain.checkedAt && <p className="small muted mb-0">{auditCopy.chainCheckedAt(dateTime(chain.checkedAt))}</p>}
    </div>
  </section>;
}

function Target({ entry }: { entry: AuditEntry }) {
  const { target } = entry;
  if (!target) return null;
  if (target.hidden) return <span className="audit-hidden" title={auditCopy.hiddenHelp}>{auditCopy.hiddenTarget}</span>;
  const href = auditTargetHref(target);
  const label = auditTargetLabels[target.kind];
  // 開く画面のない対象は、種類の名前と重なるので出さない。
  return href ? <a data-control-id={`settings.audit.target.${entry.id}`} href={href} data-link>{label}を開く</a> : null;
}

function actorText(entry: AuditEntry) {
  if (entry.actor.kind === 'member') return `${entry.actor.displayName}さん`;
  return entry.actor.kind === 'operator' ? auditCopy.operator : auditCopy.former;
}

/** 日付ごとのタイムライン。新しい順。 */
function Timeline<T extends { id: string; at: string }>({ items, row }: { items: T[]; row: (item: T) => React.ReactNode }) {
  return <div className="audit-timeline">{groupByDay(items).map((day) => <section className="audit-day" key={day.day} aria-labelledby={`audit-day-${day.day}`}>
    <h3 className="audit-day-heading" id={`audit-day-${day.day}`}>{dayLabel(day.day)}<span className="meta">{day.items.length}件</span></h3>
    <ol className="audit-list">{day.items.map((item) => <li className="audit-row" key={item.id}><time className="audit-time" dateTime={item.at}>{formatTime(item.at)}</time><div className="audit-main">{row(item)}</div></li>)}</ol>
  </section>)}</div>;
}

function HouseholdRecord({ filters }: { filters: AuditFilters }) {
  const { gateway, snapshot, announce } = useApp();
  const asOf = snapshot.context.asOf;
  const { state, more, loadMore, retry } = usePagedRecord<AuditEntry>((cursor) => gateway.audit.list(auditQueryFor(filters, asOf, cursor)), announce);
  const filtered = Boolean(filters.membershipId || filters.group || filters.period !== 'all');
  if (state.status === 'loading') return <Loading/>;
  if (state.status === 'failed') return <Failed id="household" message={state.message} onRetry={retry}/>;
  return <>
    {state.chain && <ChainStatus chain={state.chain}/>}
    <section className="card mt-1" aria-labelledby="audit-list-title">
      <h2 className="sr-only" id="audit-list-title">{auditCopy.views.household}</h2>
      {state.items.length === 0
        ? <EmptyState title={filtered ? auditCopy.emptyFiltered : auditCopy.empty}>{filtered ? auditCopy.emptyFilteredBody : auditCopy.emptyBody}</EmptyState>
        : <Timeline items={state.items} row={(entry) => <>
          <strong>{auditActionLabel(entry.action)}</strong>
          <span className="meta audit-meta"><span>{actorText(entry)}</span>{entry.group !== 'operator' && <span>{auditGroupLabels[entry.group]}</span>}<Target entry={entry}/></span>
          {entry.detail?.fields.length ? <span className="small muted">{auditCopy.fields(auditFieldsText(entry.detail.fields))}</span> : null}
        </>}/>}
      {state.nextCursor && <MoreButton id="household" busy={more} onClick={() => void loadMore()}/>}
    </section>
  </>;
}

/** 自分のアカウントの記録（A5-3）。サインインやパスワードの変更など。変更の記録の「自分の操作」と、サインインとセキュリティの画面に出す。 */
export function AccountActivity() {
  const { gateway, announce } = useApp();
  const { state, more, loadMore, retry } = usePagedRecord<AccountAuditEntry>((cursor) => gateway.audit.listMine({ limit: AUDIT_PAGE_SIZE, ...(cursor ? { cursor } : {}) }), announce);
  if (state.status === 'loading') return <Loading/>;
  if (state.status === 'failed') return <Failed id="mine" message={state.message} onRetry={retry}/>;
  return <>
    {state.items.length === 0
      ? <EmptyState title={auditCopy.emptyMine}>{auditCopy.emptyMineBody}</EmptyState>
      : <Timeline items={state.items} row={(entry) => <>
        <strong>{auditActionLabel(entry.action)}</strong>
        <span className="meta audit-meta"><span>{entry.actor.kind === 'operator' ? auditCopy.operator : auditCopy.self}</span>{entry.detail?.fields.length ? <span>{auditCopy.fields(auditFieldsText(entry.detail.fields))}</span> : null}</span>
      </>}/>}
    {state.nextCursor && <MoreButton id="mine" busy={more} onClick={() => void loadMore()}/>}
  </>;
}

/** 設定の「変更の記録」（A5-8）。管理者だけのタブ（audit.read）。絞り込みは URL のクエリに持つ。 */
export default function AuditLog() {
  const { snapshot } = useApp();
  const search = useSearch();
  const people = snapshot.memberships.filter((member) => member.status !== 'left');
  const filters = readAuditFilters(search, people.map((member) => member.id));
  const change = (changes: Partial<AuditFilters>) => navigate(`/settings/audit${auditSearch({ ...filters, ...changes })}`, true, true);
  return <div className="audit-page">
    <p className="muted audit-lede">{auditCopy.description} {auditCopy.retention}。</p>
    <div className="segmented audit-views" role="group" aria-label={auditCopy.tab}>
      {(['household', 'mine'] as const).map((view) => <button data-control-id={`settings.audit.view.${view}`} key={view} type="button" aria-pressed={filters.view === view} onClick={() => change({ view })}>{auditCopy.views[view]}</button>)}
    </div>
    {filters.view === 'mine'
      ? <section className="card mt-1" aria-labelledby="audit-mine-title"><h2 id="audit-mine-title">{auditCopy.mineHeading}</h2><p className="small muted">{auditCopy.mineDescription}</p><AccountActivity/></section>
      : <>
        <div className="audit-filters" role="group" aria-label="記録の絞り込み">
          <div className="field"><label htmlFor="audit-filter-person">{auditCopy.filterPerson}</label><select data-control-id="settings.audit.filter.person" id="audit-filter-person" className="select" value={filters.membershipId ?? ''} onChange={(event) => change({ membershipId: event.target.value || null })}>
            <option value="">{auditCopy.everyone}</option>
            {people.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          </select></div>
          <div className="field"><label htmlFor="audit-filter-kind">{auditCopy.filterKind}</label><select data-control-id="settings.audit.filter.kind" id="audit-filter-kind" className="select" value={filters.group ?? ''} onChange={(event) => change({ group: (event.target.value || null) as AuditFilters['group'] })}>
            <option value="">{auditCopy.everyKind}</option>
            {auditGroups.map((group) => <option key={group} value={group}>{auditGroupLabels[group]}</option>)}
          </select></div>
          <div className="field"><label htmlFor="audit-filter-period">{auditCopy.filterPeriod}</label><select data-control-id="settings.audit.filter.period" id="audit-filter-period" className="select" value={filters.period} onChange={(event) => change({ period: event.target.value as AuditFilters['period'] })}>
            {auditPeriods.map((period) => <option key={period} value={period}>{auditCopy.periods[period]}</option>)}
          </select></div>
        </div>
        <HouseholdRecord key={auditSearch(filters)} filters={filters}/>
      </>}
  </div>;
}
