/**
 * iOS アプリの見本のモードで、JavaScriptCore の中で動かす入口（docs/ios/README.md）。
 * Web の見本（src/data/mockGateway.ts）をそのまま包み、サーバーと同じ規則（src/domain/commands）で動かす。
 * scripts/ios/build-sample-engine.mjs が1つのファイル（IIFE）にまとめ、アプリに入れる。
 *
 * Swift から使う形:
 *   FH.reset(actorId, optionsJson)              見本の家族を作り直す
 *   FH.call(port, method, argsJson) -> Promise  結果（Result）の JSON を返す
 *   FH.mediaUrl(albumId, itemId, variant)       写真の URL（見本の写真は fh-sample-image://<id>）
 * ファイルは {"__file": {name, type, size, head, ref}} の形で渡す。head は先頭の数バイト（base64）、ref は Swift が中身を持つための印。
 */
import './nativePolyfills';
import { createMockGateway } from '../data/mockGateway';
import type { MockOptions } from '../data/mockGateway';
import type { FamilyHubGateway } from '../data/gateway';
import { NativeFile } from './nativePolyfills';

type Port = Record<string, (...args: unknown[]) => unknown>;
let gateway: FamilyHubGateway = createMockGateway();

const revive = (_key: string, value: unknown) => {
  if (value && typeof value === 'object' && '__file' in value) return new NativeFile((value as { __file: ConstructorParameters<typeof NativeFile>[0] }).__file);
  return value;
};

const engine = {
  reset(actorId: string, optionsJson = '{}') {
    gateway = createMockGateway(actorId, JSON.parse(optionsJson) as MockOptions);
  },
  async call(portName: string, method: string, argsJson = '[]'): Promise<string> {
    const port = (gateway as unknown as Record<string, Port>)[portName];
    const implementation = port?.[method];
    if (typeof implementation !== 'function') return JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `見本にない操作です: ${portName}.${method}`, retryable: false } });
    const args = JSON.parse(argsJson, revive) as unknown[];
    const result = await implementation.apply(port, args);
    return JSON.stringify(result ?? { ok: true });
  },
  mediaUrl(albumId: string, itemId: string, variant: 'thumbnail' | 'file') {
    const url = gateway.albums.mediaUrl({ id: itemId, albumId }, variant);
    // 見本の写真は SVG の data URL。iOS は同じ色を自分で描くので、印だけを返す。
    return url.startsWith('data:image/svg+xml') ? `fh-sample-image://${itemId}` : url;
  },
};

(globalThis as unknown as { FH: typeof engine }).FH = engine;
