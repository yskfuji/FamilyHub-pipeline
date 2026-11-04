import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useApp } from './AppContext';
import { navigateGuarded } from './router';
import { CloseIcon } from '../design-system/icons';
import { useModalBehavior } from '../design-system/components';
import type { SearchResult } from '../data/gateway';
import { matchesCommand, paletteCommands, type PaletteCommand } from './paletteCommands';
import { groupSearchResults, searchGroupLabels } from './searchGroups';
const ITEM = '[data-palette-item]';

/** 結果の1件。見出しで種類が分かるので、札は出さずに題名と補足だけを並べる。読み上げでは種類も伝える。 */
function SearchResultLink({ item, onClose }: { item: SearchResult; onClose: () => void }) {
  return <a data-control-id={`search.result.${item.kind}.${item.id}`} data-palette-item className="search-result grouped" href={item.destination} aria-label={`${searchGroupLabels[item.kind]}「${item.label}」を開く`} onClick={(event) => { event.preventDefault(); onClose(); navigateGuarded(item.destination); }}><span className="search-result-text"><strong>{item.label}</strong>{item.detail && <span className="meta">{item.detail}</span>}</span></a>;
}

/** ⌘K の画面。入力すると家族の情報を探し、入力がなければできることの一覧を出す。 */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { gateway, can, snapshot, loading: restoring, requestQuickCreate, announce } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useModalBehavior(onClose);
  // 読み込みが終わるまでは権限が分からず、追加の画面も開けないので、追加のコマンドを出さない。
  const commands = useMemo(() => paletteCommands({ can, snapshot, requestQuickCreate, announce }).filter((command) => !restoring || !command.id.startsWith('add.')), [can, snapshot, restoring, requestQuickCreate, announce]);
  const typed = query.trim();
  const shown = typed ? commands.filter((command) => matchesCommand(command, typed)) : commands;
  const groups = [...new Set(shown.map((command) => command.group))];
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

  /** 開いている一覧を閉じてから実行する。次の画面へ焦点が渡るよう、閉じる処理を先に終える。 */
  const run = (command: PaletteCommand) => { flushSync(onClose); requestAnimationFrame(command.run); };

  /** 上下の矢印で候補を移る。文字を押したら入力欄へ戻す。 */
  const moveWithKeys = (event: KeyboardEvent<HTMLElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (target: HTMLElement | null | undefined) => { event.preventDefault(); target?.focus(); };
    if (event.key === 'ArrowDown') go(items[Math.min(index + 1, items.length - 1)]);
    else if (event.key === 'ArrowUp') go(index <= 0 ? input.current : items[index - 1]);
    else if (index >= 0 && event.key === 'Home') go(items[0]);
    else if (index >= 0 && event.key === 'End') go(items[items.length - 1]);
    else if (index >= 0 && event.key.length === 1 && !event.metaKey && !event.ctrlKey && event.key !== ' ') input.current?.focus();
  };

  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="search-panel" role="dialog" aria-modal="true" aria-label="家族の情報を検索" onKeyDown={moveWithKeys}><div className="split"><label className="sr-only" htmlFor="global-search">予定、タスク、メモ、支出、場所、関連リンク、アルバム、写真と動画を検索</label><input data-control-id="search.query" ref={input} data-autofocus id="global-search" className="input" type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); setResults([]); setError(''); setLoading(Boolean(value.trim())); }} placeholder="予定・メモ・家計・アルバムなどを検索" aria-describedby="search-status"/><button type="button" className="icon-button" data-control-id="search.close" aria-label="検索を閉じる" onClick={onClose}><CloseIcon /></button></div><div className="palette-scroll"><div id="search-status" aria-live="polite" aria-busy={loading}>{loading && <p className="muted small mt-1">検索しています…</p>}{error && <div className="notice error mt-1" role="alert">{error}<button data-control-id="search.retry" className="button mt-1" type="button" onClick={() => { setLoading(true); setError(''); setRequestVersion((value) => value + 1); }}>もう一度検索</button></div>}{query && !loading && !error && results.length === 0 && <p className="muted small mt-1">一致する情報はありません</p>}{groupSearchResults(results).map((group) => <section className="palette-group search-group" key={group.kind} aria-labelledby={`search-group-${group.kind}`}><h3 className="palette-heading" id={`search-group-${group.kind}`}>{group.label}<span className="search-group-count">{group.items.length}件</span></h3>{group.items.map((item) => <SearchResultLink key={`${item.kind}-${item.id}`} item={item} onClose={onClose}/>)}</section>)}</div>{!typed && <p className="small muted mt-1 mb-0">矢印キーで選び、Enter で実行します。</p>}{groups.map((group) => <section className="palette-group" key={group} aria-label={group}><h3 className="palette-heading" aria-hidden="true">{group}</h3>{shown.filter((command) => command.group === group).map((command) => <button data-control-id={`palette.command.${command.id}`} data-palette-item className="search-result palette-command" type="button" key={command.id} onClick={() => run(command)}>{command.label}</button>)}</section>)}</div></section></div>, document.body);
}
