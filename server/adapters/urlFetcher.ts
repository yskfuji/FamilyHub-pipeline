import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_TIMEOUT_MS = 10_000;
export const PAGE_MAX_REDIRECTS = 3;
const MAX_TEXT_CHARS = 8000;

export type PageFailure = 'invalid' | 'blocked' | 'unreachable' | 'redirects' | 'too-large' | 'not-text' | 'timeout';

export class PageRefused extends Error {
  readonly code: PageFailure;
  constructor(code: PageFailure) { super(code); this.code = code; }
}

const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  // 公開の範囲にある、クラウドのメタデータ。
  ['168.63.129.16', 32],
];

const IPV6_UNICAST_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32], ['3fff::', 20],
];

const bytesOfV4 = (address: string) => address.split('.').map(Number);

function bytesOfV6(address: string): number[] {
  const bare = address.split('%')[0].toLowerCase();
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  const hex = tail ? `${tail[1]}${((Number(tail[2].split('.')[0]) << 8) + Number(tail[2].split('.')[1])).toString(16)}:${((Number(tail[2].split('.')[2]) << 8) + Number(tail[2].split('.')[3])).toString(16)}` : bare;
  const [head, rest] = hex.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const groups = hex.includes('::') ? [...left, ...Array.from({ length: 8 - left.length - right.length }, () => '0'), ...right] : left;
  return groups.flatMap((group) => { const value = parseInt(group, 16); return [value >> 8, value & 255]; });
}

function within(bytes: readonly number[], network: readonly number[], bits: number) {
  for (let index = 0; index * 8 < bits; index += 1) {
    const mask = bits - index * 8 >= 8 ? 255 : (255 << (8 - (bits - index * 8))) & 255;
    if ((bytes[index] & mask) !== (network[index] & mask)) return false;
  }
  return true;
}

const forbiddenV4 = (bytes: readonly number[]) => IPV4_BLOCKED.some(([network, bits]) => within(bytes, bytesOfV4(network), bits));

function forbiddenV6(bytes: readonly number[]) {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((value) => value === 0);
  // 中に IPv4 を埋め込む形は、埋め込まれた先で判定する。
  if (zeros(0, 10) && bytes[10] === 255 && bytes[11] === 255) return forbiddenV4(bytes.slice(12));
  if (within(bytes, bytesOfV6('64:ff9b::'), 96)) return forbiddenV4(bytes.slice(12));
  if (within(bytes, bytesOfV6('2002::'), 16)) return forbiddenV4(bytes.slice(2, 6));
  // それ以外は、グローバルユニキャスト（2000::/3）のほかをすべて拒む。
  if (!within(bytes, bytesOfV6('2000::'), 3)) return true;
  return IPV6_UNICAST_BLOCKED.some(([network, bits]) => within(bytes, bytesOfV6(network), bits));
}

/** 接続してはいけない宛先か。読めないものも拒む。 */
export function isForbiddenAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(bare);
  if (family === 4) return forbiddenV4(bytesOfV4(bare));
  if (family === 6) return forbiddenV6(bytesOfV6(bare));
  return true;
}

const TRACKING_PREFIXES = ['utm_', 'hsa_', 'pk_', 'mtm_', 'oly_', 'vero_', 'mc_'];
const TRACKING_NAMES = new Set(['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid', 'igsh', 'li_fat_id', 'epik', 'rb_clickid', 's_cid', 'sc_cid', 'ref_src', 'ref_url', '_ga', '_gl', '_hsenc', '_hsmi', 'mkt_tok', 'trk', 'wickedid', 'ml_subscriber', 'ml_subscriber_hash']);

/** 追跡のための引数と断片を除く。 */
export function stripTracking(url: URL) {
  const clean = new URL(url);
  clean.hash = '';
  for (const name of [...clean.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (TRACKING_NAMES.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) clean.searchParams.delete(name);
  }
  return clean;
}

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.localdomain'];

/** 内部の名前か。名前を引く前に拒む。 */
export function isForbiddenName(host: string) {
  return host === 'localhost' || !host.includes('.') || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type ResolveHost = (host: string) => Promise<ReadonlyArray<{ address: string }>>;

export interface PageFetcherOptions {
  /** 試験の代役にだけ渡す。本番の組み立てでは渡さない。 */
  testing?: { allowHttp?: boolean; allowAnyPort?: boolean; isForbidden?: (address: string) => boolean };
  resolve?: ResolveHost;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FetchedPage { url: string; text: string }

export interface PageFetcher {
  /** 通信の前に分かる問題を調べる。問題があれば PageRefused を投げる。 */
  check(address: string): void;
  read(address: string): Promise<FetchedPage>;
}

/** 確かめた宛先だけを返す lookup。名前を引き直さないので、途中で宛先を差し替えられない。 */
export function pinnedLookup(host: string, address: string, isForbidden: (address: string) => boolean = isForbiddenAddress): LookupFunction {
  const family = isIP(address);
  return (name, options, callback) => {
    if (name.replace(/\.$/, '').toLowerCase() !== host || isForbidden(address)) {
      callback(new PageRefused('blocked'), '', 0);
      return;
    }
    if (options.all) (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

const defaultResolve: ResolveHost = (host) => dnsLookup(host, { all: true, verbatim: true });

const isRedirect = (status: number) => [301, 302, 303, 307, 308].includes(status);

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object']);
const BLOCK_TAGS = new Set(['p', 'div', 'br', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'title', 'dd', 'dt']);
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text: string) => text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,6});/gi, (all, code: string) => {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? all;
  const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
});

/** 本文の文字だけを取り出す。悪意のある大きな入力でも遅くならないよう、1回の走査で読む。 */
export function htmlToText(html: string) {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) { parts.push(html.slice(index)); break; }
    parts.push(html.slice(index, open));
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) break;
      index = end + 3;
      continue;
    }
    const close = html.indexOf('>', open);
    if (close < 0) break;
    const name = /^<\/?([a-z][a-z0-9]*)/.exec(lower.slice(open, open + 16))?.[1];
    index = close + 1;
    if (name && SKIPPED_TAGS.has(name) && html[open + 1] !== '/') {
      const end = lower.indexOf(`</${name}`, close);
      if (end < 0) break;
      const after = html.indexOf('>', end);
      if (after < 0) break;
      index = after + 1;
    } else if (name && BLOCK_TAGS.has(name)) parts.push('\n');
  }
  return plainText(decodeEntities(parts.join('')));
}

const plainText = (text: string) => text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT_CHARS);

function decode(bytes: Buffer, contentType: string) {
  const head = bytes.subarray(0, 2048).toString('latin1');
  const label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/**
 * 利用者が指定した URL を取りに行く唯一の出口（SSRF の対策）。
 * 名前を引いた全部の宛先を確かめ、確かめた宛先へ固定して接続する。転送は毎回確かめ直す。
 */
export function createPageFetcher(options: PageFetcherOptions = {}): PageFetcher {
  const testing = options.testing ?? {};
  const isForbidden = testing.isForbidden ?? isForbiddenAddress;
  const resolve = options.resolve ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PAGE_MAX_BYTES;

  /** URL の形と宛先の名前を確かめ、追跡の引数を除く。 */
  function target(address: string, base?: URL) {
    let url: URL;
    try { url = stripTracking(new URL(address.trim(), base)); } catch { throw new PageRefused('invalid'); }
    if (url.protocol !== 'https:' && !(testing.allowHttp && url.protocol === 'http:')) throw new PageRefused('invalid');
    if (url.username || url.password) throw new PageRefused('invalid');
    if (url.port && url.port !== '443' && !testing.allowAnyPort) throw new PageRefused('blocked');
    const host = hostOf(url);
    if (isIP(host)) { if (isForbidden(host)) throw new PageRefused('blocked'); } else if (isForbiddenName(host)) throw new PageRefused('blocked');
    return url;
  }

  async function checkedAddress(url: URL) {
    const host = hostOf(url);
    if (isIP(host)) return host;
    let answers: ReadonlyArray<{ address: string }>;
    try { answers = await resolve(host); } catch { throw new PageRefused('unreachable'); }
    if (!answers.length) throw new PageRefused('unreachable');
    // 1つでも内側の宛先が混ざる名前は使わない。
    if (answers.some((answer) => isForbidden(answer.address))) throw new PageRefused('blocked');
    return answers[0].address;
  }

  const open = (url: URL, address: string, signal: AbortSignal) => new Promise<IncomingMessage>((done, reject) => {
    const host = hostOf(url);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: url.protocol, host, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`, method: 'GET', agent: false, signal,
      lookup: pinnedLookup(host, address, isForbidden),
      headers: { Host: url.host, Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'yoridokoro-page-reader/1.0' },
    }, done);
    request.on('error', reject);
    request.end();
  });

  async function read(response: IncomingMessage) {
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    const type = contentType.split(';')[0].trim();
    if (type !== 'text/html' && type !== 'text/plain') throw new PageRefused('not-text');
    // 圧縮された応答は上限を確かめられないので読まない。
    if ((response.headers['content-encoding'] ?? 'identity') !== 'identity') throw new PageRefused('not-text');
    if (Number(response.headers['content-length'] ?? 0) > maxBytes) throw new PageRefused('too-large');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw new PageRefused('too-large');
      chunks.push(chunk as Buffer);
    }
    const text = decode(Buffer.concat(chunks), contentType);
    return type === 'text/html' ? htmlToText(text) : plainText(text);
  }

  return {
    check(address) { target(address); },
    async read(address) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: IncomingMessage | undefined;
      try {
        let url = target(address);
        for (let hop = 0; ; hop += 1) {
          const pinned = await Promise.race([checkedAddress(url), new Promise<never>((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(new PageRefused('timeout')), { once: true }); })]);
          response = await open(url, pinned, controller.signal);
          const status = response.statusCode ?? 0;
          if (isRedirect(status)) {
            const location = response.headers.location;
            response.destroy();
            if (!location || hop >= PAGE_MAX_REDIRECTS) throw new PageRefused('redirects');
            url = target(location, url);
            continue;
          }
          if (status < 200 || status >= 300) throw new PageRefused('unreachable');
          return { url: url.href, text: await read(response) };
        }
      } catch (error) {
        if (controller.signal.aborted) throw new PageRefused('timeout');
        if (error instanceof PageRefused) throw error;
        throw new PageRefused('unreachable');
      } finally {
        clearTimeout(timer);
        response?.destroy();
      }
    },
  };
}
