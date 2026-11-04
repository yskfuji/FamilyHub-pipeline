import { Component, lazy, useEffect, useLayoutEffect, useState, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from 'react';
import { EmptyState } from '../design-system/components';
import { EmptyError } from '../design-system/illustrations/EmptyError';

/**
 * 画面の部品の読み込みと失敗の扱い。
 * - lazyRoute: 経路ごとに分けて読む。読み込みに失敗した部品は、もう一度読み込むときに作り直す（React.lazy は失敗を覚えたままになるため）。
 * - PageLoading: 読んでいる間の骨組み。10秒を超えたら、経過を文字で知らせる。
 * - RouteReady: 画面の本文を描き終えたことを html の data-route-ready に書く（試験が描き終わりを待つ印）。
 * - RouteErrorBoundary: 経路ごとのエラー境界。下書きは消さない（すぐに追加の入力や未送信の変更は、この境界の外にある）。
 */

/** 画面の部品を読み込めなかったこと（配信の入れ替えの後や、接続が切れたとき）。描画中の失敗と区別する。 */
export class RouteLoadError extends Error {
  constructor(cause: unknown) {
    super('route chunk failed to load', { cause });
    this.name = 'RouteLoadError';
  }
}

interface Entry { reset(): boolean; failures: number }
const entries = new Set<Entry>();

/**
 * 読み込めなかったファイルの URL。Chromium と Firefox は失敗の文に含める。Safari は含めないので、
 * ビルドが先読みのために置く <link rel="modulepreload">（ファイル名は部品の名前で始まる）から探す。
 */
function failedUrlOf(error: unknown, name: string) {
  const fromMessage = error instanceof Error ? error.message.match(/(https?:\/\/[^\s'"]+?\.m?js)\b/)?.[1] : undefined;
  if (fromMessage) return fromMessage;
  const link = document.querySelector<HTMLLinkElement>(`link[rel="modulepreload"][href*="/${name}-"]`);
  return link?.href ?? null;
}

/**
 * 経路の部品を分けて読む。名前つきの書き出し name を React.lazy に渡す。
 * 失敗したら、次に描くときに読み直す。ブラウザは失敗した import を覚えているので、
 * URL が分かれば ?retry= を付けた別の URL で読み直す（同じオリジンのファイル）。
 */
export function lazyRoute<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  let failedUrl: string | null = null;
  const entry: Entry = {
    failures: 0,
    reset() {
      if (!this.failures) return false;
      current = make();
      // 2回続けて失敗したか、読み直す URL が分からない（同じ URL ではブラウザが失敗を覚えている）ときは、ページを読み込み直す。
      return this.failures >= 2 || !failedUrl;
    },
  };
  const make = () => lazy(async () => {
    try {
      const module = failedUrl ? await import(/* @vite-ignore */ `${failedUrl}?retry=${entry.failures}`) as M : await load();
      entry.failures = 0;
      failedUrl = null;
      return { default: module[name] as ComponentType<object> };
    } catch (error) {
      entry.failures += 1;
      failedUrl = failedUrlOf(error, String(name)) ?? failedUrl;
      throw new RouteLoadError(error);
    }
  });
  let current: LazyExoticComponent<ComponentType<object>> = make();
  entries.add(entry);
  function Route(props: object) {
    const Current = current;
    return <Current {...props}/>;
  }
  return Route as M[K];
}

/**
 * 読み込みに失敗した部品を、次に描くときに読み直す。ページを読み込み直すしかない部品があれば true
 * （2回続けて失敗した＝配信が入れ替わって古いファイルがもうない、または読み直す URL が分からない）。
 */
export function resetFailedRoutes() {
  let reload = false;
  entries.forEach((entry) => { if (entry.reset()) reload = true; });
  return reload;
}

export const markReady = (path: string | null) => {
  if (path === null) delete document.documentElement.dataset.routeReady;
  else document.documentElement.dataset.routeReady = path;
};

/** 同じ Suspense の中に置くと、本文と一緒に描かれたときだけ印を書く。 */
export function RouteReady() {
  useLayoutEffect(() => { markReady(window.location.pathname); });
  return null;
}

/** 読み込み中の骨組み。見出しの高さを取っておき、読み終えたときに内容がずれないようにする。 */
export function PageLoading() {
  const [seconds, setSeconds] = useState(0);
  useLayoutEffect(() => { markReady(null); }, []);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="page page-loading" aria-busy="true" aria-label="画面を読み込んでいます">
    <div className="page-head"><div className="full"><div className="skeleton skeleton-line eyebrow-line"/><div className="skeleton skeleton-line title-line"/><div className="skeleton skeleton-line lede-line"/></div></div>
    <div className="grid two"><div className="skeleton"/><div className="skeleton"/></div>
    {seconds >= 10 && <p className="small muted loading-slow" role="status">読み込みに時間がかかっています（{seconds}秒）。接続が戻りしだい表示します。</p>}
  </div>;
}

interface BoundaryProps { resetKey: string; children?: ReactNode }
interface BoundaryState { error: unknown }

/**
 * 経路ごとのエラー境界。「もう一度読み込む」はこの画面だけを作り直し（失敗した部品は読み直す）、ページ全体は読み込み直さない。
 * そのため、枠の中のすぐに追加の入力や、端末に残した未送信の変更はそのまま残る。別の画面へ移ると元に戻る。
 */
export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 原因を開発者の道具で追えるように残す。画面には出さない。
    console.error(error, info.componentStack);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  retry = () => {
    // 2回続けて読み込めなかったときだけ、ページ全体を読み込み直す（保存していない入力があれば、ブラウザが確かめる）。
    if (resetFailedRoutes()) { window.location.reload(); return; }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <RouteErrorView loadFailed={this.state.error instanceof RouteLoadError} onRetry={this.retry}/>;
  }
}

function RouteErrorView({ loadFailed, onRetry }: { loadFailed: boolean; onRetry: () => void }) {
  useLayoutEffect(() => { markReady(window.location.pathname); }, []);
  return <div className="page route-error" role="alert" data-route-error={loadFailed ? 'load' : 'render'}>
    <EmptyState title={loadFailed ? 'この画面を読み込めませんでした' : 'この画面を表示できませんでした'} illustration={<EmptyError/>} action={<div className="route-error-actions">
      <button data-control-id="route.error.retry" className="button primary" type="button" onClick={onRetry}>もう一度読み込む</button>
      <a data-control-id="route.error.today" className="button" href="/today" data-link>今日へ戻る</a>
    </div>}>
      {loadFailed ? '接続が切れたか、新しい版に入れ替わった可能性があります。' : '問題が起きたのはこの画面だけです。'}<span className="keep-together">「すぐに追加」</span>で入力中の内容と、まだ送っていない変更はそのまま残っています。
    </EmptyState>
  </div>;
}
