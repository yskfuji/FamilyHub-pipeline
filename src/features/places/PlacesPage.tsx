import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { detailId, useCloseTo } from '../../app/router';
import { DetailNotFound, Drawer, EmptyState, PageHeader, formatDateOnly, formatYen } from '../../design-system/components';
import { MapPinIcon, NoteIcon, YenIcon } from '../../design-system/icons';
import { ja } from '../../content/ja';
import { aggregatePlaces, sortPlaces, type PlaceSort } from '../../domain/places';
import { PlaceAttributionLink, PlaceSummary } from '../place/PlaceField';

const sortLabels: Record<PlaceSort, string> = { recent: '最近使った順', amount: '支出が多い順', frequency: 'よく使う順' };

/**
 * 支出とメモに記録した場所の一覧。地図や現在地は使わず、記録からまとめるだけ。
 * 既定は「最近使った順」。回数順は生活圏を推測しやすいため、利用者が選んだときだけ並べ替える。
 */
export function PlacesPage({ path }: { path: string }) {
  const { snapshot, can, requestQuickCreate } = useApp();
  const [sort, setSort] = useState<PlaceSort>('recent');
  const [query, setQuery] = useState('');
  const close = useCloseTo('/places');
  const all = aggregatePlaces(snapshot.expenses, snapshot.memos);
  const normalized = query.trim().toLowerCase();
  const items = sortPlaces(all, sort).filter((item) => !normalized || `${item.place.name} ${item.place.address ?? ''}`.toLowerCase().includes(normalized));
  const activeKey = detailId(path, '/places');
  const active = all.find((item) => item.key === activeKey);

  return <div className="page">
    <PageHeader eyebrow="場所" title="記録した場所" description="支出やメモに付けた場所を、まとめて確認できます。地図や現在地は使いません。"/>
    {activeKey && !active && <DetailNotFound what="場所" feature="places" backHref="/places"/>}
    {all.length === 0 ? <EmptyState title="まだ場所を記録していません" action={can('expense.create') ? <button data-control-id="places.expense.create" className="button primary" type="button" onClick={() => requestQuickCreate('expense')}><YenIcon width="18"/>支出を追加</button> : undefined}>支出やメモを追加するときに「場所を追加（任意）」から、現在地・写真・名前・手入力で場所を付けられます。</EmptyState> : <>
      <div className="places-toolbar">
        <div className="field"><label htmlFor="places-search">場所を検索</label><input data-control-id="places.search" id="places-search" className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-describedby="places-search-help"/><span className="field-help" id="places-search-help">場所の名前と住所から探します。</span></div>
        <div className="segmented" role="group" aria-label="並べ替え">{(Object.keys(sortLabels) as PlaceSort[]).map((value) => <button key={value} data-control-id={`places.sort.${value}`} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>{sortLabels[value]}</button>)}</div>
      </div>
      <p className="small muted" role="status">{items.length}か所{normalized ? `（「${query.trim()}」に一致）` : ''}</p>
      {items.length === 0 ? <EmptyState title="条件に合う場所はありません">検索語を短くしてください。</EmptyState> : <ul className="places-grid">{items.map((item) => <li key={item.key}>
        <a data-control-id={`places.open.${item.key}`} className="card place-card" href={`/places/${item.key}`} data-link>
          <span className="place-card-head"><MapPinIcon width="20"/><strong className="wrap">{item.place.name}</strong></span>
          {item.place.address && <span className="meta wrap">{item.place.address}</span>}
          <span className="place-card-stats">
            {item.expenseCount > 0 && <span>支出{item.expenseCount}件・<span className="amount">{formatYen(item.expenseTotalJpy)}</span></span>}
            {item.memoCount > 0 && <span>メモ{item.memoCount}件</span>}
          </span>
          <span className="small muted">最後の記録：{formatDateOnly(item.lastUsedOn)}</span>
        </a>
      </li>)}</ul>}
    </>}
    {active && <Drawer eyebrow="記録した場所" title={active.place.name} onClose={close}>
      <div className="stack">
        <PlaceSummary place={active.place}/>
        {active.place.provenance && <PlaceAttributionLink where="places"/>}
        <section aria-labelledby="place-uses-title"><h3 id="place-uses-title">この場所の記録（{active.uses.length}件）</h3>
          <ul className="list">{active.uses.map((use) => <li className="list-row" key={`${use.kind}-${use.id}`}>
            {use.kind === 'expense' ? <YenIcon width="22"/> : <NoteIcon width="22"/>}
            <div className="row-main"><a data-control-id={`places.use.${use.kind}.${use.id}`} className="row-link" href={use.kind === 'expense' ? `/budget/${use.id}` : `/notes/${use.id}`} data-link><strong>{use.title}</strong></a><span className="meta">{use.kind === 'expense' ? '支出' : 'メモ'} · {formatDateOnly(use.date)}</span></div>
            {use.amountJpy !== undefined && <span className="amount">{formatYen(use.amountJpy)}</span>}
          </li>)}</ul>
        </section>
        <p className="small muted mb-0">{ja.place.legend}は、記録した支出・メモからまとめています。場所を外したり支出・メモを削除したりすると、この一覧からも外れます。見られるのは管理者と大人のメンバーだけです。</p>
      </div>
    </Drawer>}
  </div>;
}
