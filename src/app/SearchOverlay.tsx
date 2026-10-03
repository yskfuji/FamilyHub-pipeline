import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { navigate } from './router';
import { CloseIcon } from '../design-system/icons';
import { useModalBehavior } from '../design-system/components';
import type { SearchResult, SearchResultKind } from '../data/gateway';

const kindLabels: Record<SearchResultKind, string> = { event: '予定', task: 'タスク', memo: 'メモ', expense: '支出', place: '場所', resource: '関連リンク' };

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { gateway } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useModalBehavior(onClose);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    if (!query.trim()) return;
    const timer = window.setTimeout(() => { void gateway.resources.search(query).then((result) => {
      if (!active) return; setLoading(false);
      if (result.ok) setResults(result.value); else { setResults([]); setError(result.error.message); }
    }); }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [gateway, query, requestVersion]);
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="search-panel" role="dialog" aria-modal="true" aria-label="家族の情報を検索"><div className="split"><label className="sr-only" htmlFor="global-search">予定、タスク、メモ、支出、場所、関連リンクを検索</label><input data-control-id="search.query" ref={input} data-autofocus id="global-search" className="input" type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); setResults([]); setError(''); setLoading(Boolean(value.trim())); }} placeholder="予定、タスク、メモ、支出、場所、関連リンクを検索" aria-describedby="search-status"/><button type="button" className="icon-button" data-control-id="search.close" aria-label="検索を閉じる" onClick={onClose}><CloseIcon /></button></div><div id="search-status" aria-live="polite" aria-busy={loading}>{loading && <p className="muted small mt-1">検索しています…</p>}{error && <div className="notice error mt-1" role="alert">{error}<button data-control-id="search.retry" className="button mt-1" type="button" onClick={() => { setLoading(true); setError(''); setRequestVersion((value) => value + 1); }}>もう一度検索</button></div>}{query && !loading && !error && results.length === 0 && <p className="muted small mt-1">一致する情報はありません</p>}{results.map((item) => <a data-control-id={`search.result.${item.kind}.${item.id}`} className="search-result" href={item.destination} data-link key={`${item.kind}-${item.id}`} aria-label={`${kindLabels[item.kind]}「${item.label}」を開く`} onClick={(event) => { event.preventDefault(); onClose(); navigate(item.destination); }}><span className="badge">{kindLabels[item.kind]}</span><span className="search-result-text"><strong>{item.label}</strong>{item.detail && <span className="meta">{item.detail}</span>}</span></a>)}</div></section></div>, document.body);
}
