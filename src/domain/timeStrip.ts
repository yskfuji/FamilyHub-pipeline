/**
 * 時刻の帯で、重なって見える印を別の段に分ける（段階12。18〜20時の点が重なっていた）。
 * 印の最小の幅（点の直径 12px）は帯の幅のおよそ 1/24 なので、範囲の 1/24 を最小の長さとして、左右に余白をとって比べる。
 */
export function stripLanes(marks: ReadonlyArray<{ start: number; minutes: number }>, range: number): number[] {
  const least = range / 24;
  const ends: number[] = [];
  return marks.map(({ start, minutes }) => {
    // 点（期限）は中心に置くので左右に半分ずつ、帯（予定）は始まりから最小の長さまで。
    const left = minutes > 0 ? start : start - least / 2;
    const right = Math.max(left + least, start + minutes);
    let lane = ends.findIndex((end) => end <= left);
    if (lane < 0) { lane = ends.length; ends.push(right); } else ends[lane] = right;
    return lane;
  });
}

export interface StripLayout {
  /** 帯の左の端と右の端（0時からの分）。3時間ごとにそろえる。 */
  from: number;
  to: number;
  /** 目盛り（分）。最後の目盛り（右の端）は字を出さないので含めない。 */
  ticks: number[];
  /** 印ごとの段（stripLanes）。 */
  lanes: number[];
  laneCount: number;
}

/** 時刻の帯の目盛りと段。朝6時から夜22時を基本に、印と今の時刻が入るように広げる。 */
export function stripLayout(marks: ReadonlyArray<{ start: number; minutes: number }>, now: number): StripLayout {
  const first = Math.min(6 * 60, ...marks.map((mark) => mark.start));
  const last = Math.max(22 * 60, ...marks.map((mark) => mark.start + mark.minutes), now);
  const from = Math.floor(first / 180) * 180;
  const to = Math.min(24 * 60, Math.ceil(last / 180) * 180);
  const ticks: number[] = [];
  for (let minute = from; minute < to; minute += 180) ticks.push(minute);
  const lanes = stripLanes(marks, to - from);
  return { from, to, ticks, lanes, laneCount: Math.max(1, ...lanes.map((lane) => lane + 1)) };
}

/** 帯の上の位置（0〜1）。範囲の外は端にそろえる。 */
export const stripPosition = (layout: Pick<StripLayout, 'from' | 'to'>, minutes: number) => (Math.min(layout.to, Math.max(layout.from, minutes)) - layout.from) / (layout.to - layout.from);
