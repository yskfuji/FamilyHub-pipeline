import { serverMessages } from '../../src/content/serverMessages';

/**
 * サインイン中の端末の一覧に出す名前。User-Agent から読む。
 * iOS のアプリは `FamilyHubApp/<版>` を付けて送る（ios/Packages/FamilyHubKit の APIClient）。名前を出すだけで、期限や権限は変えない。
 */
export function deviceLabel(agent: string) {
  const app = /\bFamilyHubApp\//.test(agent);
  const device = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Macintosh/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : '';
  if (app && (device === 'iPhone' || device === 'iPad')) return `${device} ${serverMessages.appLabel}`;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : serverMessages.genericBrowser;
  return [device, browser].filter(Boolean).join(' ');
}
