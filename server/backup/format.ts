import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hmac } from 'node:crypto';

/**
 * バックアップの暗号の形式（A8-3）。鍵は FAMILY_HUB_BACKUP_KEY（32文字以上）だけから、用途ごとに HKDF-SHA256 で導く。
 *
 * - ファイル（blob）の名前: HMAC-SHA256(名前の鍵, "blob\0" ‖ 平文全体)。平文の sha256 は使わない（よく知られたファイルがあるかを、鍵なしで確かめられないように）。
 * - 塊: 平文を chunkSize ごとに分け、塊 i の名前は HMAC-SHA256(名前の鍵, "chunk\0" ‖ blob ‖ i ‖ 最後か)。
 *   同じ内容のファイルは世代をまたいで同じ塊になり、1回だけ保存する。
 * - 塊の暗号: AES-256-GCM（乱数の 12 バイトの IV）。AAD は "family-hub-backup/chunk/v1\0" ‖ blob ‖ i ‖ 最後か。
 *   塊を入れ替える・並べ替える・切り捨てる（最後の塊を消すか、途中の塊を最後の塊の名前に置く）と、復号の確認で失敗する。
 *   保存の形は "FHC1" ‖ IV(12) ‖ tag(16) ‖ 暗号文。
 * - 目録: JSON の本文と、本文への HMAC-SHA256（目録の MAC の鍵）。全体を AES-256-GCM で暗号化し、AAD に世代の ID を入れる。
 *   保存の形は "FHM1" ‖ IV(12) ‖ tag(16) ‖ 暗号文。
 */
export const CHUNK_MAGIC = Buffer.from('FHC1');
export const MANIFEST_MAGIC = Buffer.from('FHM1');
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const SALT = 'family-hub-backup v1';
const HEADER = 4 + 12 + 16;
export const MIN_BACKUP_KEY_LENGTH = 32;

export class BackupKeys {
  private readonly chunkKey: Buffer;
  private readonly nameKey: Buffer;
  private readonly manifestKey: Buffer;
  private readonly macKey: Buffer;

  constructor(secret: string) {
    if (secret.length < MIN_BACKUP_KEY_LENGTH) throw new Error('FAMILY_HUB_BACKUP_KEY must be at least 32 characters');
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', secret, SALT, info, 32));
    this.chunkKey = derive('chunk-encryption');
    this.nameKey = derive('names');
    this.manifestKey = derive('manifest-encryption');
    this.macKey = derive('manifest-mac');
  }

  /** ファイル全体の名前を、読みながら計算する。 */
  blobHasher(): Hmac { return createHmac('sha256', this.nameKey).update('blob\u0000'); }

  chunkName(blob: string, index: number, last: boolean) {
    return createHmac('sha256', this.nameKey).update(`chunk\u0000${blob}\u0000${index}\u0000${last ? 1 : 0}`).digest('hex');
  }

  private static chunkAad(blob: string, index: number, last: boolean) {
    return Buffer.from(`family-hub-backup/chunk/v1\u0000${blob}\u0000${index}\u0000${last ? 1 : 0}`);
  }

  sealChunk(blob: string, index: number, last: boolean, plaintext: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.chunkKey, iv);
    cipher.setAAD(BackupKeys.chunkAad(blob, index, last));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([CHUNK_MAGIC, iv, cipher.getAuthTag(), body]);
  }

  /** 読めなければ例外（形・鍵・位置・内容のどれかが違う）。 */
  openChunk(blob: string, index: number, last: boolean, stored: Buffer) {
    if (stored.length < HEADER || !stored.subarray(0, 4).equals(CHUNK_MAGIC)) throw new BackupFormatError('chunk header');
    const decipher = createDecipheriv('aes-256-gcm', this.chunkKey, stored.subarray(4, 16));
    decipher.setAAD(BackupKeys.chunkAad(blob, index, last));
    decipher.setAuthTag(stored.subarray(16, HEADER));
    try {
      return Buffer.concat([decipher.update(stored.subarray(HEADER)), decipher.final()]);
    } catch {
      throw new BackupFormatError(`chunk ${index} of ${blob.slice(0, 12)} does not authenticate`);
    }
  }

  private mac(body: string) { return createHmac('sha256', this.macKey).update(body).digest('hex'); }

  sealManifest(id: string, body: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.manifestKey, iv);
    cipher.setAAD(Buffer.from(`family-hub-backup/manifest/v1\u0000${id}`));
    const plaintext = Buffer.from(JSON.stringify({ body, mac: this.mac(body) }));
    const sealed = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MANIFEST_MAGIC, iv, cipher.getAuthTag(), sealed]);
  }

  /** 目録の本文（JSON の文字列）。復号と MAC の両方を確かめる。 */
  openManifest(id: string, stored: Buffer): string {
    if (stored.length < HEADER || !stored.subarray(0, 4).equals(MANIFEST_MAGIC)) throw new BackupFormatError('manifest header');
    const decipher = createDecipheriv('aes-256-gcm', this.manifestKey, stored.subarray(4, 16));
    decipher.setAAD(Buffer.from(`family-hub-backup/manifest/v1\u0000${id}`));
    decipher.setAuthTag(stored.subarray(16, HEADER));
    let plaintext: Buffer;
    try { plaintext = Buffer.concat([decipher.update(stored.subarray(HEADER)), decipher.final()]); } catch { throw new BackupFormatError('manifest does not authenticate (another key, or changed)'); }
    const parsed = JSON.parse(plaintext.toString('utf8')) as { body?: unknown; mac?: unknown };
    if (typeof parsed.body !== 'string' || typeof parsed.mac !== 'string') throw new BackupFormatError('manifest shape');
    const expected = Buffer.from(this.mac(parsed.body));
    const actual = Buffer.from(parsed.mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new BackupFormatError('manifest MAC');
    return parsed.body;
  }
}

/** 暗号文・目録・塊の食い違い。検証の失敗（終了コード2）として扱う。 */
export class BackupFormatError extends Error {}

export type FileRole = 'database' | 'audit' | 'media';
export interface ManifestFile { path: string; role: FileRole; size: number; sha256: string; blob: string; chunks: number }
export interface ManifestKey { kid: string; fingerprint: string | null; required: boolean }
export interface Manifest {
  format: 1;
  id: string;
  createdAt: string;
  timeZone: string;
  chunkSize: number;
  /** 写した audit.db の鎖の末尾（AuditLog.currentAnchor() と同じ形）。 */
  audit: { seq: number; hash: string };
  /** 写した DB が使う鍵の指紋。required は、確認コードの秘密の暗号化に使っていて、復元に必要なもの。 */
  keys: ManifestKey[];
  files: ManifestFile[];
  /**
   * 写した DB が参照していたのに、置き場所になかったメディアのファイル（置き場所からの相対の位置、昇順）。
   * 1つの欠けで毎日のバックアップが止まり続けないよう、世代は作り、欠けを記録する。verify はここにあるものだけを警告として扱う。
   */
  missing?: string[];
}

const SAFE_PATH = /^(?:family-hub\.sqlite|audit\.db|media\/[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+\/(?:original|thumbnail\.jpg))$/;
/** 目録に書けるファイルの位置。置き場所の外を指す位置（.. など）は書かない。 */
export const isSafePath = (path: string) => SAFE_PATH.test(path) && !path.split('/').some((part) => part === '..' || part === '.');
const HEX64 = /^[0-9a-f]{64}$/;

/** 目録の本文を読み、形を確かめる。 */
export function parseManifest(id: string, body: string): Manifest {
  const value = JSON.parse(body) as Manifest;
  const fail = (what: string) => { throw new BackupFormatError(`manifest ${what}`); };
  if (value.format !== 1 || value.id !== id || typeof value.createdAt !== 'string' || !Number.isInteger(value.chunkSize) || value.chunkSize <= 0) fail('header');
  if (!value.audit || !Number.isInteger(value.audit.seq) || !HEX64.test(value.audit.hash)) fail('audit anchor');
  if (!Array.isArray(value.keys) || !Array.isArray(value.files)) fail('lists');
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isSafePath(file.path) || paths.has(file.path)) fail(`path ${String(file.path).slice(0, 80)}`);
    paths.add(file.path);
    if (!HEX64.test(file.blob) || !HEX64.test(file.sha256) || !Number.isInteger(file.size) || file.size < 0) fail(`file ${file.path}`);
    if (file.chunks !== Math.max(1, Math.ceil(file.size / value.chunkSize))) fail(`chunk count of ${file.path}`);
  }
  if (!value.files.some((file) => file.role === 'database') || !value.files.some((file) => file.role === 'audit')) fail('database files');
  if (value.missing !== undefined) {
    if (!Array.isArray(value.missing)) fail('missing list');
    for (const path of value.missing ?? []) if (typeof path !== 'string' || !isSafePath(path) || !path.startsWith('media/') || paths.has(path)) fail(`missing path ${String(path).slice(0, 80)}`);
    if (new Set(value.missing).size !== value.missing?.length) fail('missing list');
  }
  return value;
}
