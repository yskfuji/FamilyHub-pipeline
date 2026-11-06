import { describe, expect, it, vi } from 'vitest';
import { bootFetch, type BootPrefetch } from './bootFetch';
import appSource from './App.tsx?raw';
import { BOOT_GLOBAL, BOOT_PREFETCH_PATHS, BOOT_PREFETCH_TTL_MS, BOOT_ROUTE_MODULES, bootRouteKey, bootScriptSource } from './bootPrefetch';

const origin = 'http://localhost:4174';
const response = (body: string) => Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
const prefetch = (at = 1_000): BootPrefetch => ({ at, requests: { '/v1/auth/session': response('"pre-session"'), '/v1/households/current/snapshot': response('"pre-snapshot"') } });
const base = () => vi.fn<typeof fetch>(async () => new Response('"network"'));
const text = async (result: Promise<Response>) => (await result).text();

describe('bootFetch (first-paint prefetch, docs/audits/lcp-assessment.md)', () => {
  it('uses each prefetched GET once, then goes to the network', async () => {
    const network = base();
    const fetcher = bootFetch(prefetch(), origin, network, () => 1_500);
    expect(await text(fetcher(new URL('/v1/auth/session', origin)))).toBe('"pre-session"');
    expect(await text(fetcher(new URL('/v1/auth/session', origin)))).toBe('"network"');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('drops every prefetched answer after any non-GET request (sign-in, sign-out and other changes)', async () => {
    const network = base();
    const fetcher = bootFetch(prefetch(), origin, network, () => 1_500);
    await fetcher(new URL('/v1/auth/sign-in', origin), { method: 'POST', body: '{}' });
    expect(await text(fetcher(new URL('/v1/households/current/snapshot', origin)))).toBe('"network"');
  });

  it('does not use an answer older than the time limit', async () => {
    const network = base();
    const fetcher = bootFetch(prefetch(1_000), origin, network, () => 1_000 + BOOT_PREFETCH_TTL_MS + 1);
    expect(await text(fetcher(new URL('/v1/auth/session', origin)))).toBe('"network"');
  });

  it('fetches again when the prefetch failed', async () => {
    const network = base();
    const failed: BootPrefetch = { at: 1_000, requests: { '/v1/auth/session': Promise.reject(new TypeError('offline')) } };
    failed.requests['/v1/auth/session'].catch(() => undefined);
    const fetcher = bootFetch(failed, origin, network, () => 1_500);
    expect(await text(fetcher(new URL('/v1/auth/session', origin)))).toBe('"network"');
  });

  it('only answers the same path on the same origin without a query', async () => {
    const network = base();
    const fetcher = bootFetch(prefetch(), origin, network, () => 1_500);
    expect(await text(fetcher(new URL('/v1/auth/session?x=1', origin)))).toBe('"network"');
    expect(await text(fetcher(new URL('/v1/auth/session', 'https://elsewhere.example')))).toBe('"network"');
    expect(await text(fetcher(new URL('/v1/auth/session', origin)))).toBe('"pre-session"');
  });

  it('works without any prefetch', async () => {
    const network = base();
    expect(await text(bootFetch(undefined, origin, network)(new URL('/v1/auth/session', origin)))).toBe('"network"');
  });
});

describe('boot prefetch script', () => {
  it('names a page module for every route and every name matches a file and a route in App.tsx', () => {
    const app = appSource;
    const pages = Object.keys(import.meta.glob('../features/*/*Page.tsx')).map((file) => `src/${file.slice(3)}`);
    for (const [path, module] of Object.entries(BOOT_ROUTE_MODULES)) {
      expect(pages, module).toContain(module);
      const name = module.split('/').pop()!.replace('.tsx', '');
      expect(app, name).toContain(`import('../features/${module.split('/').slice(2).join('/').replace('.tsx', '')}')`);
      if (path !== '/') expect(app.includes(`'${path}'`) || app.includes(`at('${path}')`), path).toBe(true);
    }
  });

  it('picks the route by its first segment', () => {
    expect(bootRouteKey('/today')).toBe('/today');
    expect(bootRouteKey('/calendar/event-1')).toBe('/calendar');
    expect(bootRouteKey('/settings/legal')).toBe('/settings');
    expect(bootRouteKey('/')).toBe('/');
    expect(bootRouteKey('/unknown')).toBeUndefined();
  });

  it('starts the GETs, keeps them on window and preloads the files of the opened route', () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fakeFetch = vi.fn((url: string, init?: RequestInit) => { calls.push([url, init]); return Promise.resolve(new Response('{}')); });
    vi.stubGlobal('fetch', fakeFetch);
    window.history.replaceState({}, '', '/calendar/event-1');
    const source = bootScriptSource({ common: ['assets/common.js'], routes: { '/calendar': ['assets/CalendarPage.js', 'assets/calendar.css'], '/today': ['assets/TodayPage.js'] } });
    new Function(source)();
    expect(calls.map(([url]) => url)).toEqual([...BOOT_PREFETCH_PATHS]);
    for (const [, init] of calls) expect(init).toEqual({ credentials: 'include', headers: { Accept: 'application/json' } });
    expect(Object.keys((window as unknown as Record<string, BootPrefetch>)[BOOT_GLOBAL].requests)).toEqual([...BOOT_PREFETCH_PATHS]);
    const links = [...document.head.querySelectorAll('link')].map((link) => `${link.rel}:${link.getAttribute('href')}`);
    expect(links).toEqual(['modulepreload:/assets/common.js', 'modulepreload:/assets/CalendarPage.js', 'preload:/assets/calendar.css']);
    vi.unstubAllGlobals();
  });
});
