import { dirname, join } from 'node:path';
import { AUDIT_RETENTION_MONTHS } from '../src/domain/auditLog';
import { checkLlmUrl } from './adapters/llm';
import { Keyring, keyringSourceFrom } from './auth/keyring';
import type { KeyringSource } from './auth/keyring';
import { isTimeZone } from './backup/calendar';
import { MIN_BACKUP_KEY_LENGTH } from './backup/format';

export interface ServerConfig {
  production: boolean;
  /** 利用者が開くオリジン。Origin の検査、Cookie、パスキーの RP ID に使う。 */
  origin: string;
  databasePath: string;
  /** 監査の記録のファイル（audit.db）。既定は本体の DB と同じ場所。権限 0600 で作る。 */
  auditDatabasePath: string;
  /** 監査の記録を残す月数。過ぎた分は毎日、checkpoint を残してから消す。0 なら消さない。 */
  auditRetentionMonths: number;
  /** 鍵束。Cookie の値に結ぶ CSRF トークン、期限付きの署名、二段階認証の秘密の暗号化に使う（server/auth/keyring.ts）。 */
  keys: Keyring;
  secureCookies: boolean;
  sessionDays: number;
  /** 金銭や権限の操作に必要な、直近の本人確認の有効時間。 */
  recentAuthMs: number;
  mediaPath: string;
  clamd: { host: string; port: number; timeoutMs: number } | null;
  smtp: { host: string; port: number; user?: string; password?: string; from: string } | null;
  /**
   * 読み取りの補助の接続先（OpenAI 互換）。既定では使わない。同じ機械か家庭内だけに接続する。
   * allowLanHttp は、loopback 以外へ平文の http で送ることを運営者が明示したとき（FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1）だけ true。
   */
  llm: { url: string; key?: string; model: string; timeoutMs: number; allowLanHttp?: boolean } | null;
  /**
   * 暗号化したバックアップ（A8、server/backup）。FAMILY_HUB_BACKUP_DIR と FAMILY_HUB_BACKUP_KEY の両方があるときだけ、毎日自動で作る。
   * どちらかがなければ null（自動のバックアップは止まり、起動のときに運用ログへ出す。起動は止めない）。
   */
  backup: BackupConfig | null;
}

export interface BackupConfig {
  dir: string;
  /** 32文字以上。鍵束（FAMILY_HUB_KEYS・FAMILY_HUB_SECRET）とは別の値にする。 */
  key: string;
  /** 毎日の実行の時刻（家族の時間帯）。既定は 03:00。 */
  at: { hour: number; minute: number };
  /** 日・週・月を数える時間帯。既定は Asia/Tokyo。 */
  timeZone: string;
}

/** バックアップの設定。鍵が短い・鍵束と同じ・時刻や時間帯の形が違うときは起動しない。置き場所か鍵がないときは null。 */
export function loadBackup(env: NodeJS.ProcessEnv, keyring: KeyringSource): BackupConfig | null {
  const key = env.FAMILY_HUB_BACKUP_KEY ?? '';
  if (key && key.length < MIN_BACKUP_KEY_LENGTH) throw new Error('FAMILY_HUB_BACKUP_KEY must be at least 32 characters');
  if (key && keyring.keys.some((item) => item.secret === key)) throw new Error('FAMILY_HUB_BACKUP_KEY must differ from FAMILY_HUB_SECRET and every key in FAMILY_HUB_KEYS');
  const at = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(env.FAMILY_HUB_BACKUP_AT ?? '03:00');
  if (!at) throw new Error('FAMILY_HUB_BACKUP_AT must be a time such as 03:00');
  const timeZone = env.FAMILY_HUB_BACKUP_TZ ?? 'Asia/Tokyo';
  if (!isTimeZone(timeZone)) throw new Error('FAMILY_HUB_BACKUP_TZ must be a time zone name such as Asia/Tokyo');
  if (!env.FAMILY_HUB_BACKUP_DIR || !key) return null;
  return { dir: env.FAMILY_HUB_BACKUP_DIR, key, at: { hour: Number(at[1]), minute: Number(at[2]) }, timeZone };
}

const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * 家族の画像と本文を送るので、接続先は同じ機械か家庭内に限る（外部へは送らない）。
 * URL の形と、IP をそのまま書いた宛先はここで確かめる。名前の宛先は起動のときに引いて確かめる（prepareLlmClient）。
 */
function loadLlm(env: NodeJS.ProcessEnv): ServerConfig['llm'] {
  if (!env.FAMILY_HUB_LLM_URL) return null;
  const allowLanHttp = env.FAMILY_HUB_LLM_ALLOW_LAN_HTTP === '1';
  const url = checkLlmUrl(env.FAMILY_HUB_LLM_URL, allowLanHttp);
  if (!env.FAMILY_HUB_LLM_MODEL) throw new Error('FAMILY_HUB_LLM_MODEL is required with FAMILY_HUB_LLM_URL');
  return { url: url.href, key: env.FAMILY_HUB_LLM_KEY, model: env.FAMILY_HUB_LLM_MODEL, timeoutMs: Number(env.FAMILY_HUB_LLM_TIMEOUT_MS ?? 45_000), allowLanHttp };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.FAMILY_HUB_ORIGIN ?? 'http://localhost:4174').origin;
  const keyringSource = keyringSourceFrom(env, production);
  const keys = new Keyring(keyringSource);
  const url = new URL(origin);
  const secureCookies = url.protocol === 'https:';
  if (production && !secureCookies) throw new Error('production requires an https origin');
  if (!secureCookies && !loopback(url.hostname)) throw new Error('plain http is only allowed on loopback hosts');
  const databasePath = env.FAMILY_HUB_DATABASE ?? 'data/family-hub.sqlite';
  const auditRetentionMonths = Number(env.FAMILY_HUB_AUDIT_RETENTION_MONTHS ?? AUDIT_RETENTION_MONTHS);
  if (!Number.isInteger(auditRetentionMonths) || auditRetentionMonths < 0) throw new Error('FAMILY_HUB_AUDIT_RETENTION_MONTHS must be a whole number of months');
  return {
    production,
    origin,
    keys,
    secureCookies,
    databasePath,
    auditDatabasePath: env.FAMILY_HUB_AUDIT_DB ?? (databasePath === ':memory:' ? ':memory:' : join(dirname(databasePath), 'audit.db')),
    auditRetentionMonths,
    sessionDays: 30,
    mediaPath: env.FAMILY_HUB_MEDIA ?? 'data/media',
    clamd: env.FAMILY_HUB_CLAMD_HOST ? { host: env.FAMILY_HUB_CLAMD_HOST, port: Number(env.FAMILY_HUB_CLAMD_PORT ?? 3310), timeoutMs: Number(env.FAMILY_HUB_CLAMD_TIMEOUT_MS ?? 600_000) } : null,
    recentAuthMs: Number(env.FAMILY_HUB_RECENT_AUTH_MS ?? 300_000),
    smtp: env.FAMILY_HUB_SMTP_HOST ? { host: env.FAMILY_HUB_SMTP_HOST, port: Number(env.FAMILY_HUB_SMTP_PORT ?? 587), user: env.FAMILY_HUB_SMTP_USER, password: env.FAMILY_HUB_SMTP_PASSWORD, from: env.FAMILY_HUB_SMTP_FROM ?? 'no-reply@family.example' } : null,
    llm: loadLlm(env),
    backup: loadBackup(env, keyringSource),
  };
}
