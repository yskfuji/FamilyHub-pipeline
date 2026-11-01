export interface ServerConfig {
  production: boolean;
  /** 利用者が開くオリジン。Origin の検査、Cookie、パスキーの RP ID に使う。 */
  origin: string;
  databasePath: string;
  /** Cookie の値に結ぶ CSRF トークンと、期限付きの署名に使う。 */
  secret: string;
  secureCookies: boolean;
  sessionDays: number;
}

const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.FAMILY_HUB_ORIGIN ?? 'http://localhost:4174').origin;
  const secret = env.FAMILY_HUB_SECRET ?? (production ? '' : 'development-secret-not-for-production-use');
  if (secret.length < 32) throw new Error('FAMILY_HUB_SECRET must be at least 32 characters');
  const url = new URL(origin);
  const secureCookies = url.protocol === 'https:';
  if (production && !secureCookies) throw new Error('production requires an https origin');
  if (!secureCookies && !loopback(url.hostname)) throw new Error('plain http is only allowed on loopback hosts');
  return {
    production,
    origin,
    secret,
    secureCookies,
    databasePath: env.FAMILY_HUB_DATABASE ?? 'data/family-hub.sqlite',
    sessionDays: 30,
  };
}
