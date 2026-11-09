import { describe, expect, it } from 'vitest';
import { NativeURL } from './nativePolyfills';

const parts = (make: () => URL | NativeURL) => {
  try {
    const url = make();
    return { protocol: url.protocol, username: url.username, password: url.password, hostname: url.hostname, port: url.port, search: url.search, hash: url.hash };
  } catch {
    return 'invalid';
  }
};

describe('NativeURL（JavaScriptCore の見本で使う URL）', () => {
  // 読み取りの URL の確認とリンクの確認で使う部分（スキーム・名前とパスワード・ホスト・ポート）が、ブラウザーの URL と同じになること。
  const inputs = [
    'https://example.com/event', ' https://example.com/a ', 'http://example.com', 'ftp://example.com', 'example.com', 'https://user:pw@example.com', 'https://user@example.com',
    'https://@example.com', 'https://:pw@example.com', 'https://', 'https:example.com', 'HTTPS://EXAMPLE.COM', 'https://exa mple.com', 'https://[::1]/', 'javascript:alert(1)', '',
    'https://example.com:443/x?y=1#z', 'https://example.com:8080', 'https://example.com:99999', 'https:\\\\example.com\\a', 'mailto:a@b.c', 'https://ex%61mple.com', 'https://a.b/c?#',
    'https://a.b?q', 'https://a.b#f', 'wss://chat.example.com:443/', 'https://user:p:w@example.com/', 'https://a@b@example.com/',
  ];
  it.each(inputs)('%j', (input) => {
    expect(parts(() => new NativeURL(input))).toEqual(parts(() => new URL(input)));
  });
});
