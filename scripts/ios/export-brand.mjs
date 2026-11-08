#!/usr/bin/env node
/**
 * ブランドの印（柿の印、src/design-system/components.tsx の BrandMark）と名前の字形（src/design-system/wordmark.ts）を、
 * SwiftUI の Path を作るコードに書き出す。形は手で写さない。
 *
 *   node scripts/ios/export-brand.mjs [--check]
 */
import { readFileSync } from 'node:fs';
import { writeGenerated } from './generated.mjs';

/** SVG の path（M L H V Q C S Z と小文字）を、絶対座標の命令の列にする。 */
function commands(d) {
  const tokens = [...d.matchAll(/[MLHVQCSZmlhvqcsz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g)].map((match) => match[0]);
  const out = [];
  let index = 0; let command = ''; let x = 0; let y = 0; let startX = 0; let startY = 0; let lastControl = null;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0; const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M': x = ox + number(); y = oy + number(); startX = x; startY = y; out.push(['move', x, y]); command = relative ? 'l' : 'L'; lastControl = null; break;
      case 'L': x = ox + number(); y = oy + number(); out.push(['line', x, y]); lastControl = null; break;
      case 'H': x = ox + number(); out.push(['line', x, y]); lastControl = null; break;
      case 'V': y = oy + number(); out.push(['line', x, y]); lastControl = null; break;
      case 'Q': { const cx = ox + number(); const cy = oy + number(); x = ox + number(); y = oy + number(); out.push(['quad', cx, cy, x, y]); lastControl = null; break; }
      case 'C': { const c1x = ox + number(); const c1y = oy + number(); const c2x = ox + number(); const c2y = oy + number(); x = ox + number(); y = oy + number(); out.push(['curve', c1x, c1y, c2x, c2y, x, y]); lastControl = [c2x, c2y]; break; }
      case 'S': {
        const c1x = lastControl ? 2 * x - lastControl[0] : x; const c1y = lastControl ? 2 * y - lastControl[1] : y;
        const c2x = ox + number(); const c2y = oy + number(); x = ox + number(); y = oy + number();
        out.push(['curve', c1x, c1y, c2x, c2y, x, y]); lastControl = [c2x, c2y]; break;
      }
      case 'Z': out.push(['close']); x = startX; y = startY; lastControl = null; break;
      default: throw new Error(`unsupported path command ${command}`);
    }
  }
  return out;
}

const round = (value) => Number(value.toFixed(3));
const point = (x, y) => `p(${round(x)}, ${round(y)})`;
const swiftPath = (d) => commands(d).map(([kind, ...v]) => {
  if (kind === 'move') return `    path.move(to: ${point(v[0], v[1])})`;
  if (kind === 'line') return `    path.addLine(to: ${point(v[0], v[1])})`;
  if (kind === 'quad') return `    path.addQuadCurve(to: ${point(v[2], v[3])}, control: ${point(v[0], v[1])})`;
  if (kind === 'curve') return `    path.addCurve(to: ${point(v[4], v[5])}, control1: ${point(v[0], v[1])}, control2: ${point(v[2], v[3])})`;
  return '    path.closeSubpath()';
}).join('\n');

const wordmarkSource = readFileSync('src/design-system/wordmark.ts', 'utf8');
const wordmark = wordmarkSource.match(/width:\s*(\d+),\s*height:\s*(\d+),\s*path:\s*'([^']+)'/);
const brandSvg = readFileSync('src/design-system/components.tsx', 'utf8').match(/<svg className="brand-mark"[\s\S]*?<\/svg>/)[0];
const [fruit, stem] = [...brandSvg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);

const shape = (name, doc, width, height, d) => `/// ${doc}
public struct ${name}: Shape {
  public static let size = CGSize(width: ${width}, height: ${height})
  public init() {}
  public func path(in rect: CGRect) -> Path {
    let scale = min(rect.width / Self.size.width, rect.height / Self.size.height)
    let dx = rect.minX + (rect.width - Self.size.width * scale) / 2
    let dy = rect.minY + (rect.height - Self.size.height * scale) / 2
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: dx + x * scale, y: dy + y * scale) }
    var path = Path()
${swiftPath(d)}
    return path
  }
}`;

const swift = `// 生成したファイル。手で書き換えない。node scripts/ios/export-brand.mjs で作り直す。
// 元: src/design-system/wordmark.ts（Noto Serif JP Bold、SIL Open Font License 1.1 の字形）、src/design-system/components.tsx の BrandMark
import SwiftUI

${shape('WordmarkShape', 'ブランドの名前「よりどころ」の字形。', wordmark[1], wordmark[2], wordmark[3])}

${shape('BrandFruitShape', '柿の印の実（塗りは --kaki-soft、線は --kaki）。', 48, 48, fruit)}

${shape('BrandStemShape', '柿の印のへた（線は --kaki-stem）。', 48, 48, stem)}
`;

writeGenerated('ios/Packages/FamilyHubKit/Sources/FHDesign/Generated/Brand.swift', swift);
