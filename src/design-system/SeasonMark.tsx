import type { Season } from '../domain/season';
import { seasonOf } from '../domain/season';

const scenes: Record<Season, React.ReactNode> = {
  // 春：五枚の花びら
  spring: <>{[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="20" cy="11" rx="4.6" ry="7" transform={`rotate(${angle} 20 20)`} fill="var(--persimmon-soft)" stroke="var(--persimmon)" strokeWidth="1.5"/>)}<circle cx="20" cy="20" r="2.6" fill="var(--persimmon)"/></>,
  // 夏：太陽と波
  summer: <><circle cx="20" cy="15" r="6.5" fill="var(--persimmon-soft)" stroke="var(--persimmon)" strokeWidth="1.5"/><path d="M20 3.5v2.8M8.5 15h2.8M29.2 15H32M11.9 6.9l2 2M28.1 6.9l-2 2" stroke="var(--persimmon)" strokeWidth="1.5" strokeLinecap="round"/><path d="M5 28c3.7-3 7.3-3 11 0s7.3 3 11 0 5.5-2.7 8-1.2M5 34c3.7-3 7.3-3 11 0s7.3 3 11 0 5.5-2.7 8-1.2" fill="none" stroke="var(--indigo)" strokeWidth="1.5" strokeLinecap="round"/></>,
  // 秋：一枚の葉
  autumn: <><path d="M20 4c2 3.4 3.4 5 3.6 8.4 2.2-1.6 4.8-2.2 8-2-1 2.8-1.2 5 .4 7.8-2.4.6-3.8 1.8-4.8 3.8 1.8 1 3 2 4 3.8-3.4.8-6.6.8-9.8-.4L20 28l-1.4-2.6c-3.2 1.2-6.4 1.2-9.8.4 1-1.8 2.2-2.8 4-3.8-1-2-2.4-3.2-4.8-3.8 1.6-2.8 1.4-5 .4-7.8 3.2-.2 5.8.4 8 2C16.6 9 18 7.4 20 4Z" fill="var(--persimmon-soft)" stroke="var(--persimmon)" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 13v22" stroke="var(--persimmon)" strokeWidth="1.5" strokeLinecap="round"/></>,
  // 冬：雪の結晶
  winter: <g stroke="var(--indigo)" strokeWidth="1.5" strokeLinecap="round" fill="none">{[0, 60, 120].map((angle) => <g key={angle} transform={`rotate(${angle} 20 20)`}><path d="M20 5v30"/><path d="m16 9 4 4 4-4M16 31l4-4 4 4"/></g>)}</g>,
};

/** 季節の小さな飾り。日付から決まり、読み上げには現れない。 */
export function SeasonMark({ date }: { date: string }) {
  const season = seasonOf(date);
  return <svg className="season-mark" data-season={season} viewBox="0 0 40 40" aria-hidden="true" focusable="false">{scenes[season]}</svg>;
}
