/**
 * 書き出しに使う SVG の小さな読み手。path の命令（M L H V C S Q T A Z と小文字）を、絶対座標の M・L・C・Z だけにする。
 * 円弧と2次の曲線は3次の曲線に直す。変換の行列（translate・scale・rotate・matrix）を点にかける。
 */

/** [a, b, c, d, e, f]: x' = a x + c y + e、y' = b x + d y + f。 */
export const identity = [1, 0, 0, 1, 0, 0];
export const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** transform 属性を行列にする。 */
export function parseTransform(text = '') {
  let matrix = identity;
  for (const [, name, raw] of text.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = raw.trim().split(/[\s,]+/).map(Number);
    let next;
    if (name === 'translate') next = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (name === 'scale') next = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (name === 'rotate') {
      const angle = (v[0] * Math.PI) / 180; const cos = Math.cos(angle); const sin = Math.sin(angle);
      const rotation = [cos, sin, -sin, cos, 0, 0];
      next = v.length === 3 ? multiply(multiply([1, 0, 0, 1, v[1], v[2]], rotation), [1, 0, 0, 1, -v[1], -v[2]]) : rotation;
    } else if (name === 'matrix') next = v;
    else throw new Error(`unsupported transform ${name}`);
    matrix = multiply(matrix, next);
  }
  return matrix;
}

/** 円弧を3次の曲線に直す（SVG 1.1 の付録 F.6）。 */
function arcToCurves(x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [['L', x2, y2]];
  const phi = (angle * Math.PI) / 180; const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy; const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (coefficient * rx * y1p) / ry; const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2; const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleOf = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const derivative = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let index = 0; index < segments; index += 1) {
    const t1 = theta1 + index * step; const t2 = t1 + step;
    const [p1x, p1y] = point(t1); const [p2x, p2y] = point(t2);
    const [d1x, d1y] = derivative(t1); const [d2x, d2y] = derivative(t2);
    out.push(['C', p1x + k * d1x, p1y + k * d1y, p2x - k * d2x, p2y - k * d2y, p2x, p2y]);
  }
  return out;
}

/** path の d を、絶対座標の [['M',x,y] | ['L',x,y] | ['C',x1,y1,x2,y2,x,y] | ['Z']] にする。 */
export function normalizePath(d) {
  const tokens = [...d.matchAll(/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map((match) => match[0]);
  const out = [];
  let index = 0; let command = ''; let x = 0; let y = 0; let startX = 0; let startY = 0;
  let lastCubic = null; let lastQuad = null;
  const number = () => Number(tokens[index++]);
  // 円弧の旗（0 か 1）は、区切りなしで続くことがある（a20 20 0 0 1-20 20 は分かれているが、01 のような書き方もある）。
  const flag = () => {
    const token = tokens[index];
    if (token.length > 1 && /^[01]/.test(token)) { tokens[index] = token.slice(1); return Number(token[0]); }
    index += 1; return Number(token);
  };
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0; const oy = relative ? y : 0;
    const upper = command.toUpperCase();
    if (upper !== 'C' && upper !== 'S') lastCubic = null;
    if (upper !== 'Q' && upper !== 'T') lastQuad = null;
    switch (upper) {
      case 'M': x = ox + number(); y = oy + number(); startX = x; startY = y; out.push(['M', x, y]); command = relative ? 'l' : 'L'; break;
      case 'L': x = ox + number(); y = oy + number(); out.push(['L', x, y]); break;
      case 'H': x = ox + number(); out.push(['L', x, y]); break;
      case 'V': y = oy + number(); out.push(['L', x, y]); break;
      case 'C': { const c1x = ox + number(); const c1y = oy + number(); const c2x = ox + number(); const c2y = oy + number(); x = ox + number(); y = oy + number(); out.push(['C', c1x, c1y, c2x, c2y, x, y]); lastCubic = [c2x, c2y]; break; }
      case 'S': { const c1x = lastCubic ? 2 * x - lastCubic[0] : x; const c1y = lastCubic ? 2 * y - lastCubic[1] : y; const c2x = ox + number(); const c2y = oy + number(); x = ox + number(); y = oy + number(); out.push(['C', c1x, c1y, c2x, c2y, x, y]); lastCubic = [c2x, c2y]; break; }
      case 'Q': case 'T': {
        const [qx, qy] = upper === 'Q' ? [ox + number(), oy + number()] : (lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y]);
        const ex = ox + number(); const ey = oy + number();
        out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        x = ex; y = ey; lastQuad = [qx, qy]; break;
      }
      case 'A': {
        const rx = number(); const ry = number(); const angle = number(); const large = flag(); const sweep = flag();
        const ex = ox + number(); const ey = oy + number();
        out.push(...arcToCurves(x, y, rx, ry, angle, large, sweep, ex, ey));
        x = ex; y = ey; break;
      }
      case 'Z': out.push(['Z']); x = startX; y = startY; break;
      default: throw new Error(`unsupported path command ${command}`);
    }
  }
  return out;
}

const KAPPA = 0.5522847498307936;
/** 楕円を4つの3次の曲線で。 */
export function ellipsePath(cx, cy, rx, ry) {
  const kx = rx * KAPPA; const ky = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
}

/** 角の丸い四角。 */
export function rectPath(x, y, width, height, rx = 0, ry = rx) {
  rx = Math.min(rx, width / 2); ry = Math.min(ry, height / 2);
  if (!rx || !ry) return [['M', x, y], ['L', x + width, y], ['L', x + width, y + height], ['L', x, y + height], ['Z']];
  const kx = rx * KAPPA; const ky = ry * KAPPA;
  return [
    ['M', x + rx, y], ['L', x + width - rx, y],
    ['C', x + width - rx + kx, y, x + width, y + ry - ky, x + width, y + ry], ['L', x + width, y + height - ry],
    ['C', x + width, y + height - ry + ky, x + width - rx + kx, y + height, x + width - rx, y + height], ['L', x + rx, y + height],
    ['C', x + rx - kx, y + height, x, y + height - ry + ky, x, y + height - ry], ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y], ['Z'],
  ];
}

/** 命令の列に行列をかける。 */
export const transformPath = (commands, matrix) => commands.map(([kind, ...values]) => {
  const out = [kind];
  for (let index = 0; index < values.length; index += 2) out.push(...apply(matrix, values[index], values[index + 1]));
  return out;
});

/** 生成した SVG の文字列から要素の木を作る（属性だけで、文字の中身はない前提）。 */
export function parseMarkup(markup) {
  const root = { name: '#root', attributes: {}, children: [] };
  const stack = [root];
  for (const [, closing, name, rawAttributes, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (closing) { stack.pop(); continue; }
    const attributes = Object.fromEntries([...rawAttributes.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replace(/&quot;/g, '"').replace(/&amp;/g, '&')]));
    const node = { name, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0];
}
