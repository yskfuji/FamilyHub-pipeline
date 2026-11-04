import type { Season } from '../../domain/season';
import { Kaki } from './parts';

/** 季節の場面の丘。幅 120・高さ 64 の枠の下に置く。 */
const Hill = ({ fill }: { fill: string }) => <path d="M0 64c18-14 44-20 68-14s38 6 52-2v16Z" fill={fill} stroke="none"/>;
const Blossom = ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x} ${y})`}>
  {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cy="-4.5" rx="3" ry="4.5" transform={`rotate(${angle})`} fill="var(--brand-soft)" stroke="var(--brand)"/>)}
  <circle r="1.6" fill="var(--brand)" stroke="none"/>
</g>;
const Flake = ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x} ${y})`} stroke="var(--accent)">{[0, 60, 120].map((angle) => <path key={angle} d="M0-6v12" transform={`rotate(${angle})`}/>)}</g>;

const scenes: Record<Season, React.ReactNode> = {
  // 春：桜の枝と、若草の丘
  spring: <><Hill fill="var(--moss-soft)"/><path d="M8 8c18 4 34 14 46 28M30 14c2 6 0 12-4 16" stroke="var(--ink-soft)"/><Blossom x={24} y={10}/><Blossom x={44} y={24}/><Blossom x={26} y={32}/><Blossom x={60} y={40}/></>,
  // 夏：日と、波
  summer: <><circle cx="88" cy="20" r="9" fill="var(--sheet)" stroke="var(--gold)"/><path d="M88 4v3M72 20h3M101 20h3M76.7 8.7l2.1 2.1M99.3 8.7l-2.1 2.1" stroke="var(--gold)"/><path d="M0 64V48c8-6 16-6 24 0s16 6 24 0 16-6 24 0 16 6 24 0 16-6 24 0v16Z" fill="var(--info-soft)" stroke="var(--accent)"/><path d="M14 40c6-4 12-4 18 0" stroke="var(--accent)"/></>,
  // 秋：実のなった柿の枝
  autumn: <><Hill fill="var(--art-ground)"/><path d="M4 10c26 0 52 8 76 20s28 14 36 14" stroke="var(--ink-soft)"/><path d="M48 14c4-8 12-10 18-7-4 8-12 10-18 7Z" fill="var(--moss-soft)" stroke="var(--moss)"/><path d="M36 14v6M76 28v6" stroke="var(--ink-soft)"/><Kaki x={36} y={30} s={0.7}/><Kaki x={76} y={44} s={0.8}/></>,
  // 冬：雪の丘と松、雪の結晶
  winter: <><Hill fill="var(--sheet)"/><path d="M0 64c18-14 44-20 68-14s38 6 52-2" stroke="var(--line-strong)"/><path d="m92 50 8-26 8 26Z" fill="var(--moss-soft)" stroke="var(--moss)"/><path d="M100 50v6" stroke="var(--moss)"/><Flake x={24} y={18}/><Flake x={56} y={10}/><Flake x={44} y={34}/></>,
};

/** 今日の画面の季節の場面。日付（家族の時間帯での今日）から季節を決める。飾りなので読み上げには現れない。 */
export function SeasonScene({ season }: { season: Season }) {
  return <svg className="illustration season-scene" data-season={season} viewBox="0 0 120 64" aria-hidden="true" focusable="false" fill="none" stroke="var(--ink-soft)" strokeLinecap="round" strokeLinejoin="round">{scenes[season]}</svg>;
}
