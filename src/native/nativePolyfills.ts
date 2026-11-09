/**
 * JavaScriptCore にない Web の機能の、見本のモードに要る分だけの代わり。
 * 時計（setTimeout）は Swift が __fhTimer として渡す。ファイルの中身は Swift が持ち、ここには名前・種類・大きさ・先頭の数バイトだけが来る。
 */
type TimerHost = { __fhTimer?: (milliseconds: number, callback: () => void) => number; __fhClearTimer?: (id: number) => void };
const host = globalThis as unknown as TimerHost & Record<string, unknown>;

if (typeof host.setTimeout !== 'function') {
  host.setTimeout = (callback: () => void, milliseconds = 0) => (host.__fhTimer ? host.__fhTimer(milliseconds, callback) : (Promise.resolve().then(callback), 0));
  host.clearTimeout = (id: number) => host.__fhClearTimer?.(id);
}

if (typeof host.structuredClone !== 'function') {
  // 見本のデータは JSON で表せる値だけでできている。
  host.structuredClone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);
}

// Apple の ICU は円の記号を半角（U+00A5）で書く。サーバー（node）と Web は全角（U+FFE5）なので、見本でもそろえる。
{
  const NativeNumberFormat = Intl.NumberFormat;
  const yen = (text: string) => text.replace(/¥/g, '￥');
  const Wrapped = function (this: unknown, locales?: string | string[], options?: Intl.NumberFormatOptions) {
    const inner = new NativeNumberFormat(locales, options);
    if (options?.currency !== 'JPY') return inner;
    return {
      format: (value: number | bigint) => yen(inner.format(value)),
      formatToParts: (value: number | bigint) => inner.formatToParts(value).map((part) => ({ ...part, value: yen(part.value) })),
      resolvedOptions: () => inner.resolvedOptions(),
    } as unknown as Intl.NumberFormat;
  } as unknown as typeof Intl.NumberFormat;
  Object.assign(Wrapped, { supportedLocalesOf: NativeNumberFormat.supportedLocalesOf });
  (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = Wrapped;
}

const base64Bytes =(text: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => alphabet.indexOf(clean[index + offset] ?? 'A'));
    const value = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6) | chunk[3];
    bytes.push((value >> 16) & 255);
    if (clean[index + 2] !== undefined) bytes.push((value >> 8) & 255);
    if (clean[index + 3] !== undefined) bytes.push(value & 255);
  }
  return new Uint8Array(bytes);
};

/** Swift から渡されたファイル。中身は先頭だけを持つ（画像かどうかを先頭で確かめるため）。 */
export class NativeFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly ref: string;
  readonly head: Uint8Array;
  constructor(input: { name: string; type: string; size: number; head?: string; ref: string }) {
    this.name = input.name;
    this.type = input.type;
    this.size = input.size;
    this.ref = input.ref;
    this.head = base64Bytes(input.head ?? '');
  }
  slice(start = 0, end = this.size) {
    return new NativeFile({ name: this.name, type: this.type, size: Math.max(0, end - start), ref: this.ref, head: '' })
      .withHead(this.head.slice(start, end));
  }
  private withHead(bytes: Uint8Array) { (this as { head: Uint8Array }).head = bytes; return this; }
  async arrayBuffer(): Promise<ArrayBuffer> { return new Uint8Array(this.head).buffer; }
}

if (typeof host.File !== 'function') host.File = NativeFile;
if (typeof host.Blob !== 'function') host.Blob = NativeFile;

if (typeof host.FileReader !== 'function') {
  host.FileReader = class {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsArrayBuffer(file: NativeFile) {
      void file.arrayBuffer().then((buffer) => { this.result = buffer; this.onload?.(); }, () => this.onerror?.());
    }
  };
}

// 送ったファイルを表示する URL（URL.createObjectURL）は、下の NativeURL が持つ。中身は Swift が ref で持つ。

/**
 * URL の読み取り（WHATWG URL の要る分だけ）。JavaScriptCore には URL がなく、読み取りの URL の確認（readingUrlProblem）や
 * リンクの確認（safeHttpsUrlSchema）が、どの URL も「形が違う」として断ってしまうため。
 * スキーム、名前とパスワード、ホスト、ポート、パス、クエリ、フラグメントを分け、ホストのない http(s) などは TypeError にする。
 * 国際化ドメインの変換（punycode）と、パスの文字の %XX への書き換えはしない（確かめるのに要らないため）。
 */
const specialPorts: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21', 'file:': '' };
/** C0 の制御文字と空白（WHATWG の「C0 control or space」）。 */
const isC0OrSpace = (character: string) => character.charCodeAt(0) <= 0x20;
/** ホストに使えない文字。 */
const forbiddenHost = (host: string) => [...host].some((character) => isC0OrSpace(character) || character === '\u007f' || '#%/:<>?@[\\]^|'.includes(character));

/** 名前とパスワードの文字を、WHATWG の userinfo の決まりで %XX にする。 */
const userinfoSet = '"#<>?`{}/:;=@[\\]^|';
const encodeUserinfo = (value: string) => [...value].map((character) => {
  const code = character.codePointAt(0) ?? 0;
  if (!(code <= 0x20 || code >= 0x7f || userinfoSet.includes(character))) return character;
  return encodeURIComponent(character).replace(/[!'()*]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
}).join('');

export class NativeURL {
  protocol = '';
  username = '';
  password = '';
  hostname = '';
  port = '';
  pathname = '';
  search = '';
  hash = '';

  constructor(input: string, base?: string) {
    let text = String(input);
    while (text && isC0OrSpace(text[0])) text = text.slice(1);
    while (text && isC0OrSpace(text[text.length - 1])) text = text.slice(0, -1);
    text = text.replace(/[\t\n\r]/g, '');
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/.exec(text);
    if (!scheme) {
      if (base === undefined) throw new TypeError('Invalid URL');
      const parent = new NativeURL(base);
      const path = text.startsWith('/') ? text : `${parent.pathname.replace(/[^/]*$/, '')}${text}`;
      Object.assign(this, parent, { pathname: '', search: '', hash: '' });
      this.splitPath(path || parent.pathname);
      return;
    }
    this.protocol = `${scheme[1].toLowerCase()}:`;
    const special = this.protocol in specialPorts;
    let rest = scheme[2];
    if (special || rest.startsWith('//')) {
      rest = special ? rest.replace(/^[/\\]*/, '') : rest.slice(2);
      const end = rest.search(special ? /[/\\?#]/ : /[/?#]/);
      const authority = end === -1 ? rest : rest.slice(0, end);
      rest = end === -1 ? '' : rest.slice(end);
      const at = authority.lastIndexOf('@');
      if (at !== -1) {
        const userinfo = authority.slice(0, at);
        const colon = userinfo.indexOf(':');
        this.username = encodeUserinfo(colon === -1 ? userinfo : userinfo.slice(0, colon));
        this.password = encodeUserinfo(colon === -1 ? '' : userinfo.slice(colon + 1));
      }
      const hostPort = at === -1 ? authority : authority.slice(at + 1);
      const portAt = hostPort.startsWith('[') ? hostPort.indexOf(']:') + 1 || -1 : hostPort.lastIndexOf(':');
      const rawHost = (portAt > 0 || (portAt === 0 && !hostPort.startsWith('['))) ? hostPort.slice(0, portAt) : hostPort;
      // ホストの %XX は文字に戻してから確かめる（国際化ドメインの変換と、パスの %XX への書き換えはしない）。
      let hostname: string;
      try { hostname = decodeURIComponent(rawHost); } catch { throw new TypeError('Invalid URL'); }
      const port = portAt >= 0 && hostPort.slice(portAt).startsWith(':') ? hostPort.slice(portAt + 1) : '';
      if (!/^\d*$/.test(port) || Number(port) > 65535) throw new TypeError('Invalid URL');
      const bracketed = /^\[[0-9a-fA-F:.]+\]$/.test(hostname);
      if ((special && this.protocol !== 'file:' && !hostname) || (!bracketed && forbiddenHost(hostname))) throw new TypeError('Invalid URL');
      this.hostname = hostname.toLowerCase();
      this.port = port === '' || specialPorts[this.protocol] === String(Number(port)) ? '' : String(Number(port));
      this.splitPath(special ? rest.replace(/\\/g, '/') || '/' : rest);
    } else {
      this.splitPath(rest);
    }
  }

  private splitPath(value: string) {
    const hashAt = value.indexOf('#');
    if (hashAt !== -1) { this.hash = value.slice(hashAt) === '#' ? '' : value.slice(hashAt); value = value.slice(0, hashAt); }
    const queryAt = value.indexOf('?');
    if (queryAt !== -1) { this.search = value.slice(queryAt) === '?' ? '' : value.slice(queryAt); value = value.slice(0, queryAt); }
    this.pathname = value;
  }

  get host() { return this.port ? `${this.hostname}:${this.port}` : this.hostname; }
  get origin() { return this.protocol in specialPorts && this.protocol !== 'file:' ? `${this.protocol}//${this.host}` : 'null'; }
  get href() {
    const credentials = this.username || this.password ? `${this.username}${this.password ? `:${this.password}` : ''}@` : '';
    const authority = this.protocol in specialPorts || this.hostname ? `//${credentials}${this.host}` : '';
    return `${this.protocol}${authority}${this.pathname}${this.search}${this.hash}`;
  }
  toString() { return this.href; }
  toJSON() { return this.href; }
  static createObjectURL(file: NativeFile) { return `fh-file://${file.ref}`; }
}

if (typeof host.URL !== 'function') host.URL = NativeURL;
