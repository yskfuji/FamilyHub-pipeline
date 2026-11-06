/**
 * 最初の表示を早める先読み（docs/audits/lcp-assessment.md）。http のビルドだけで使う。
 *
 * 入口の JS を読んで動かしてから、セッション、家族の記録、画面の部品を順に取りに行くと、
 * 遅い回線では往復を何度も待つ。そこで HTML の <head> に小さなスクリプトを置き、
 * 入口の JS と並べて次のものを取りに行く。
 * - セッションと家族の記録（GET だけ。応答は runtime.http が最初の1回だけ使う）
 * - 開いた経路の画面の部品と、接続の部品（<link rel="modulepreload">）
 *
 * CSP は script-src 'self' なので、HTML に直接は書かず、同じオリジンのファイルとして配る。
 * このファイルは vite.config.ts からも読むので、ブラウザの型に頼らない。
 */

/**
 * 先に取りに行く API。どれも本文のない GET で、サインインしていなければ 401、権限がなければ 403 を返すだけ（数えも記録もしない）。
 * プライバシーの設定は、AppContext が最初の読み込みで家族の記録と一緒に反映する。
 */
export const BOOT_PREFETCH_PATHS = ['/v1/auth/session', '/v1/households/current/snapshot', '/v1/households/current/privacy'] as const;
/** 先に取った応答を使ってよい時間。これを過ぎたら取り直す。 */
export const BOOT_PREFETCH_TTL_MS = 10_000;
/** window に置く名前。 */
export const BOOT_GLOBAL = '__familyHubBoot';

/**
 * 経路の先頭と、その画面の部品のファイル（src からの位置）。src/app/App.tsx の経路と同じ並び。
 * 画面の部品のファイル名が変わったら bootPrefetch.test.ts が知らせる。
 */
export const BOOT_ROUTE_MODULES: Readonly<Record<string, string>> = {
  '/': 'src/features/auth/WelcomePage.tsx',
  '/welcome': 'src/features/auth/WelcomePage.tsx',
  '/auth': 'src/features/auth/AuthPage.tsx',
  '/sign-up': 'src/features/auth/SignUpPage.tsx',
  '/reset-password': 'src/features/auth/ResetPasswordPage.tsx',
  '/onboarding': 'src/features/auth/OnboardingPage.tsx',
  '/today': 'src/features/today/TodayPage.tsx',
  '/calendar': 'src/features/calendar/CalendarPage.tsx',
  '/tasks': 'src/features/tasks/TasksPage.tsx',
  '/notes': 'src/features/notes/NotesPage.tsx',
  '/budget': 'src/features/budget/BudgetPage.tsx',
  '/albums': 'src/features/albums/AlbumsPage.tsx',
  '/places': 'src/features/places/PlacesPage.tsx',
  '/insights': 'src/features/insights/InsightsPage.tsx',
  '/settings': 'src/features/settings/SettingsPage.tsx',
};
/** どの経路でも使う部品で、入口に入っていないもの（今はない。接続の部品は入口に入れた）。 */
export const BOOT_COMMON_MODULES: readonly string[] = [];

export interface BootFiles { common: string[]; routes: Record<string, string[]> }

/** 経路の先頭を選ぶ。/today/x は /today、/settings/legal は /settings。 */
export function bootRouteKey(pathname: string, keys: readonly string[] = Object.keys(BOOT_ROUTE_MODULES)): string | undefined {
  if (keys.includes(pathname)) return pathname;
  const head = `/${pathname.split('/')[1] ?? ''}`;
  return head !== '/' && keys.includes(head) ? head : undefined;
}

/**
 * <head> に置くスクリプトの本文。ES5 の範囲で書き、失敗しても画面の読み込みは止めない。
 * 取りに行く形は httpGateway の GET と同じ（credentials: include、Accept: application/json）。
 */
export function bootScriptSource(files: BootFiles): string {
  const routeKeys = Object.keys(files.routes);
  return `(function(){try{
var o={credentials:'include',headers:{Accept:'application/json'}},r={},p=${JSON.stringify(BOOT_PREFETCH_PATHS)};
for(var i=0;i<p.length;i++){r[p[i]]=fetch(p[i],o);r[p[i]].catch(function(){});}
window.${BOOT_GLOBAL}={at:Date.now(),requests:r};
var m=${JSON.stringify(files.routes)},k=location.pathname,s=k.split('/')[1]||'',keys=${JSON.stringify(routeKeys)};
var key=keys.indexOf(k)>=0?k:(s&&keys.indexOf('/'+s)>=0?'/'+s:null);
var f=${JSON.stringify(files.common)}.concat(key?m[key]:[]);
for(var j=0;j<f.length;j++){var l=document.createElement('link');if(/\\.css$/.test(f[j])){l.rel='preload';l.as='style';}else{l.rel='modulepreload';}l.href='/'+f[j];document.head.appendChild(l);}
}catch(e){}})();
`;
}
