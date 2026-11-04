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
