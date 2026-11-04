import type { SearchResult, SearchResultKind } from '../data/gateway';

/** 検索の結果のまとまりの順と見出し（A17-5）。予定・タスク・メモ・家計・場所・関連リンク・アルバム・写真と動画。 */
export const searchGroupOrder: readonly SearchResultKind[] = ['event', 'task', 'memo', 'expense', 'place', 'resource', 'album', 'albumItem'];
export const searchGroupLabels: Readonly<Record<SearchResultKind, string>> = { event: '予定', task: 'タスク', memo: 'メモ', expense: '家計', place: '場所', resource: '関連リンク', album: 'アルバム', albumItem: '写真・動画' };

/** 結果を種類ごとにまとめる。まとまりの中では受け取った順を保ち、結果のない種類は出さない。 */
export function groupSearchResults(results: readonly SearchResult[]): Array<{ kind: SearchResultKind; label: string; items: SearchResult[] }> {
  return searchGroupOrder
    .map((kind) => ({ kind, label: searchGroupLabels[kind], items: results.filter((result) => result.kind === kind) }))
    .filter((group) => group.items.length > 0);
}
