import { useEffect, useRef } from 'react';
import { navigate, useSearch, withQueryParam } from '../../app/router';
import { filterHelpItems, helpCategories, helpItems, parseHelpCategory, type HelpCategory } from '../../content/help';
import { EmptyState } from '../../design-system/components';
import { EmptySearch } from '../../design-system/illustrations/EmptySearch';

/** 検索語、分類、開いている質問はすべて URL に持つ。そのままリンクとして渡せる。 */
export default function HelpSection() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const query = params.get('q') ?? '';
  const category = parseHelpCategory(params.get('category'));
  const itemId = params.get('item');
  const results = filterHelpItems(helpItems, query, category);
  const opened = useRef<HTMLDetailsElement>(null);
  const firstOpen = useRef(itemId);
  // リンクで開いたときは、その質問まで送る。
  useEffect(() => { if (firstOpen.current) opened.current?.scrollIntoView({ block: 'center' }); }, []);
  const setParam = (name: string, value: string | null) => navigate(withQueryParam(name, value), true, true);
  const chooseCategory = (value: HelpCategory | null) => setParam('category', value);
  return <div className="stack help">
    <div className="field help-search"><label htmlFor="help-search">ヘルプを検索</label><input data-control-id="settings.help.search" className="input" id="help-search" type="search" value={query} onChange={(event) => setParam('q', event.target.value || null)}/></div>
    <div className="segmented help-categories" role="group" aria-label="質問の分類">
      <button data-control-id="settings.help.category.all" type="button" aria-pressed={category === null} onClick={() => chooseCategory(null)}>すべて</button>
      {helpCategories.map(({ id, label }) => <button data-control-id={`settings.help.category.${id}`} key={id} type="button" aria-pressed={category === id} onClick={() => chooseCategory(id)}>{label}</button>)}
    </div>
    <p className="meta mb-0" role="status">{results.length}件の質問</p>
    {results.length === 0
      ? <EmptyState title="一致する質問はありません" illustration={<EmptySearch/>} action={<button data-control-id="settings.help.clear" className="button" type="button" onClick={() => navigate(window.location.pathname, true, true)}>条件を消す</button>}>語を短くするか、分類を「すべて」に戻してください。</EmptyState>
      : <div className="stack help-list">{results.map((item) => <details className="card flat help-item" key={item.id} id={`help-${item.id}`} ref={item.id === itemId ? opened : undefined} open={item.id === itemId} onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== (item.id === new URLSearchParams(window.location.search).get('item'))) { if (open) setParam('item', item.id); else if (item.id === new URLSearchParams(window.location.search).get('item')) setParam('item', null); }
      }}>
        <summary>{item.question}</summary>
        {item.answer.map((text) => <p key={text}>{text}</p>)}
        {item.related && <a data-control-id={`settings.help.related.${item.id}`} className="button" href={item.related.href} data-link>{item.related.label}</a>}
      </details>)}</div>}
  </div>;
}
