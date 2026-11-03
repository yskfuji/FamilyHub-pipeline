import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { z } from 'zod';
import { jsonOfOutput } from '../../src/domain/assistant';
import type { ServerConfig } from '../config';
import { DestinationError, defaultResolve, isLocalAddress, isLoopbackAddress, pinnedLookup, resolveChecked } from './destination';
import type { ResolveHost } from './destination';

export type LlmUserContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export type LlmFailure = 'timeout' | 'unavailable' | 'malformed';

export class LlmError extends Error {
  readonly code: LlmFailure;
  constructor(code: LlmFailure) { super(code); this.code = code; }
}

export interface LlmClient {
  readonly available: boolean;
  /** 応答の本文を JSON として返す。形の確認は呼ぶ側で行う（応答は信用しない）。 */
  complete(system: string, user: LlmUserContent): Promise<unknown>;
}

type LlmConfig = NonNullable<ServerConfig['llm']>;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 1200;

const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(100_000) }) })).min(1) });

const disabled: LlmClient = { available: false, complete: () => Promise.reject(new LlmError('unavailable')) };

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

/**
 * 読み取りの補助の接続先は、同じ機械か家庭内だけ。家族の画像と本文を外部へ送らない。
 * 平文の http は loopback だけ。家庭内の別の機械へ平文で送るときは FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1 を明示する。
 * 起動の前に URL の形と、IP をそのまま書いた宛先を確かめる。名前の宛先は prepareLlmClient で確かめる。
 */
export function checkLlmUrl(raw: string, allowLanHttp: boolean): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('FAMILY_HUB_LLM_URL is not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('FAMILY_HUB_LLM_URL must use https or http');
  if (url.username || url.password) throw new Error('FAMILY_HUB_LLM_URL must not carry credentials; use FAMILY_HUB_LLM_KEY');
  const host = hostOf(url);
  if (!host) throw new Error('FAMILY_HUB_LLM_URL has no host');
  // 平文の http は、loopback と分かる宛先（IP か localhost）だけ。家庭内の別の機械へは、明示したときだけ平文で送る。
  if (url.protocol === 'http:' && !allowLanHttp && !(isIP(host) ? isLoopbackAddress(host) : host === 'localhost')) {
    throw new Error('FAMILY_HUB_LLM_URL uses plain http to another machine; use https, or set FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1 to send in plain text on the home network');
  }
  const permits = permitted({ url: url.href, allowLanHttp });
  if (isIP(host) && !permits(host)) {
    throw new Error('FAMILY_HUB_LLM_URL must point to this machine or the home network (loopback, 10/8, 172.16/12, 192.168/16, fc00::/7)');
  }
  return url;
}

/** 認める宛先。https なら家庭内まで、平文の http なら loopback だけ（明示したときは家庭内まで）。 */
function permitted(config: { url: string; allowLanHttp?: boolean }): (address: string) => boolean {
  return new URL(config.url).protocol === 'http:' && !config.allowLanHttp ? isLoopbackAddress : isLocalAddress;
}

export interface LlmOptions {
  /** 試験の代役にだけ渡す。本番では OS の名前解決を使う。 */
  resolve?: ResolveHost;
}

/**
 * 起動のときに呼ぶ。名前の宛先を引き、認めない宛先に解決すれば起動しない（例外を投げる）。
 * 名前を引けないときは起動し、読み取りの補助を「使えない」とする。理由は運営の記録に残し、URL は書かない。
 */
export async function prepareLlmClient(config: ServerConfig['llm'], options: LlmOptions = {}): Promise<LlmClient> {
  if (!config) return disabled;
  const url = checkLlmUrl(config.url, Boolean(config.allowLanHttp));
  try {
    await resolveChecked(hostOf(url), permitted(config), options.resolve ?? defaultResolve);
  } catch (error) {
    if (error instanceof DestinationError && error.reason === 'unresolved') {
      console.warn('reading helper unavailable: the configured LLM host name did not resolve at startup');
      return disabled;
    }
    throw new Error('FAMILY_HUB_LLM_URL resolves outside this machine and the home network', { cause: error });
  }
  return createLlmClient(config, options);
}

/** 応答を1MiBまで読む。超えたら読むのをやめる。 */
async function bodyOf(response: IncomingMessage) {
  if (Number(response.headers['content-length'] ?? 0) > MAX_RESPONSE_BYTES) throw new LlmError('malformed');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    total += (chunk as Buffer).length;
    if (total > MAX_RESPONSE_BYTES) throw new LlmError('malformed');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * OpenAI 互換の /chat/completions。設定がなければ使えない状態を返す。内容は記録に残さない。
 * 要求のたびに名前を引き直し、確かめた宛先にだけ接続する（lookup を固定し、接続の使い回しをしない）。転送には従わない。
 */
export function createLlmClient(config: ServerConfig['llm'], options: LlmOptions = {}): LlmClient {
  if (!config) return disabled;
  const settings: LlmConfig = config;
  const endpoint = new URL(`${settings.url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`);
  const host = hostOf(endpoint);
  const permits = permitted(settings);
  const resolve = options.resolve ?? defaultResolve;

  const post = (address: string, body: string, signal: AbortSignal) => new Promise<IncomingMessage>((done, reject) => {
    const client = endpoint.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: endpoint.protocol, host, port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80), path: `${endpoint.pathname}${endpoint.search}`, method: 'POST', agent: false, signal,
      lookup: pinnedLookup(host, address, permits, () => new LlmError('unavailable')),
      headers: { Host: endpoint.host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept-Encoding': 'identity', ...(settings.key ? { Authorization: `Bearer ${settings.key}` } : {}) },
    }, done);
    request.on('error', reject);
    request.end(body);
  });

  return {
    available: true,
    async complete(system, user) {
      const signal = AbortSignal.timeout(settings.timeoutMs);
      let response: IncomingMessage | undefined;
      try {
        const aborted = new Promise<never>((_resolve, reject) => { signal.addEventListener('abort', () => reject(new LlmError('timeout')), { once: true }); });
        aborted.catch(() => undefined);
        const address = await Promise.race([resolveChecked(host, permits, resolve), aborted]);
        const body = JSON.stringify({ model: settings.model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
        response = await post(address, body, signal);
        const status = response.statusCode ?? 0;
        // 転送（3xx）を含め、成功のほかは使えないとして扱う。転送先へは接続しない。
        if (status < 200 || status >= 300) throw new LlmError('unavailable');
        const parsed = envelope.safeParse(JSON.parse(await bodyOf(response)));
        const output = parsed.success ? jsonOfOutput(parsed.data.choices[0].message.content) : null;
        if (output === null) throw new LlmError('malformed');
        return output;
      } catch (error) {
        if (signal.aborted) throw new LlmError('timeout');
        if (error instanceof LlmError) throw error;
        if (error instanceof SyntaxError) throw new LlmError('malformed');
        // 名前を引けない、認めない宛先、接続の失敗。URL と鍵は誤りに含めない。
        throw new LlmError('unavailable');
      } finally {
        response?.destroy();
      }
    },
  };
}
