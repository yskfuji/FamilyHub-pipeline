/**
 * iOS の見本の仕組み（sample-engine.js）を node で動かす。JavaScriptCore と同じく、Web の機能のない文脈で動かす。
 * 見本の JSON の書き出しと、仕組みの試験に使う。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const enginePath = 'ios/Packages/FamilyHubKit/Sources/FHGateway/Resources/sample-engine.js';

export function loadSampleEngine(source = readFileSync(enginePath, 'utf8')) {
  const timers = new Set();
  const context = vm.createContext({
    __fhTimer: (milliseconds, callback) => { const handle = setTimeout(() => { timers.delete(handle); callback(); }, milliseconds); timers.add(handle); return timers.size; },
    __fhClearTimer: () => undefined,
  });
  vm.runInContext(source, context, { filename: 'sample-engine.js' });
  const engine = context.FH;
  return {
    reset: (actorId, options = {}) => engine.reset(actorId, JSON.stringify(options)),
    /** 結果（Result）の値を返す。失敗なら投げる。 */
    async call(port, method, ...args) {
      return JSON.parse(await engine.call(port, method, JSON.stringify(args)));
    },
    async value(port, method, ...args) {
      const result = JSON.parse(await engine.call(port, method, JSON.stringify(args)));
      if (!result.ok) throw new Error(`${port}.${method}: ${result.error.code} ${result.error.message}`);
      return result.value;
    },
    mediaUrl: (albumId, itemId, variant) => engine.mediaUrl(albumId, itemId, variant),
  };
}
