import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db';

/**
 * 鍵束（A7）。鍵には ID（kid）を付け、用途ごとの鍵は HKDF（RFC 5869）で導く。
 *
 * - FAMILY_HUB_KEYS: `kid=秘密` をカンマで並べる。秘密は32文字以上。FAMILY_HUB_ACTIVE_KID が新しく署名・暗号化する鍵。
 * - FAMILY_HUB_KEYS がなければ、FAMILY_HUB_SECRET を kid `legacy` の有効な鍵とする（今の設定のまま動く）。
 *   両方があり、FAMILY_HUB_KEYS に `legacy` がなければ、FAMILY_HUB_SECRET を `legacy` として読むためだけに加える。
 * - 1つの kid の秘密は変えない。秘密を替えるときは新しい kid を足して有効にし、`keys rotate` のあと古い kid を `keys retire` する。
 *
 * 署名（CSRF・パスワードの再設定・添付のリンク）は有効な鍵で作り、引退していないすべての鍵で確かめる。
 * 暗号文は `v2.<kid>.<iv>.<tag>.<本文>`（AES-256-GCM、AAD は用途と利用者 ID）。以前の `iv.tag.本文` は `legacy` で読む。
 */
export const LEGACY_KID = 'legacy';
const KID = /^[A-Za-z0-9_-]{1,32}$/;
const MIN_SECRET_LENGTH = 32;
const SALT = 'family-hub';

export type MacPurpose = 'csrf' | 'reset' | 'attachment';
export type SealPurpose = 'totp-secret';

export interface KeyringSource { keys: ReadonlyArray<{ kid: string; secret: string }>; activeKid: string }

export function keyringSourceFrom(env: NodeJS.ProcessEnv, production: boolean): KeyringSource {
  const fallback = env.FAMILY_HUB_SECRET ?? (production || env.FAMILY_HUB_KEYS ? '' : 'development-secret-not-for-production-use');
  if (!env.FAMILY_HUB_KEYS) {
    if (fallback.length < MIN_SECRET_LENGTH) throw new Error('FAMILY_HUB_SECRET must be at least 32 characters');
    return { keys: [{ kid: LEGACY_KID, secret: fallback }], activeKid: LEGACY_KID };
  }
  const keys = env.FAMILY_HUB_KEYS.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    const kid = index > 0 ? item.slice(0, index) : '';
    const secret = index > 0 ? item.slice(index + 1) : '';
    if (!KID.test(kid)) throw new Error('FAMILY_HUB_KEYS: each entry must be kid=secret with a kid of letters, digits, - or _ (at most 32)');
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`FAMILY_HUB_KEYS: the secret of ${kid} must be at least 32 characters`);
    return { kid, secret };
  });
  if (new Set(keys.map((key) => key.kid)).size !== keys.length) throw new Error('FAMILY_HUB_KEYS: a kid appears twice');
  const declared = keys[0]?.kid;
  const single = keys.length === 1;
  const legacy = keys.find((key) => key.kid === LEGACY_KID);
  if (env.FAMILY_HUB_SECRET && legacy && legacy.secret !== env.FAMILY_HUB_SECRET) throw new Error('FAMILY_HUB_SECRET differs from the legacy entry in FAMILY_HUB_KEYS');
  if (env.FAMILY_HUB_SECRET && !legacy) {
    if (env.FAMILY_HUB_SECRET.length < MIN_SECRET_LENGTH) throw new Error('FAMILY_HUB_SECRET must be at least 32 characters');
    keys.push({ kid: LEGACY_KID, secret: env.FAMILY_HUB_SECRET });
  }
  // FAMILY_HUB_KEYS に1つだけ書いたときは、それを有効にする（読むためだけに加えた legacy は数えない）。
  const activeKid = env.FAMILY_HUB_ACTIVE_KID ?? (single ? declared : '');
  if (!activeKid) throw new Error('FAMILY_HUB_ACTIVE_KID is required when FAMILY_HUB_KEYS holds more than one key');
  if (!keys.some((key) => key.kid === activeKid)) throw new Error(`FAMILY_HUB_ACTIVE_KID ${activeKid} is not in FAMILY_HUB_KEYS`);
  return { keys, activeKid };
}

export type KeyState = 'active' | 'available' | 'retired' | 'mismatch' | 'missing';

export class Keyring {
  readonly activeKid: string;
  private readonly secrets: ReadonlyMap<string, string>;
  private readonly derived = new Map<string, Buffer>();
  private retired = new Set<string>();
  private mismatched = new Set<string>();

  constructor(source: KeyringSource) {
    this.secrets = new Map(source.keys.map((key) => [key.kid, key.secret]));
    if (!this.secrets.has(source.activeKid)) throw new Error(`active key ${source.activeKid} is not in the keyring`);
    this.activeKid = source.activeKid;
  }

  kids() { return [...this.secrets.keys()]; }
  has(kid: string) { return this.secrets.has(kid); }
  /** 署名を確かめ、暗号文を読むのに使える鍵。 */
  usable(kid: string) { return this.secrets.has(kid) && !this.retired.has(kid); }
  isRetired(kid: string) { return this.retired.has(kid); }
  isMismatched(kid: string) { return this.mismatched.has(kid); }
  /** 起動のときに DB の記録から設定する（syncKeyring）。 */
  setRecordedState(retired: Iterable<string>, mismatched: Iterable<string>) { this.retired = new Set(retired); this.mismatched = new Set(mismatched); }

  private key(kid: string, info: string) {
    const name = `${kid}\u0000${info}`;
    let value = this.derived.get(name);
    if (!value) {
      const secret = this.secrets.get(kid);
      if (secret === undefined) throw new Error('unknown key');
      value = Buffer.from(hkdfSync('sha256', secret, SALT, info, 32));
      this.derived.set(name, value);
    }
    return value;
  }

  /** 鍵の指紋。秘密そのものは分からない。DB に残し、起動のたびに照らし合わせる。 */
  fingerprint(kid: string) { return createHmac('sha256', this.key(kid, 'key-fingerprint')).update('family-hub key fingerprint v1').digest('hex').slice(0, 32); }

  private mac(kid: string, purpose: MacPurpose, data: string) { return createHmac('sha256', this.key(kid, `mac:${purpose}`)).update(`${purpose}:${data}`).digest('base64url'); }

  /** 有効な鍵で署名する。 */
  sign(purpose: MacPurpose, data: string) { return this.mac(this.activeKid, purpose, data); }

  /**
   * 引退していないすべての鍵での署名。保存した署名を探すとき（パスワードの再設定）に使う。
   * `legacy` には、鍵束を入れる前の形（FAMILY_HUB_SECRET をそのまま HMAC の鍵にしたもの）も含める。
   */
  candidates(purpose: MacPurpose, data: string) {
    const values = this.kids().filter((kid) => this.usable(kid)).map((kid) => this.mac(kid, purpose, data));
    const legacy = this.usable(LEGACY_KID) ? this.secrets.get(LEGACY_KID) : undefined;
    if (legacy !== undefined) values.push(createHmac('sha256', legacy).update(`${purpose}:${data}`).digest('base64url'));
    return values;
  }

  verify(purpose: MacPurpose, data: string, presented: string | undefined) {
    if (!presented) return false;
    const actual = Buffer.from(presented);
    let matched = false;
    for (const candidate of this.candidates(purpose, data)) {
      const expected = Buffer.from(candidate);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) matched = true;
    }
    return matched;
  }

  /** 暗号文の kid。以前の形式は `legacy`。 */
  static kidOf(stored: string) {
    if (!stored.startsWith('v2.')) return LEGACY_KID;
    return stored.split('.')[1] ?? '';
  }

  seal(purpose: SealPurpose, userId: string, plaintext: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.activeKid, purpose), iv);
    cipher.setAAD(Buffer.from(`${purpose}\u0000${userId}`));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return ['v2', this.activeKid, ...[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'))].join('.');
  }

  /** 読めなければ null（鍵がない・引退した・秘密が違う・改ざん）。例外は投げない。 */
  open(purpose: SealPurpose, userId: string, stored: string): Buffer | null {
    try {
      const parts = stored.split('.');
      const v2 = parts[0] === 'v2';
      if (v2 ? parts.length !== 5 : parts.length !== 3) return null;
      const kid = v2 ? parts[1] : LEGACY_KID;
      if (!this.usable(kid)) return null;
      const [iv, tag, body] = (v2 ? parts.slice(2) : parts).map((part) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', this.key(kid, purpose), iv);
      if (v2) decipher.setAAD(Buffer.from(`${purpose}\u0000${userId}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      return null;
    }
  }

  stateOf(kid: string): KeyState {
    if (this.retired.has(kid)) return 'retired';
    if (!this.secrets.has(kid)) return 'missing';
    if (this.mismatched.has(kid)) return 'mismatch';
    return kid === this.activeKid ? 'active' : 'available';
  }
}

export interface KeyReport {
  activeKid: string;
  /** kid ごとの、二段階認証の秘密の件数。 */
  references: Record<string, number>;
  /** 暗号文はあるのに鍵がない kid。その利用者の二段階認証は使えない。 */
  missing: string[];
  /** 記録した指紋と、今の秘密の指紋が違う kid。 */
  mismatched: string[];
  retired: string[];
}

export function totpReferences(db: Db) {
  const references: Record<string, number> = {};
  for (const row of db.all<{ totp_secret: string }>('SELECT totp_secret FROM users WHERE totp_secret IS NOT NULL')) {
    const kid = Keyring.kidOf(row.totp_secret);
    references[kid] = (references[kid] ?? 0) + 1;
  }
  return references;
}

/**
 * 起動のときと運営者の命令の前に呼ぶ。新しい kid の指紋を記録し、記録と違う指紋・引退した kid・鍵のない暗号文を調べる。
 * 鍵のない暗号文があっても止めない（回復コードとパスキーでのサインインを残す）。有効な鍵が引退済みのときだけ止める。
 */
export function syncKeyring(db: Db, keyring: Keyring, nowIso: string): KeyReport {
  const recorded = new Map(db.all<{ kid: string; fingerprint: string; retired_at: string | null }>('SELECT kid, fingerprint, retired_at FROM key_fingerprints').map((row) => [row.kid, row]));
  const mismatched: string[] = [];
  for (const kid of keyring.kids()) {
    const row = recorded.get(kid);
    const fingerprint = keyring.fingerprint(kid);
    if (!row) db.run('INSERT INTO key_fingerprints (kid, fingerprint, created_at, retired_at) VALUES (?, ?, ?, NULL)', kid, fingerprint, nowIso);
    else if (row.fingerprint !== fingerprint) mismatched.push(kid);
  }
  const retired = [...recorded.values()].filter((row) => row.retired_at).map((row) => row.kid);
  if (retired.includes(keyring.activeKid)) throw new Error(`the active key ${keyring.activeKid} has been retired; choose another FAMILY_HUB_ACTIVE_KID`);
  keyring.setRecordedState(retired, mismatched);
  const references = totpReferences(db);
  const missing = Object.keys(references).filter((kid) => !keyring.usable(kid));
  return { activeKid: keyring.activeKid, references, missing, mismatched, retired };
}

/** 運用ログに理由を出す。秘密と利用者の ID は出さない。 */
export function logKeyReport(report: KeyReport, warn: (message: string) => void = console.warn) {
  for (const kid of report.missing) warn(`keys: ${report.references[kid]} two-step secret(s) use key ${kid}, which is missing or retired; those people can sign in with a recovery code or a passkey and must set up the two-step code again`);
  for (const kid of report.mismatched) warn(`keys: the secret of key ${kid} differs from the one first recorded; two-step secrets sealed with the earlier secret cannot be read. Restore the earlier secret, or add a new kid instead of changing a secret`);
}
