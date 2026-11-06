import { BOOT_GLOBAL, BOOT_PREFETCH_TTL_MS } from './bootPrefetch';

/** <head> の先読みのスクリプトが window に置くもの（src/app/bootPrefetch.ts）。 */
export interface BootPrefetch { at: number; requests: Record<string, Promise<Response>> }

declare global {
  interface Window { [BOOT_GLOBAL]?: BootPrefetch }
}

/**
 * 先に取った GET の応答を、同じ経路の最初の1回だけ使う fetch。
 * - 本文のない GET で、同じオリジン、検索の文字列なし、期限の内のときだけ使う。
 * - GET 以外の要求（サインイン・サインアウトなど）を1つでも送ったら、残りは全部捨てる。状態が変わった後に古い応答を使わないため。
 * - 先読みが失敗していたら、その場で取り直す。
 */
export function bootFetch(boot: BootPrefetch | undefined, origin: string, base: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now): typeof fetch {
  const pending = new Map(Object.entries(boot?.requests ?? {}));
  const deadline = (boot?.at ?? 0) + BOOT_PREFETCH_TTL_MS;
  return (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') { pending.clear(); return base(input, init); }
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const prefetched = url.origin === origin && !url.search && !init?.body ? pending.get(url.pathname) : undefined;
    if (!prefetched) return base(input, init);
    pending.delete(url.pathname);
    if (now() > deadline) return base(input, init);
    return prefetched.catch(() => base(input, init));
  };
}

/** window に置かれた先読みを取り出し、二度使われないように消す。 */
export function takeBootPrefetch(): BootPrefetch | undefined {
  const boot = window[BOOT_GLOBAL];
  delete window[BOOT_GLOBAL];
  return boot;
}
