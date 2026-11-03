/** WCAG 2.2 の相対輝度。#rrggbb だけを受け付ける。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const unit = parseInt(hex.slice(start, start + 2), 16) / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 利用者が選んだ色の上にのせる文字の色。白と黒のうち比の大きい方。
 * どの色でも 4.58:1 以上になる（白と黒の比 21 の平方根）。テーマに関係なく同じ色を返す。
 */
export function readableTextOn(background: string): '#ffffff' | '#000000' {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return '#ffffff';
  return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? '#ffffff' : '#000000';
}
