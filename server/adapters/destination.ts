import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

/**
 * 外へ接続するときの宛先の確かめ方。URL の取得（urlFetcher）と読み取りの補助（llm）が共有する。
 * 名前を引いた全部の宛先を確かめ、確かめた1つの宛先にだけ接続する（途中で名前の答えが変わっても、ほかへはつながない）。
 * どの宛先を認めるかは呼ぶ側が決める。URL の取得は内側を拒み、読み取りの補助は内側だけを認める。
 */

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

/** 同じ機械と家庭内の宛先。これ以外（0/8、100.64/10、169.254/16、グローバルなど）は認めない。 */
const IPV4_LOCAL: ReadonlyArray<readonly [string, number]> = [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]];

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

const zeros = (bytes: readonly number[], from: number, to: number) => bytes.slice(from, to).every((value) => value === 0);
/** ::ffff:a.b.c.d（IPv4 を IPv6 で表したもの）。 */
const isMappedV4 = (bytes: readonly number[]) => zeros(bytes, 0, 10) && bytes[10] === 255 && bytes[11] === 255;

/** 角かっこと zone を外し、IP として読めれば種類（4 か 6）を返す。 */
function parse(address: string): { family: 4; bytes: number[] } | { family: 6; bytes: number[] } | null {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(bare);
  if (family === 4) return { family, bytes: bytesOfV4(bare) };
  if (family === 6) return { family, bytes: bytesOfV6(bare) };
  return null;
}

const forbiddenV4 = (bytes: readonly number[]) => IPV4_BLOCKED.some(([network, bits]) => within(bytes, bytesOfV4(network), bits));

function forbiddenV6(bytes: readonly number[]) {
  // 中に IPv4 を埋め込む形は、埋め込まれた先で判定する。
  if (isMappedV4(bytes)) return forbiddenV4(bytes.slice(12));
  if (within(bytes, bytesOfV6('64:ff9b::'), 96)) return forbiddenV4(bytes.slice(12));
  if (within(bytes, bytesOfV6('2002::'), 16)) return forbiddenV4(bytes.slice(2, 6));
  // それ以外は、グローバルユニキャスト（2000::/3）のほかをすべて拒む。
  if (!within(bytes, bytesOfV6('2000::'), 3)) return true;
  return IPV6_UNICAST_BLOCKED.some(([network, bits]) => within(bytes, bytesOfV6(network), bits));
}

/** 利用者が指定した URL の取得で、接続してはいけない宛先か（内側の宛先）。読めないものも拒む。 */
export function isForbiddenAddress(address: string): boolean {
  const parsed = parse(address);
  if (!parsed) return true;
  return parsed.family === 4 ? forbiddenV4(parsed.bytes) : forbiddenV6(parsed.bytes);
}

const localV4 = (bytes: readonly number[]) => IPV4_LOCAL.some(([network, bits]) => within(bytes, bytesOfV4(network), bits));
const loopbackV6 = (bytes: readonly number[]) => zeros(bytes, 0, 15) && bytes[15] === 1;

/**
 * 同じ機械か家庭内の宛先か。loopback、10/8・172.16/12・192.168/16、fc00::/7 だけを認める。
 * ::ffff: で表した IPv4 は IPv4 として判定する。fe80::/10、NAT64・6to4 などの変換、読めないものは認めない。
 */
export function isLocalAddress(address: string): boolean {
  const parsed = parse(address);
  if (!parsed) return false;
  if (parsed.family === 4) return localV4(parsed.bytes);
  if (isMappedV4(parsed.bytes)) return localV4(parsed.bytes.slice(12));
  return loopbackV6(parsed.bytes) || within(parsed.bytes, bytesOfV6('fc00::'), 7);
}

/** 同じ機械（127/8、::1、::ffff:127.0.0.0/104）か。 */
export function isLoopbackAddress(address: string): boolean {
  const parsed = parse(address);
  if (!parsed) return false;
  if (parsed.family === 4) return parsed.bytes[0] === 127;
  if (isMappedV4(parsed.bytes)) return parsed.bytes[12] === 127;
  return loopbackV6(parsed.bytes);
}

export type ResolveHost = (host: string) => Promise<ReadonlyArray<{ address: string }>>;

export const defaultResolve: ResolveHost = (host) => dnsLookup(host, { all: true, verbatim: true });

/** 名前の解決と宛先の確認の失敗。unresolved は名前を引けなかった、refused は認めない宛先が混ざっていた。 */
export class DestinationError extends Error {
  readonly reason: 'unresolved' | 'refused';
  constructor(reason: 'unresolved' | 'refused') { super(reason); this.reason = reason; }
}

/**
 * 名前を引き、全部の答えが認める宛先なら最初の1つを返す。1つでも認めない宛先が混ざれば使わない。
 * IP をそのまま書いた宛先は、引かずにそのまま確かめる。
 */
export async function resolveChecked(host: string, permits: (address: string) => boolean, resolve: ResolveHost = defaultResolve): Promise<string> {
  if (isIP(host)) {
    if (!permits(host)) throw new DestinationError('refused');
    return host;
  }
  let answers: ReadonlyArray<{ address: string }>;
  try { answers = await resolve(host); } catch { throw new DestinationError('unresolved'); }
  if (!answers.length) throw new DestinationError('unresolved');
  if (answers.some((answer) => !permits(answer.address))) throw new DestinationError('refused');
  return answers[0].address;
}

/**
 * 確かめた宛先だけを返す lookup。名前を引き直さないので、途中で宛先を差し替えられない。
 * 別の名前を聞かれたときと、認めない宛先のときは refuse() の誤りを返す。
 */
export function pinnedLookup(host: string, address: string, permits: (address: string) => boolean, refuse: () => Error): LookupFunction {
  const family = isIP(address);
  return (name, options, callback) => {
    if (name.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase() !== host || !permits(address)) {
      callback(refuse(), '', 0);
      return;
    }
    if (options.all) (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
