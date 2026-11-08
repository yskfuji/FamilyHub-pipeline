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

const urls = host.URL as { createObjectURL?: unknown } | undefined;
if (!urls || typeof urls.createObjectURL !== 'function') {
  // 送ったファイルを表示する URL。中身は Swift が ref で持つ。
  const createObjectURL = (file: NativeFile) => `fh-file://${file.ref}`;
  if (urls) (urls as { createObjectURL: unknown }).createObjectURL = createObjectURL;
  else host.URL = { createObjectURL };
}
