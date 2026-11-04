import type { ReactNode } from 'react';
import { divergingScale, lengthScale, percent } from './scale';

/**
 * 手で書いた横棒の図表。依存する部品はない。
 * - 値は位置と長さだけで表す（円や扇形は描かない）。軸は 0 から始める。
 * - 値は棒の先に直接書く。色は --chart-1〜6（data-tone）だけを使い、系列の名前も文字で添えるので、色だけに頼らない。
 * - 幅は SVG の幅に対する割合で描く。文字は拡大縮小せず、棒の先の文字の分は .chart-track の余白（--layout-chart-*）に空ける。
 * - SVG はすべて aria-hidden。読み上げは ChartFrame の要約と表で行う。
 */

/** 1行の高さと棒の太さ（px）。棒は 24px より細くし、行の残りは空ける。 */
const ROW = 24;
const BAR = 12;
const LABEL_GAP = 6;

export type ChartTone = 1 | 2 | 3 | 4 | 5 | 6;
/** 棒の先の文字に空ける幅。share は金額と割合、yen は金額、count は件数。 */
export type LabelRoom = 'share' | 'yen' | 'count';

/** 棒1本。データの端だけ角を丸め、基準（0）の側は角を立てる。 */
function BarMark({ x, width, tone, toward }: { x: number; width: number; tone: ChartTone; toward: 'right' | 'left' }) {
  if (width <= 0) return null;
  const y = (ROW - BAR) / 2;
  const half = width / 2;
  return <g className="chart-mark" data-tone={tone} data-toward={toward}>
    <rect className="chart-bar" x={percent(x)} y={y} width={percent(width)} height={BAR} rx={4}/>
    <rect x={percent(toward === 'right' ? x : x + half)} y={y} width={percent(half)} height={BAR}/>
  </g>;
}

/** 0 から右へ伸びる棒と、その先の値。length は 0〜100（%）。 */
export function BarTrack({ length, tone, label, room }: { length: number; tone: ChartTone; label: ReactNode; room: LabelRoom }) {
  return <span className="chart-track" data-room={room}>
    <svg className="chart-svg" width="100%" height={ROW} overflow="visible" aria-hidden="true" focusable="false">
      <BarMark x={0} width={length} tone={tone} toward="right"/>
      <text className="chart-label" data-zero={length > 0 ? undefined : 'true'} x={percent(length)} dx={length > 0 ? LABEL_GAP : 0} y={ROW / 2} dy=".35em">{label}</text>
    </svg>
  </span>;
}

export interface BarItem { key: string; name: string; value: number; label: ReactNode }

/**
 * 1系列の横棒（多い順に並べて渡す）。名前を棒の上に置くので、長い名前でも棒の長さを削らない。
 * wrap を渡すと、行ごとにリンクなどで包む（操作の ID は呼ぶ側に書く）。
 */
export function BarChart({ items, tone, room, wrap }: { items: readonly BarItem[]; tone: ChartTone; room: LabelRoom; wrap?: (item: BarItem, content: ReactNode) => ReactNode }) {
  const scale = lengthScale(items.map((item) => item.value));
  return <ul className="chart-bars">{items.map((item) => {
    const content = <span className="chart-bar-row"><span className="chart-name">{item.name}</span><BarTrack length={scale(item.value)} tone={tone} label={item.label} room={room}/></span>;
    return <li key={item.key}>{wrap ? wrap(item, content) : content}</li>;
  })}</ul>;
}

export interface Series { key: string; name: string; tone: ChartTone }
export interface BarGroup {
  key: string;
  name: string;
  /** 名前の下に添える短い印（今月・今日）。印のある組は名前を太くする。 */
  mark?: string;
  values: Readonly<Record<string, number>>;
  labels: Readonly<Record<string, string>>;
}

/**
 * 組ごとに系列を並べた横棒（月ごとの支出、日ごとの予定とタスク）。すべての棒が同じ尺度を使う。
 * 系列が2つ以上なら系列の名前を棒の左に毎回書くので、凡例を置かない。1つなら名前は見出しに任せる。
 * 値が 0 の組も、0 の文字を（控えめに）出して空けない。
 */
export function GroupedBarChart({ groups, series, room }: { groups: readonly BarGroup[]; series: readonly Series[]; room: LabelRoom }) {
  const scale = lengthScale(groups.flatMap((group) => series.map((item) => group.values[item.key] ?? 0)));
  return <div className="chart-groups" data-series={series.length}>{groups.map((group) => <div className="chart-group" key={group.key} data-marked={group.mark ? 'true' : undefined}>
    <span className="chart-group-name"><span>{group.name}</span>{group.mark && <span className="chart-group-mark">{group.mark}</span>}</span>
    {series.map((item) => <span className="chart-series-row" key={item.key}>
      {series.length > 1 && <span className="chart-series">{item.name}</span>}
      <BarTrack length={scale(group.values[item.key] ?? 0)} tone={item.tone} label={group.labels[item.key]} room={room}/>
    </span>)}
  </div>)}</div>;
}

export interface DivergingItem { key: string; name: string; value: number; label: string }

/**
 * 中央を 0 にした左右の棒（受け取る人は右、支払う人は左）。値の文字は、棒のない側の中央の脇に書く。
 * 向きは文字（受け取る・支払う）で書くので、色に頼らない。
 */
export function DivergingBarChart({ items, positiveTone, negativeTone }: { items: readonly DivergingItem[]; positiveTone: ChartTone; negativeTone: ChartTone }) {
  const scale = divergingScale(items.map((item) => item.value));
  return <div className="chart-diverging">{items.map((item) => {
    const { x, width } = scale(item.value);
    const right = item.value >= 0;
    return <span className="chart-bar-row" key={item.key}>
      <span className="chart-name">{item.name}</span>
      <span className="chart-track" data-room="none">
        <svg className="chart-svg" width="100%" height={ROW + 8} overflow="visible" aria-hidden="true" focusable="false">
          <line className="chart-axis" x1="50%" x2="50%" y1={0} y2={ROW + 8}/>
          <g transform="translate(0 4)">
            <BarMark x={x} width={width} tone={right ? positiveTone : negativeTone} toward={right ? 'right' : 'left'}/>
            <text className="chart-label" x="50%" dx={right ? -LABEL_GAP : LABEL_GAP} y={ROW / 2} dy=".35em" textAnchor={right ? 'end' : 'start'}>{item.label}</text>
          </g>
        </svg>
      </span>
    </span>;
  })}</div>;
}
