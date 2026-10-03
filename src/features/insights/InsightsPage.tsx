import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { ArrowIcon, EyeIcon, SparkIcon } from '../../design-system/icons';
import { errorGuidance, ja } from '../../content/ja';
import type { GatewayError, Insight } from '../../domain/types';

const tone = (confidence: Insight['confidence']) => (confidence === 'high' ? 'success' : confidence === 'medium' ? 'attention' : 'neutral');

export function InsightsPage() {
  const { gateway, snapshot } = useApp();
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<GatewayError | null>(null);
  const [attempt, setAttempt] = useState(0);
  // 記録が変わるたびに取り直す（ヒントは固定文ではなく、その時点の記録から導く）。
  useEffect(() => {
    let mounted = true;
    void gateway.insights.list().then((result) => {
      if (!mounted) return;
      if (result.ok) { setInsights(result.value); setError(null); } else setError(result.error);
    });
    return () => { mounted = false; };
  }, [gateway, snapshot, attempt]);

  return <div className="page">
    <PageHeader eyebrow="ヒント" title="確認しておきたいこと" description="予定・タスク・家計の記録から、確認しておきたいことをまとめています。"/>
    <div className="callout info" style={{ marginBottom: '1.5rem' }}><EyeIcon/><div><strong>ヒントは記録から計算しています</strong><p className="small muted mb-0">ヒントをもとに予定や担当を自動で変更することはありません。操作しなくても、記録はそのままです。</p></div></div>
    {error ? <div className="notice error" role="alert"><strong>{error.message}</strong><p className="small mb-0">{errorGuidance(error)}</p><button data-control-id="insights.retry" className="button mt-1" type="button" onClick={() => setAttempt((value) => value + 1)}>{ja.actions.retry}</button></div>
      : insights === null ? <div className="grid three" aria-busy="true" aria-label="ヒントを読み込んでいます"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div>
        : insights.length === 0 ? <EmptyState title="いま確認が必要なことはありません">予定やタスク、家計の記録に変化があると、ここに表示します。</EmptyState>
          : <div className="grid three">{insights.map((insight, index) => <article className="card accent" key={insight.id}>
            <div className="split"><SparkIcon width="24"/><StatusBadge tone={tone(insight.confidence)}>情報の確かさ：{ja.insightConfidence[insight.confidence]}</StatusBadge></div>
            <p className="eyebrow">ヒント {String(index + 1).padStart(2, '0')}</p>
            <h2>{insight.title}</h2>
            <p>{insight.summary}</p>
            <div className="card flat"><span className="meta">もとにした情報</span><p className="small mb-0">{insight.evidence}</p></div>
            <a data-control-id={`insights.open.${insight.id}`} className="button full mt-1" href={insight.destination} data-link>{insight.actionLabel}<ArrowIcon width="16"/></a>
          </article>)}</div>}
    <section className="card mt-1"><p className="eyebrow">表示の範囲</p><h2>この画面では行わないこと</h2><div className="grid three"><div><strong>公平さの判定</strong><p className="muted small">作業数だけで、家族それぞれの負担や公平さを決めつけません。</p></div><div><strong>気持ちや関係性の推測</strong><p className="muted small">予定やタスクの記録から、気持ちや家族関係を推測しません。</p></div><div><strong>予定や担当の自動変更</strong><p className="muted small">ヒントの内容を、予定や担当に自動で反映しません。</p></div></div></section>
  </div>;
}
