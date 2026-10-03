// OpenPOI API の性質を実データで測る再現用スクリプト（verify には含めない）。
// 使い方: npm run probe:openpoi > probe.json
// 28地点 × 約9回の GET を 250ms 間隔で順に送る（公表上限 200 req/s を大きく下回る）。結果は標準出力だけに出し、ファイルは書かない。
const API = 'https://api.openpoiapi.com/v1/search';
const POINTS = {
  東京駅: [139.7671, 35.6812], 渋谷: [139.7016, 35.658], 新宿: [139.7006, 35.6896], 池袋: [139.7109, 35.7295],
  三軒茶屋: [139.6702, 35.6437], 横浜: [139.6222, 35.466], 大宮: [139.6239, 35.9063], 千葉: [140.1133, 35.6131],
  名古屋: [136.8815, 35.1709], 京都: [135.7588, 34.9858], 梅田: [135.4959, 34.7025], 難波: [135.5023, 34.6663],
  三宮: [135.1955, 34.6946], 広島: [132.4752, 34.3978], 博多: [130.4207, 33.5897], 天神: [130.3989, 33.5916],
  札幌: [141.3508, 43.0687], 仙台: [140.8822, 38.2601], 新潟: [139.0613, 37.9121], 金沢: [136.6483, 36.5781],
  岡山: [133.9184, 34.6655], 松山: [132.7509, 33.834], 鹿児島中央: [130.5412, 31.5838], 那覇: [127.6793, 26.2146],
  軽井沢: [138.6347, 36.3427], 高山: [137.2522, 36.1408], 函館: [140.7266, 41.7737], 旭川: [142.3586, 43.7629],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const haversine = (lng1, lat1, lng2, lat2) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
};
const coords = (row) => { const lng = Number(row.lng); const lat = Number(row.lat); return row.lat === '' || !Number.isFinite(lat) || !Number.isFinite(lng) ? null : [lng, lat]; };
const key = (row) => `${row.name}|${row.address}`;
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const latencies = [];

async function search(lng, lat, radius, limit) {
  const url = `${API}?${new URLSearchParams({ center: `${lng},${lat}`, radius: String(Math.round(radius)), limit: String(limit) })}`;
  const started = performance.now();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  latencies.push(performance.now() - started);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const body = await response.json();
  await sleep(250);
  return { results: body.results ?? [], cors: response.headers.get('access-control-allow-origin') };
}
const ranked = (lng, lat, rows) => rows.map((row) => [row, coords(row)]).filter(([, c]) => c).map(([row, [x, y]]) => [haversine(lng, lat, x, y), key(row)]).sort((a, b) => a[0] - b[0]).map(([, k]) => k);

const summary = (values) => {
  const xs = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const q = (p) => { const i = (xs.length - 1) * p; const lo = Math.floor(i); return xs[lo] + (xs[Math.ceil(i)] - xs[lo]) * (i - lo); };
  return { n: xs.length, mean: round(xs.reduce((a, b) => a + b, 0) / xs.length, 3), median: round(q(0.5), 3), q1: round(q(0.25), 3), q3: round(q(0.75), 3), min: round(xs[0], 3), max: round(xs.at(-1), 3) };
};
const wilson = (k, n, z = 1.96) => {
  if (!n) return null;
  const p = k / n; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { k, n, p: round(p, 4), low: round((c - m) / d, 4), high: round((c + m) / d, 4) };
};

const rows = [];
let cors = null;
for (const [point, [lng, lat]] of Object.entries(POINTS)) {
  const row = { point };
  for (const radius of [100, 300, 1000]) row[`n${radius}`] = (await search(lng, lat, radius, 50)).results.length;
  const r50 = await search(lng, lat, 300, 50);
  cors ??= r50.cors;
  const distances = r50.results.map(coords).filter(Boolean).map(([x, y]) => haversine(lng, lat, x, y));
  row.sortedByDistance = distances.every((value, index) => index === 0 || distances[index - 1] <= value + 1);
  row.nearestMeters = distances.length ? Math.round(Math.min(...distances)) : null;
  row.unknownCategory = r50.results.filter((item) => item.category === 'unknown').length;
  row.missingCoordinates = r50.results.filter((item) => !coords(item)).length;
  row.total = r50.results.length;
  const r200 = await search(lng, lat, 300, 200);
  const truth = ranked(lng, lat, r200.results);
  const returned = new Set(r50.results.map(key));
  row.limit50NearestOverlap = truth.length >= 50 ? truth.slice(0, 50).filter((k) => returned.has(k)).length / 50 : null;
  const top10 = truth.slice(0, 10);
  for (const digits of [3, 2]) {
    const rl = round(lng, digits); const rt = round(lat, digits);
    const shift = haversine(lng, lat, rl, rt);
    // 半径は丸めた中心だけで決まる固定値（実装の NEARBY_RADIUS_METERS と同じ）。正確な位置との距離を漏らさない。
    const coarse = await search(rl, rt, digits === 3 ? 380 : 300 + 760, 200);
    const got = ranked(lng, lat, coarse.results).slice(0, 10);
    row[`round${digits}ShiftMeters`] = Math.round(shift);
    row[`round${digits}Top10Recall`] = top10.length ? top10.filter((k) => got.includes(k)).length / top10.length : null;
  }
  rows.push(row);
  process.stderr.write(`${point} `);
}
process.stderr.write('\n');

const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
console.log(JSON.stringify({
  measuredAt: new Date().toISOString(),
  method: { points: rows.length, endpoint: API, throttleMs: 250, note: 'top-10 truth = 10 nearest of limit=200 around the exact point; rounded queries use a fixed radius derived from the rounded cell only (380 m for 3 decimals, 1060 m for 2 decimals) and limit=200, re-ranked by exact distance' },
  cors,
  latencyMs: summary(latencies),
  countsAtLimit50: { r100: summary(rows.map((row) => row.n100)), r300: summary(rows.map((row) => row.n300)), r1000: summary(rows.map((row) => row.n1000)) },
  sortedByDistance: wilson(rows.filter((row) => row.sortedByDistance).length, rows.length),
  nearestMeters: summary(rows.map((row) => row.nearestMeters)),
  limit50NearestOverlap: summary(rows.map((row) => row.limit50NearestOverlap)),
  unknownCategory: wilson(sum('unknownCategory'), sum('total')),
  missingCoordinates: wilson(sum('missingCoordinates'), sum('total')),
  round3: { shiftMeters: summary(rows.map((row) => row.round3ShiftMeters)), top10Recall: summary(rows.map((row) => row.round3Top10Recall)), perfect: wilson(rows.filter((row) => row.round3Top10Recall === 1).length, rows.length) },
  round2: { shiftMeters: summary(rows.map((row) => row.round2ShiftMeters)), top10Recall: summary(rows.map((row) => row.round2Top10Recall)), perfect: wilson(rows.filter((row) => row.round2Top10Recall === 1).length, rows.length) },
  rows,
}, null, 2));
