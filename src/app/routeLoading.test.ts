// @vitest-environment jsdom
import { createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary, RouteReady, lazyRoute, resetFailedRoutes } from './routeLoading';
import { sizeClassFor } from '../design-system/sizeClass';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('route error boundary (FRAME-3)', () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows "load again" and "back to Today" when a screen throws, and loads again in place', async () => {
    let broken = true;
    const Screen = () => { if (broken) throw new Error('render failure'); return createElement('h1', null, '読めた画面'); };
    await act(async () => root.render(createElement(RouteErrorBoundary, { resetKey: '/insights' }, createElement(Screen))));
    expect(host.querySelector('[data-route-error="render"] h2')?.textContent).toBe('この画面を表示できませんでした');
    expect(host.querySelector('[data-control-id="route.error.today"]')?.getAttribute('href')).toBe('/today');
    expect(document.documentElement.dataset.routeReady).toBe(window.location.pathname);
    broken = false;
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-control-id="route.error.retry"]')!.click(); });
    expect(host.querySelector('h1')?.textContent).toBe('読めた画面');
  });

  it('clears the error when the path changes', async () => {
    const Screen = ({ fail }: { fail: boolean }) => { if (fail) throw new Error('render failure'); return createElement('h1', null, '別の画面'); };
    await act(async () => root.render(createElement(RouteErrorBoundary, { resetKey: '/a' }, createElement(Screen, { fail: true }))));
    expect(host.querySelector('[data-route-error]')).not.toBeNull();
    await act(async () => root.render(createElement(RouteErrorBoundary, { resetKey: '/b' }, createElement(Screen, { fail: false }))));
    expect(host.querySelector('h1')?.textContent).toBe('別の画面');
  });

  it('tells a failed download apart, and reloads the page only when the file cannot be fetched again by URL', async () => {
    const Known = lazyRoute(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/KnownPage-abc.js')), 'KnownPage' as never) as unknown as () => null;
    await act(async () => root.render(createElement(RouteErrorBoundary, { resetKey: '/known' }, createElement(Suspense, { fallback: null }, createElement(Known)))));
    expect(host.querySelector('[data-route-error="load"] h2')?.textContent).toBe('この画面を読み込めませんでした');
    // URL が分かるので、ページは読み込み直さずに別の URL で読み直す。
    expect(resetFailedRoutes()).toBe(false);

    const Unknown = lazyRoute(() => Promise.reject(new TypeError('Importing a module script failed.')), 'UnknownPage' as never) as unknown as () => null;
    await act(async () => root.render(createElement(RouteErrorBoundary, { resetKey: '/unknown' }, createElement(Suspense, { fallback: null }, createElement(Unknown)))));
    expect(host.querySelector('[data-route-error="load"]')).not.toBeNull();
    expect(resetFailedRoutes()).toBe(true);
  });

  it('marks the route ready only after the screen itself has rendered', async () => {
    let release: (value: { Page: () => unknown }) => void = () => undefined;
    const Page = lazyRoute(() => new Promise<{ Page: () => unknown }>((resolve) => { release = resolve; }), 'Page') as unknown as () => null;
    delete document.documentElement.dataset.routeReady;
    await act(async () => root.render(createElement(Suspense, { fallback: createElement('p', null, '読み込み中') }, createElement(RouteReady), createElement(Page))));
    expect(document.documentElement.dataset.routeReady).toBeUndefined();
    await act(async () => release({ Page: () => createElement('h1', null, '本文') }));
    expect(host.querySelector('h1')?.textContent).toBe('本文');
    expect(document.documentElement.dataset.routeReady).toBe(window.location.pathname);
  });
});

describe('size classes (FRAME-1)', () => {
  it('splits the content width at 600 and 1100 px', () => {
    expect([320, 599, 600, 1099, 1100, 1600].map(sizeClassFor)).toEqual(['narrow', 'narrow', 'medium', 'medium', 'wide', 'wide']);
  });
});
