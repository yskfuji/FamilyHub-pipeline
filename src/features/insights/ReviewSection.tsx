import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { EmptyState, formatDate } from '../../design-system/components';
import { allRecords, reviewRecords, REVIEW_DAYS } from '../../domain/advisor/review';
import { weekLoad, WEEK_DAYS, type WeekLoad } from '../../domain/advisor/weekLoad';
import { GroupedBarChart, type Series } from '../../design-system/charts/BarCharts';
import { ChartFrame } from '../../design-system/charts/ChartFrame';
import type { DraftProposal, Finding, ReviewScope } from '../../domain/advisor/review';
import type { Capability } from '../../domain/types';

const scopes: ReadonlyArray<readonly [keyof ReviewScope, string, Capability]> = [['events', '予定', 'event.read'], ['tasks', 'タスク', 'task.read'], ['expenses', '家計', 'expense.read']];
const citationKinds = { event: '予定', task: 'タスク', expense: '家計' } as const;
const draftNote = '振り返りから作った下書きです。内容を確かめてから保存してください。';

function FindingCard({ finding, onDraft, canDraft }: { finding: Finding; onDraft: (proposal: DraftProposal) => void; canDraft: boolean }) {
  return <article className="card flat review-finding">
    <h3>{finding.title}</h3>
    <p className="small">{finding.summary}</p>
    <div>
      <span className="meta">もとにした記録</span>
      <ul className="review-citations">{finding.citations.map((citation) => <li key={`${citation.kind}-${citation.href}`}><a data-control-id={`insights.review.cite.${finding.id}.${citation.id}`} href={citation.href} data-link><span className="review-citation-kind">{citationKinds[citation.kind]}</span>{citation.label}</a></li>)}</ul>
      {finding.moreCitations > 0 && <p className="small muted mb-0">ほか{finding.moreCitations}件</p>}
    </div>
    {canDraft && <button data-control-id={`insights.review.draft.${finding.id}`} className="button full" type="button" onClick={() => onDraft(finding.proposal)}>{finding.proposal.label}</button>}
  </article>;
}

const weekdayOf = (date: string) => new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(`${date}T12:00:00+09:00`));
const dayName = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${weekdayOf(date)}）`;
const dayLong = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${weekdayOf(date)}）`;

/** 今日から7日の、日ごとの予定とタスクの件数。数えた種類だけを並べる。 */
function WeekLoadChart({ load }: { load: WeekLoad }) {
  const series: Series[] = [
    ...(load.counted.events ? [{ key: 'events', name: '予定', tone: 2 as const }] : []),
    ...(load.counted.tasks ? [{ key: 'tasks', name: 'タスク', tone: 6 as const }] : []),
  ];
  if (series.length === 0) return null;
  const kinds = series.map((item) => item.name).join('と');
  const busiest = load.days.reduce((top, day) => (day.events + day.tasks > top.events + top.tasks ? day : top), load.days[0]);
  return <div className="chart-section" aria-labelledby="review-week-title" role="group">
    <h3 id="review-week-title">日ごとの件数</h3>
    <p className="small muted mb-0">今日から{WEEK_DAYS}日の、日ごとの{load.counted.tasks ? `${kinds}（期限の日）` : kinds}の件数です。期限のないタスクと、期限を過ぎたタスクは入りません。</p>
    {load.total === 0
      ? <p className="chart-note" data-chart-empty="week-load">この{WEEK_DAYS}日に、数える{kinds}はありません。</p>
      : <ChartFrame name="week-load" summary={`今日から${WEEK_DAYS}日の、日ごとの${kinds}の件数。合わせて${load.total}件で、いちばん多いのは${dayLong(busiest.date)}の${busiest.events + busiest.tasks}件です。`} table={{
        caption: `日ごとの${kinds}の件数`,
        columns: ['日', ...series.map((item) => item.name)],
        rows: load.days.map((day, index) => ({ key: day.date, header: `${dayLong(day.date)}${index === 0 ? '（今日）' : ''}`, cells: series.map((item) => `${day[item.key as 'events' | 'tasks']}件`) })),
      }} names="wide">
        <GroupedBarChart room="count" series={series} groups={load.days.map((day, index) => ({
            key: day.date, name: dayName(day.date), mark: index === 0 ? '今日' : undefined,
            values: { events: day.events, tasks: day.tasks },
            labels: { events: `${day.events}件`, tasks: `${day.tasks}件` },
          }))}/>
      </ChartFrame>}
  </div>;
}

/** 記録を数えた結果。見ている人に見える記録だけを使い、保存も通信もしない。 */
export function ReviewSection() {
  const { snapshot, can, requestQuickCreate } = useApp();
  const [scope, setScope] = useState<ReviewScope>(allRecords);
  const review = useMemo(() => reviewRecords(snapshot, scope), [snapshot, scope]);
  const week = useMemo(() => weekLoad(snapshot, scope), [snapshot, scope]);
  const available = scopes.filter(([, , capability]) => can(capability));
  const draftable = (proposal: DraftProposal) => can(proposal.kind === 'task' ? 'task.create' : 'event.create');
  const openDraft = (proposal: DraftProposal) => {
    if (proposal.kind === 'task') requestQuickCreate('todo', undefined, undefined, { todo: proposal.task, note: draftNote });
    else requestQuickCreate('event', undefined, undefined, { event: proposal.event, note: draftNote });
  };
  const counted = scope.events || scope.tasks;
  return <section className="card mt-1 review" aria-labelledby="review-title">
    <p className="eyebrow">振り返り</p>
    <h2 id="review-title">記録を数えた結果</h2>
    <p className="muted small">予定・タスク・家計の記録の件数、時刻、金額を数えて比べているだけです。内容を読み取ったり、気持ちや事情を推し量ったりはしません。下書きは開くだけで、保存するまで記録は変わりません。</p>
    <fieldset className="fieldset"><legend>数える記録</legend><div className="review-scope">{available.map(([key, label]) => <label className="check-row" key={key}><input data-control-id={`insights.review.scope.${key}`} type="checkbox" checked={scope[key]} onChange={(event) => setScope((current) => ({ ...current, [key]: event.target.checked }))}/>{label}</label>)}</div></fieldset>
    {counted && <div className="review-load">
      <div className="review-load-people">
      <h3 id="review-load-title">人ごとの件数</h3>
      <p className="small muted">{formatDate(snapshot.context.asOf)}から{REVIEW_DAYS}日後までの予定と、終わっていないタスクの件数です。</p>
      <table className="ledger-table" aria-labelledby="review-load-title"><thead><tr><th scope="col">名前</th><th scope="col">予定</th><th scope="col">タスク</th><th scope="col">期限切れ</th></tr></thead>
        <tbody>{review.load.map((person) => <tr key={person.membershipId}><th scope="row">{person.name}</th><td>{person.events}件</td><td>{person.openTasks}件</td><td>{person.overdueTasks}件</td></tr>)}</tbody>
      </table>
      </div>
      <WeekLoadChart load={week}/>
    </div>}
    {review.findings.length === 0
      ? <div className="mt-1"><EmptyState title="挙げることはありません">選んだ記録の中に、重なりや期限切れなどは見つかりませんでした。</EmptyState></div>
      : <div className="review-findings">{review.findings.map((finding) => <FindingCard key={finding.id} finding={finding} canDraft={draftable(finding.proposal)} onDraft={openDraft}/>)}</div>}
  </section>;
}
