import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { navigate } from './router';
import { CloseIcon } from '../design-system/icons';
import { useModalBehavior } from '../design-system/components';

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { gateway } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ kind: string; id: string; label: string; destination: string }>>([]);
  const input = useRef<HTMLInputElement>(null);
  const root = useModalBehavior(onClose);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { let active = true; void gateway.resources.search(query).then((result) => { if (active && result.ok) setResults(result.value); }); return () => { active = false; }; }, [gateway, query]);
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="search-panel" role="dialog" aria-modal="true" aria-label="家族の情報を検索"><div className="split"><label className="sr-only" htmlFor="global-search">予定、Todo、メモ、リンクを検索</label><input ref={input} data-autofocus id="global-search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="予定、Todo、メモ、リンクを検索" /><button type="button" className="icon-button" aria-label="検索を閉じる" onClick={onClose}><CloseIcon /></button></div><div aria-live="polite">{query && results.length === 0 && <p className="muted small mt-1">一致するものはありません</p>}{results.map((item) => <a className="search-result" href={item.destination} data-link key={`${item.kind}-${item.id}`} onClick={(event) => { event.preventDefault(); onClose(); navigate(item.destination); }}><span className="badge">{item.kind}</span><strong>{item.label}</strong></a>)}</div></section></div>, document.body);
}
