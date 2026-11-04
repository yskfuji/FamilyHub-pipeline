import { EventEmitter } from 'node:events';
import http, { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import https from 'node:https';
import type { RequestOptions } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PAGE_MAX_BYTES, createPageFetcher, htmlToText, isForbiddenAddress, isForbiddenName, pinnedLookup, stripTracking } from '../adapters/urlFetcher';
import type { PageFailure, PageFetcherOptions } from '../adapters/urlFetcher';

let pages: Server;
let base = '';
const seen: Array<{ url: string; host?: string; cookie?: string }> = [];
const handlers = new Map<string, (response: ServerResponse) => void>();
const html = (response: ServerResponse, body: string, type = 'text/html; charset=utf-8') => { response.writeHead(200, { 'Content-Type': type }); response.end(body); };
const redirect = (response: ServerResponse, location: string, status = 302) => { response.writeHead(status, { Location: location }); response.end(); };

beforeAll(async () => {
  pages = createServer((request, response) => {
    seen.push({ url: request.url ?? '', host: request.headers.host, cookie: request.headers.cookie });
    const handler = handlers.get(new URL(request.url ?? '/', 'http://x').pathname);
    if (handler) handler(response); else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve) => { pages.listen(0, '127.0.0.1', resolve); });
  base = `http://page.test:${(pages.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => { pages.closeAllConnections(); pages.close(resolve); }));

/** ループバックの代役へつなぐ設定。127.0.0.2 を「内側の宛先」として扱う。 */
const local = (options: PageFetcherOptions = {}) => createPageFetcher({
  testing: { allowHttp: true, allowAnyPort: true, isForbidden: (address) => address === '127.0.0.2' },
  resolve: async () => [{ address: '127.0.0.1' }],
  ...options,
});

const failure = async (work: Promise<unknown>): Promise<PageFailure | 'none'> => {
  try { await work; return 'none'; } catch (error) { return (error as { code: PageFailure }).code; }
};

describe('blocked addresses', () => {
  it.each([
    ['this network', '0.0.0.0'], ['this network', '0.1.2.3'],
    ['private 10/8', '10.0.0.1'], ['private 10/8', '10.255.255.255'],
    ['CGNAT', '100.64.0.1'], ['CGNAT', '100.127.255.255'], ['CGNAT metadata', '100.100.100.200'],
    ['loopback', '127.0.0.1'], ['loopback', '127.255.255.254'],
    ['link-local', '169.254.0.1'], ['AWS and GCP metadata', '169.254.169.254'],
    ['private 172.16/12', '172.16.0.1'], ['private 172.16/12', '172.31.255.255'],
    ['IETF protocol', '192.0.0.1'], ['Oracle metadata', '192.0.0.192'], ['documentation', '192.0.2.1'], ['6to4 relay', '192.88.99.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['benchmarking', '198.18.0.1'], ['benchmarking', '198.19.255.255'], ['documentation', '198.51.100.1'], ['documentation', '203.0.113.1'],
    ['multicast', '224.0.0.1'], ['multicast', '239.255.255.255'], ['reserved', '240.0.0.1'], ['broadcast', '255.255.255.255'],
    ['Azure metadata', '168.63.129.16'],
    ['IPv6 unspecified', '::'], ['IPv6 loopback', '::1'], ['IPv6 loopback, written long', '0:0:0:0:0:0:0:1'],
    ['IPv6 link-local', 'fe80::1'], ['IPv6 link-local', 'febf::1'], ['IPv6 site-local', 'fec0::1'],
    ['IPv6 unique local', 'fc00::1'], ['IPv6 unique local', 'fdff::1'], ['AWS IPv6 metadata', 'fd00:ec2::254'],
    ['IPv6 multicast', 'ff02::1'], ['IPv6 discard', '100::1'], ['IPv6 documentation', '2001:db8::1'], ['IPv6 documentation', '3fff::1'], ['Teredo', '2001:0:4136:e378::1'],
    ['IPv4-compatible', '::127.0.0.1'], ['IPv4-compatible', '::7f00:1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'], ['IPv4-mapped, in hex', '::ffff:7f00:1'], ['IPv4-mapped private', '::ffff:10.0.0.1'], ['IPv4-mapped metadata', '::ffff:169.254.169.254'], ['IPv4-mapped metadata, in hex', '::ffff:a9fe:a9fe'], ['IPv4-mapped CGNAT', '::ffff:100.64.0.1'], ['IPv4-mapped, uppercase', '::FFFF:192.168.0.1'],
    ['translated', '::ffff:0:127.0.0.1'],
    ['NAT64 loopback', '64:ff9b::127.0.0.1'], ['NAT64 private', '64:ff9b::a00:1'],
    ['6to4 loopback', '2002:7f00:1::'], ['6to4 private', '2002:c0a8:101::1'], ['6to4 metadata', '2002:a9fe:a9fe::'],
    ['with a zone', 'fe80::1%en0'], ['in brackets', '[::1]'],
    ['not an address', 'example.com'], ['empty', ''],
  ])('refuses %s: %s', (_name, address) => expect(isForbiddenAddress(address)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.167.1.1', '192.169.1.1', '223.255.255.255', '2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::'])('allows the public address %s', (address) => expect(isForbiddenAddress(address)).toBe(false));
});

describe('blocked names', () => {
  it.each(['localhost', 'foo.localhost', 'printer.local', 'metadata.google.internal', 'nas.lan', 'router.home.arpa', 'intranet'])('refuses %s', (name) => expect(isForbiddenName(name)).toBe(true));
  it('allows a public name', () => expect(isForbiddenName('example.com')).toBe(false));
});

describe('checks before any connection', () => {
  const real = createPageFetcher({ resolve: () => { throw new Error('must not resolve'); } });
  it.each([
    ['http', 'http://example.com/', 'invalid'], ['file', 'file:///etc/passwd', 'invalid'], ['ftp', 'ftp://example.com/', 'invalid'], ['gopher', 'gopher://example.com/', 'invalid'], ['no scheme', 'example.com', 'invalid'],
    ['credentials', 'https://user:pw@example.com/', 'invalid'],
    ['another port', 'https://example.com:8443/', 'blocked'],
    ['localhost', 'https://localhost/', 'blocked'], ['localhost with a dot', 'https://localhost./', 'blocked'], ['internal name', 'https://metadata.google.internal/', 'blocked'],
    ['loopback literal', 'https://127.0.0.1/', 'blocked'], ['decimal loopback', 'https://2130706433/', 'blocked'], ['hex loopback', 'https://0x7f.0.0.1/', 'blocked'], ['octal loopback', 'https://0177.0.0.1/', 'blocked'], ['short loopback', 'https://127.1/', 'blocked'],
    ['metadata literal', 'https://169.254.169.254/latest/meta-data/', 'blocked'],
    ['IPv6 loopback', 'https://[::1]/', 'blocked'], ['mapped literal', 'https://[::ffff:127.0.0.1]/', 'blocked'], ['mapped metadata', 'https://[::ffff:a9fe:a9fe]/', 'blocked'],
  ])('refuses %s', (_name, url, code) => {
    let found = 'none';
    try { real.check(url); } catch (error) { found = (error as { code: string }).code; }
    expect(found).toBe(code);
  });
  it('accepts a public https URL', () => expect(() => real.check('https://example.com/event?id=1')).not.toThrow());
});

describe('name resolution', () => {
  const answering = (...addresses: string[]) => createPageFetcher({ resolve: async () => addresses.map((address) => ({ address })) });

  it('refuses a public name that points inside', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:192.168.0.1', '224.0.0.1']) expect(await failure(answering(address).read('https://rebind.example.com/'))).toBe('blocked');
  });

  it('refuses when any answer points inside', async () => expect(await failure(answering('8.8.8.8', '10.0.0.1').read('https://mixed.example.com/'))).toBe('blocked'));
  it('reports a name that does not resolve', async () => {
    expect(await failure(answering().read('https://gone.example.com/'))).toBe('unreachable');
    expect(await failure(createPageFetcher({ resolve: () => Promise.reject(new Error('NXDOMAIN')) }).read('https://gone.example.com/'))).toBe('unreachable');
  });
});

describe('DNS rebinding', () => {
  it('resolves once for each hop and keeps the checked address', async () => {
    handlers.set('/pinned', (response) => html(response, '<p>固定した宛先</p>'));
    const answers = [[{ address: '127.0.0.1' }], [{ address: '127.0.0.2' }]];
    let lookups = 0;
    const fetcher = local({ resolve: async () => answers[lookups++] ?? [] });
    expect((await fetcher.read(`${base}/pinned`)).text).toBe('固定した宛先');
    expect(lookups).toBe(1);
    expect(seen.at(-1)?.host).toBe(new URL(base).host);
  });

  it('answers the socket lookup only with the checked address, for either lookup form', async () => {
    const lookup = pinnedLookup('page.test', '93.184.216.34');
    const single = await new Promise((resolve) => { lookup('page.test', { family: 0 }, (error, address, family) => resolve({ error, address, family })); });
    expect(single).toEqual({ error: null, address: '93.184.216.34', family: 4 });
    const all = await new Promise((resolve) => { (lookup as unknown as (name: string, options: object, callback: (error: unknown, addresses: unknown) => void) => void)('page.test', { all: true }, (error, addresses) => resolve({ error, addresses })); });
    expect(all).toEqual({ error: null, addresses: [{ address: '93.184.216.34', family: 4 }] });
  });

  it('refuses a socket lookup for another name or a forbidden address', async () => {
    const asked = (name: string, address: string) => new Promise<unknown>((resolve) => { pinnedLookup('page.test', address)(name, { family: 0 }, (error) => resolve(error)); });
    expect(await asked('other.test', '93.184.216.34')).toMatchObject({ code: 'blocked' });
    expect(await asked('page.test', '10.0.0.1')).toMatchObject({ code: 'blocked' });
  });

  it('opens TLS to the pinned address, not to what the name now resolves to', async () => {
    const connections: string[] = [];
    const tcp = createTcpServer((socket) => { socket.once('data', (data) => { connections.push(data.toString('latin1')); socket.destroy(); }); });
    await new Promise<void>((resolve) => { tcp.listen(0, '127.0.0.1', resolve); });
    const { port } = tcp.address() as AddressInfo;
    let lookups = 0;
    const fetcher = createPageFetcher({ testing: { allowAnyPort: true, isForbidden: (address) => address === '127.0.0.2' }, resolve: async () => { lookups += 1; return [{ address: lookups === 1 ? '127.0.0.1' : '127.0.0.2' }]; } });
    expect(await failure(fetcher.read(`https://pinned.example.com:${port}/`))).toBe('unreachable');
    await new Promise<void>((resolve) => { tcp.close(() => resolve()); });
    expect(lookups).toBe(1);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toContain('pinned.example.com');
  });
});

describe('redirects', () => {
  it('follows up to three, checking each', async () => {
    handlers.set('/one', (response) => redirect(response, '/two'));
    handlers.set('/two', (response) => redirect(response, '/three', 301));
    handlers.set('/three', (response) => redirect(response, '/end?utm_source=x&keep=1', 307));
    handlers.set('/end', (response) => html(response, '着きました'));
    const page = await local().read(`${base}/one`);
    expect(page.text).toBe('着きました');
    expect(page.url).toBe(`${base}/end?keep=1`);
  });

  it('stops at the fourth', async () => {
    handlers.set('/a', (response) => redirect(response, '/b'));
    handlers.set('/b', (response) => redirect(response, '/c'));
    handlers.set('/c', (response) => redirect(response, '/d'));
    handlers.set('/d', (response) => redirect(response, '/e'));
    handlers.set('/e', (response) => html(response, '届かない'));
    expect(await failure(local().read(`${base}/a`))).toBe('redirects');
  });

  it('refuses a redirect loop and one with no target', async () => {
    handlers.set('/loop', (response) => redirect(response, '/loop'));
    handlers.set('/empty', (response) => { response.writeHead(302); response.end(); });
    expect(await failure(local().read(`${base}/loop`))).toBe('redirects');
    expect(await failure(local().read(`${base}/empty`))).toBe('redirects');
  });

  it('refuses a redirect inside, to a name that resolves inside, to another scheme, or with credentials', async () => {
    handlers.set('/to-address', (response) => redirect(response, 'http://127.0.0.2/secret'));
    handlers.set('/to-name', (response) => redirect(response, `http://inside.test:${new URL(base).port}/secret`));
    handlers.set('/to-file', (response) => redirect(response, 'file:///etc/passwd'));
    handlers.set('/to-credentials', (response) => redirect(response, `http://a:b@page.test:${new URL(base).port}/`));
    const fetcher = local({ resolve: async (host) => [{ address: host === 'inside.test' ? '127.0.0.2' : '127.0.0.1' }] });
    expect(await failure(fetcher.read(`${base}/to-address`))).toBe('blocked');
    expect(await failure(fetcher.read(`${base}/to-name`))).toBe('blocked');
    expect(await failure(fetcher.read(`${base}/to-file`))).toBe('invalid');
    expect(await failure(fetcher.read(`${base}/to-credentials`))).toBe('invalid');
  });

  it('refuses https that redirects down to http', async () => {
    handlers.set('/down', (response) => redirect(response, 'http://example.com/'));
    const strict = createPageFetcher({ testing: { allowHttp: false, allowAnyPort: true, isForbidden: () => false }, resolve: async () => [{ address: '127.0.0.1' }] });
    expect(await failure(strict.read(`${base}/down`))).toBe('invalid');
  });
});

describe('response limits', () => {
  it('refuses a body over the cap by its declared size', async () => {
    handlers.set('/declared', (response) => { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(PAGE_MAX_BYTES + 1) }); response.end(); });
    expect(await failure(local().read(`${base}/declared`))).toBe('too-large');
  });

  it('refuses a body over the cap while reading, without a declared size', async () => {
    handlers.set('/streamed', (response) => { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write(Buffer.alloc(PAGE_MAX_BYTES + 1024, 0x61)); response.end(); });
    expect(await failure(local().read(`${base}/streamed`))).toBe('too-large');
  });

  it('accepts a body exactly at the cap', async () => {
    handlers.set('/exact', (response) => html(response, 'a'.repeat(1000), 'text/plain'));
    expect((await local({ maxBytes: 1000 }).read(`${base}/exact`)).text).toHaveLength(1000);
  });

  it('gives up on a slow response', async () => {
    handlers.set('/slow', (response) => { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write('start'); });
    handlers.set('/silent', () => undefined);
    expect(await failure(local({ timeoutMs: 100 }).read(`${base}/slow`))).toBe('timeout');
    expect(await failure(local({ timeoutMs: 100 }).read(`${base}/silent`))).toBe('timeout');
  });

  it('counts the time across redirects and a slow resolver', async () => {
    handlers.set('/wait', () => undefined);
    handlers.set('/hop', (response) => redirect(response, '/wait'));
    expect(await failure(local({ timeoutMs: 100 }).read(`${base}/hop`))).toBe('timeout');
    expect(await failure(local({ timeoutMs: 50, resolve: () => new Promise(() => undefined) }).read(`${base}/x`))).toBe('timeout');
  });

  it.each(['application/json', 'application/pdf', 'image/png', 'application/octet-stream', ''])('refuses the content type "%s"', async (type) => {
    handlers.set('/typed', (response) => { response.writeHead(200, type ? { 'Content-Type': type } : {}); response.end('{}'); });
    expect(await failure(local().read(`${base}/typed`))).toBe('not-text');
  });

  it('refuses compressed bodies, which could hide their size', async () => {
    handlers.set('/gzip', (response) => { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); response.end('x'); });
    expect(await failure(local().read(`${base}/gzip`))).toBe('not-text');
  });

  it('reports failures from the page', async () => {
    expect(await failure(local().read(`${base}/missing`))).toBe('unreachable');
  });
});

describe('what is sent and read', () => {
  it('strips tracking parameters before fetching and sends no cookies', async () => {
    handlers.set('/clean', (response) => html(response, 'ok'));
    await local().read(`${base}/clean?id=7&utm_source=mail&utm_medium=x&fbclid=abc&gclid=def&mc_eid=1&_ga=2#section`);
    expect(seen.at(-1)).toMatchObject({ url: '/clean?id=7', cookie: undefined });
  });

  it('keeps ordinary parameters', () => expect(stripTracking(new URL('https://example.com/?q=祭り&page=2&ref=7')).search).toBe(`?q=${encodeURIComponent('祭り')}&page=2&ref=7`));

  it('decodes a Shift_JIS page', async () => {
    handlers.set('/sjis', (response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=Shift_JIS' }); response.end(Buffer.from([0x93, 0xfa, 0x96, 0x7b])); });
    expect((await local().read(`${base}/sjis`)).text).toBe('日本');
  });

  it('reads only the text of a page', () => {
    const page = '<html><head><title>区民まつり</title><style>p{color:red}</style><script>alert("x")</script></head><body><!-- 秘密 --><h1>10月27日</h1><p>場所&#65306;中央公園 &amp; 広場</p><template>隠し</template><noscript>隠し</noscript></body></html>';
    expect(htmlToText(page)).toBe('区民まつり\n10月27日\n場所：中央公園 & 広場');
  });

  it('stays fast on hostile markup and caps the text', () => {
    const started = performance.now();
    htmlToText('<script>'.repeat(250_000));
    htmlToText('<!--'.repeat(500_000));
    htmlToText('<'.repeat(2_000_000));
    htmlToText('<a '.repeat(700_000));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(htmlToText('あ'.repeat(20_000))).toHaveLength(8000);
  });
});

describe('port 443 only, with the production settings (A2)', () => {
  // 本番と同じ設定（試験の緩めた設定なし）。名前は公開の宛先に解決し、https の要求は代役の応答で返す。
  const production = () => createPageFetcher({ resolve: async () => [{ address: '93.184.216.34' }] });
  const scripted = (responses: Array<{ status: number; headers: Record<string, string>; body?: string }>) => {
    const calls: Array<{ host?: string | null; port?: string | number | null; protocol?: string | null }> = [];
    vi.spyOn(http, 'request').mockImplementation(() => { throw new Error('plain http must not be used'); });
    vi.spyOn(https, 'request').mockImplementation(((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      calls.push({ host: options.host, port: options.port, protocol: options.protocol });
      const next = responses.shift() ?? { status: 500, headers: {} };
      const request = Object.assign(new EventEmitter(), {
        end: () => { setImmediate(() => callback(Object.assign(Readable.from([Buffer.from(next.body ?? '')]), { statusCode: next.status, headers: next.headers }) as unknown as IncomingMessage)); },
      });
      return request;
    }) as never);
    return calls;
  };
  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses a redirect to port 8443 without connecting to it', async () => {
    const calls = scripted([{ status: 302, headers: { location: 'https://example.com:8443/next' } }]);
    expect(await failure(production().read('https://example.com/start'))).toBe('blocked');
    expect(calls).toEqual([{ host: 'example.com', port: 443, protocol: 'https:' }]);
  });

  it('refuses a redirect to plain http without connecting to it', async () => {
    const calls = scripted([{ status: 301, headers: { location: 'http://example.com/next' } }]);
    expect(await failure(production().read('https://example.com/start'))).toBe('invalid');
    expect(calls).toHaveLength(1);
  });

  it('refuses plain http and another port before any connection', async () => {
    const calls = scripted([]);
    expect(await failure(production().read('http://example.com/'))).toBe('invalid');
    expect(await failure(production().read('https://example.com:8443/'))).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('still follows a redirect that stays on port 443', async () => {
    const calls = scripted([{ status: 302, headers: { location: 'https://example.com:443/next' } }, { status: 200, headers: { 'content-type': 'text/plain' }, body: '届きました' }]);
    expect((await production().read('https://example.com/start')).text).toBe('届きました');
    expect(calls.map((call) => call.port)).toEqual([443, 443]);
  });
});
