/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 配信物の版の印。vite.config.ts が git から決める。 */
  readonly VITE_BUILD_ID: string;
}

declare module '@fontsource-variable/noto-serif-jp';
