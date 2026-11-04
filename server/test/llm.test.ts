import http from 'node:http';
import https from 'node:https';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isLocalAddress, isLoopbackAddress } from '../adapters/destination';
import { LlmError, createLlmClient, prepareLlmClient } from '../adapters/llm';
import { loadConfig } from '../config';
import { startFakeLlm } from '../testing/fakeLlm';
import type { FakeLlm } from '../testing/fakeLlm';

let double: FakeLlm;
beforeAll(async () => { double = await startFakeLlm(); });
afterEach(() => { double.setMode('valid'); double.release(); double.requests.length = 0; vi.restoreAllMocks(); });
afterAll(() => double.close());

const client = (timeoutMs = 2000) => createLlmClient({ url: double.url, key: 'secret-key', model: 'test-model', timeoutMs });
const code = async (work: Promise<unknown>) => { try { await work; return 'none'; } catch (error) { return (error as LlmError).code; } };
const port = () => new URL(double.url).port;
const config = (env: Record<string, string>) => loadConfig({ FAMILY_HUB_LLM_MODEL: 'm', ...env }).llm;
/** 名前の答えを順に返す代役。尽きたら最後の答えを返し続ける。 */
const answers = (...rounds: string[][]) => { let index = 0; const asked: string[] = []; return { asked, resolve: async (host: string) => { asked.push(host); const round = rounds[Math.min(index, rounds.length - 1)]; index += 1; return round.map((address) => ({ address })); } }; };

describe('createLlmClient', () => {
  it('is unavailable without configuration and refuses to run', async () => {
    const disabled = createLlmClient(null);
    expect(disabled.available).toBe(false);
    expect(await code(disabled.complete('s', 'u'))).toBe('unavailable');
  });

  it('calls /chat/completions and returns the parsed content', async () => {
    const output = await client().complete('領収書を読みます', 'data');
    expect(output).toMatchObject({ total: 2480 });
    expect(double.requests[0].authorization).toBe('Bearer secret-key');
    expect(double.requests[0].body).toMatchObject({ model: 'test-model', messages: [{ role: 'system', content: '領収書を読みます' }, { role: 'user', content: 'data' }] });
  });

  it('accepts a URL that already ends in the path', async () => {
    expect(await createLlmClient({ url: `${double.url}/chat/completions/`, model: 'm', timeoutMs: 2000 }).complete('領収書', 'x')).toMatchObject({ total: 2480 });
    expect(double.requests[0].authorization).toBeUndefined();
  });

  it('reports malformed output, an error status and a timeout', async () => {
    double.setMode('malformed');
    expect(await code(client().complete('s', 'u'))).toBe('malformed');
    double.setMode('error');
    expect(await code(client().complete('s', 'u'))).toBe('unavailable');
    double.setMode('timeout');
    expect(await code(client(100).complete('s', 'u'))).toBe('timeout');
  });

  it('refuses a redirect without following it, and a body over 1 MiB', async () => {
    double.setMode('redirect');
    const before = double.connections();
    expect(await code(client().complete('s', 'u'))).toBe('unavailable');
    expect(double.connections() - before).toBe(1);
    double.setMode('huge');
    expect(await code(client().complete('s', 'u'))).toBe('malformed');
  });

  it('reports a connection failure without the URL or the key', async () => {
    const error = await createLlmClient({ url: 'http://127.0.0.1:9/v1', key: 'secret-key', model: 'm', timeoutMs: 500 }).complete('s', 'u').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toBe('unavailable');
    expect(JSON.stringify(error)).not.toMatch(/127\.0\.0\.1|secret-key/);
  });

  it('does not use the global fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await client().complete('領収書', 'x');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('allowed addresses (A1-2)', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fdff:ffff::1', '::ffff:192.168.1.10', '::ffff:c0a8:10a', '::ffff:10.0.0.1', '::ffff:127.0.0.1',
  ])('allows %s', (address) => expect(isLocalAddress(address)).toBe(true));

  it.each([
    ['this network', '0.0.0.0'], ['this network', '0.1.2.3'], ['CGNAT', '100.64.0.1'], ['CGNAT', '100.127.255.255'], ['link-local', '169.254.0.1'], ['metadata', '169.254.169.254'],
    ['just outside 172.16/12', '172.15.255.255'], ['just outside 172.16/12', '172.32.0.1'], ['just outside 192.168/16', '192.169.0.1'], ['just outside 10/8', '11.0.0.1'],
    ['global', '8.8.8.8'], ['global', '93.184.216.34'], ['multicast', '224.0.0.1'], ['broadcast', '255.255.255.255'],
    ['IPv6 unspecified', '::'], ['IPv6 link-local', 'fe80::1'], ['IPv6 link-local', 'febf::1'], ['IPv6 site-local', 'fec0::1'], ['IPv6 global', '2001:4860:4860::8888'], ['IPv6 multicast', 'ff02::1'],
    ['mapped global', '::ffff:8.8.8.8'], ['mapped link-local', '::ffff:169.254.169.254'], ['mapped CGNAT', '::ffff:100.64.0.1'], ['mapped this network', '::ffff:0.0.0.0'],
    ['NAT64', '64:ff9b::a00:1'], ['6to4', '2002:c0a8:101::1'], ['IPv4-compatible', '::10.0.0.1'],
    ['not an address', 'llm.home.test'], ['empty', ''],
  ])('refuses %s: %s', (_name, address) => expect(isLocalAddress(address)).toBe(false));

  it('knows loopback apart from the rest of the home network', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ['10.0.0.1', '192.168.1.10', 'fd00::1', '::ffff:192.168.1.10']) expect(isLoopbackAddress(address)).toBe(false);
  });
});

describe('configuration and startup (A1-1, A1-4, A1-5)', () => {
  it('is off by default', () => expect(loadConfig({}).llm).toBeNull());

  it('reads the settings for a home-network address over https', () => {
    expect(loadConfig({ FAMILY_HUB_LLM_URL: 'https://192.168.1.10/v1', FAMILY_HUB_LLM_KEY: 'k', FAMILY_HUB_LLM_MODEL: 'm' }).llm).toEqual({ url: 'https://192.168.1.10/v1', key: 'k', model: 'm', timeoutMs: 45_000, allowLanHttp: false });
  });

  it('requires a model', () => expect(() => loadConfig({ FAMILY_HUB_LLM_URL: 'https://192.168.1.10/v1' })).toThrow('MODEL'));

  it.each(['not a url', 'ftp://192.168.1.10/', 'file:///etc/passwd', 'https://user:pw@192.168.1.10/'])('refuses to start with the URL %s', (url) => {
    expect(() => config({ FAMILY_HUB_LLM_URL: url })).toThrow('FAMILY_HUB_LLM_URL');
  });

  // 134744072 は 8.8.8.8 を10進で書いたもの。
  it.each(['http://8.8.8.8', 'http://169.254.169.254', 'https://8.8.8.8/v1', 'https://169.254.169.254/', 'https://100.64.0.1/', 'https://0.0.0.0/', 'https://[fe80::1]/', 'https://[2001:4860:4860::8888]/', 'https://[::ffff:8.8.8.8]/', 'https://134744072/'])('refuses to start with an address outside the home: %s', (url) => {
    expect(() => config({ FAMILY_HUB_LLM_URL: url })).toThrow('FAMILY_HUB_LLM_URL');
  });

  it.each(['https://192.168.1.10', 'https://10.0.0.5:8443/v1', 'https://172.16.0.1/v1', 'https://[fd00::1]/v1', 'https://[::ffff:192.168.1.10]/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:8080/v1', 'http://localhost:8080/v1'])('accepts %s', async (url) => {
    const settings = config({ FAMILY_HUB_LLM_URL: url });
    expect(settings?.url).toBeTruthy();
    expect((await prepareLlmClient(settings, { resolve: answers(['127.0.0.1']).resolve })).available).toBe(true);
  });

  it('allows plain http to another machine on the home network only when it is stated', () => {
    expect(() => config({ FAMILY_HUB_LLM_URL: 'http://192.168.1.10/v1' })).toThrow('FAMILY_HUB_LLM_ALLOW_LAN_HTTP');
    expect(() => config({ FAMILY_HUB_LLM_URL: 'http://llm.home.test/v1' })).toThrow('FAMILY_HUB_LLM_ALLOW_LAN_HTTP');
    expect(config({ FAMILY_HUB_LLM_URL: 'http://192.168.1.10/v1', FAMILY_HUB_LLM_ALLOW_LAN_HTTP: '1' })).toMatchObject({ allowLanHttp: true });
    expect(() => config({ FAMILY_HUB_LLM_URL: 'http://8.8.8.8/v1', FAMILY_HUB_LLM_ALLOW_LAN_HTTP: '1' })).toThrow('home network');
  });

  it('refuses to start when the name resolves outside the home', async () => {
    const settings = config({ FAMILY_HUB_LLM_URL: 'https://api.example.com/v1' });
    await expect(prepareLlmClient(settings, { resolve: answers(['93.184.216.34']).resolve })).rejects.toThrow('outside this machine and the home network');
    await expect(prepareLlmClient(settings, { resolve: answers(['192.168.1.10', '8.8.8.8']).resolve })).rejects.toThrow('outside');
    await expect(prepareLlmClient(settings, { resolve: answers(['169.254.169.254']).resolve })).rejects.toThrow('outside');
  });

  it('refuses to start when a plain-http name resolves away from loopback', async () => {
    const settings = config({ FAMILY_HUB_LLM_URL: 'http://localhost:8080/v1' });
    await expect(prepareLlmClient(settings, { resolve: answers(['192.168.1.10']).resolve })).rejects.toThrow('outside');
  });

  it('starts with the helper unavailable when the name does not resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settings = config({ FAMILY_HUB_LLM_URL: 'https://llm.home.test/v1', FAMILY_HUB_LLM_KEY: 'secret-key' });
    for (const resolve of [() => Promise.reject(new Error('ENOTFOUND')), async () => []]) {
      const prepared = await prepareLlmClient(settings, { resolve });
      expect(prepared.available).toBe(false);
      expect(await code(prepared.complete('s', 'u'))).toBe('unavailable');
    }
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/llm\.home\.test|secret-key/);
  });

  it('starts with a home-network name', async () => {
    const settings = config({ FAMILY_HUB_LLM_URL: 'https://llm.home.test/v1' });
    expect((await prepareLlmClient(settings, { resolve: answers(['192.168.1.10']).resolve })).available).toBe(true);
  });
});

describe('each request (A1-3, A1-5)', () => {
  const named = (rounds: string[][], extra: Record<string, string> = {}) => {
    const resolver = answers(...rounds);
    const settings = config({ FAMILY_HUB_LLM_URL: `http://localhost:${port()}/v1`, FAMILY_HUB_LLM_TIMEOUT_MS: '1000', ...extra });
    return { resolver, prepare: () => prepareLlmClient(settings, { resolve: resolver.resolve }) };
  };

  it('resolves again for every request and connects to the checked address', async () => {
    const { resolver, prepare } = named([['127.0.0.1']]);
    const prepared = await prepare();
    expect(await prepared.complete('領収書', 'x')).toMatchObject({ total: 2480 });
    expect(await prepared.complete('領収書', 'x')).toMatchObject({ total: 2480 });
    expect(resolver.asked).toEqual(['localhost', 'localhost', 'localhost']);
  });

  it('never connects to a name that changes to a public address after startup', async () => {
    const before = double.connections();
    const request = vi.spyOn(http, 'request');
    const secure = vi.spyOn(https, 'request');
    const { prepare } = named([['127.0.0.1'], ['8.8.8.8']]);
    const prepared = await prepare();
    expect(prepared.available).toBe(true);
    expect(await code(prepared.complete('s', 'u'))).toBe('unavailable');
    expect(double.connections()).toBe(before);
    expect(request).not.toHaveBeenCalled();
    expect(secure).not.toHaveBeenCalled();
  });

  it('never connects when any later answer is outside, or a plain-http name moves off loopback', async () => {
    const before = double.connections();
    for (const later of [['127.0.0.1', '8.8.8.8'], ['169.254.169.254'], ['192.168.1.10']]) {
      const prepared = await named([['127.0.0.1'], later]).prepare();
      expect(await code(prepared.complete('s', 'u'))).toBe('unavailable');
    }
    expect(double.connections()).toBe(before);
  });

  it('opens the socket only to the pinned address, even for a name the system cannot resolve', async () => {
    const resolver = answers(['127.0.0.1']);
    const settings = config({ FAMILY_HUB_LLM_URL: `http://llm.home.test:${port()}/v1`, FAMILY_HUB_LLM_ALLOW_LAN_HTTP: '1' });
    const prepared = await prepareLlmClient(settings, { resolve: resolver.resolve });
    expect(await prepared.complete('領収書', 'x')).toMatchObject({ total: 2480 });
    const options = vi.spyOn(http, 'request');
    await prepared.complete('領収書', 'x');
    const [first] = options.mock.calls[0] as unknown as [http.RequestOptions];
    expect(first).toMatchObject({ host: 'llm.home.test', agent: false, method: 'POST' });
    expect(typeof first.lookup).toBe('function');
  });
});
