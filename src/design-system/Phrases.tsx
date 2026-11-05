import { Fragment } from 'react';

/**
 * 区切りで並べた短い文（「2026年9月29日 · 教育・保育 · 支払った人：碧さん」など）を、まとまりごとに折り返す。
 * 文節で折り返しても「支払った / 人」や「・日本時間」のように切れるので、まとまりの中では折り返さず、
 * 区切りは前のまとまりの後ろに付けて、行の頭に来ないようにする。1つのまとまりが欄より長いときだけ中で折り返す。
 */
export function Phrases({ parts, separator = ' · ' }: { parts: readonly string[]; separator?: string }) {
  return <>{parts.map((part, index) => <Fragment key={index}><span className="phrase">{part}{index < parts.length - 1 ? separator.trimEnd() : ''}</span>{index < parts.length - 1 && separator.endsWith(' ') ? ' ' : ''}</Fragment>)}</>;
}
