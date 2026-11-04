declare const __FAMILY_HUB_BUILD__: string | undefined;

/**
 * 配信物の版の印。`npm run build:server` のとき、画面のビルドと同じ値を vite.config.ts が埋める。
 * tsx で直接動かすときは未定義なので、新しい版の知らせを出さない値にする。
 */
export const serverBuild = typeof __FAMILY_HUB_BUILD__ === 'string' ? __FAMILY_HUB_BUILD__ : 'development';
