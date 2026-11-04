/**
 * 図表の尺度。長さは 0 を基準にした割合（%）で返し、SVG の幅に対する割合としてそのまま使う。
 * 割合で描くので、画面の幅が変わっても比は変わらず、文字は拡大縮小されない。
 */

/** 位置と長さを 0.01% に丸める。描く位置が浮動小数の誤差で揺れないようにする。 */
export const roundPosition = (value: number) => Math.round(value * 100) / 100;

/**
 * 0 から始まる棒の長さ。最大の値を 100% にする。0 以下の値と、すべてが 0 のときは 0%。
 * 軸は必ず 0 から始め、最小の値から始めて差を大きく見せることはしない。
 */
export function lengthScale(values: readonly number[]) {
  const max = Math.max(0, ...values);
  return (value: number) => (max > 0 && value > 0 ? roundPosition((value / max) * 100) : 0);
}

/**
 * 中央を 0 にした、左右に伸びる棒。絶対値の最大を半分（50%）にあてる。
 * x は棒の左端、width は長さ。正の値は中央から右へ、負の値は中央から左へ伸びる。
 */
export function divergingScale(values: readonly number[]) {
  const max = Math.max(0, ...values.map((value) => Math.abs(value)));
  return (value: number) => {
    const width = max > 0 ? roundPosition((Math.abs(value) / max) * 50) : 0;
    return { x: value < 0 ? roundPosition(50 - width) : 50, width };
  };
}

/** 割合を SVG の属性の文字列にする。 */
export const percent = (value: number) => `${roundPosition(value)}%`;
