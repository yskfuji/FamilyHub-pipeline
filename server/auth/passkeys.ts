import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AppDeps } from '../http/context';

const CHALLENGE_TTL_MS = 5 * 60_000;
interface ChallengeRow { id: string; purpose: string; user_id: string | null; challenge: string; expires_at: string }
interface PasskeyRow { id: string; user_id: string; credential_id: string; public_key: Uint8Array; counter: number; transports: string }

const relyingParty = (deps: AppDeps) => new URL(deps.config.origin).hostname;

function saveChallenge(deps: AppDeps, purpose: string, userId: string | null, challenge: string) {
  const id = deps.ids.next('challenge');
  deps.db.run('DELETE FROM webauthn_challenges WHERE unixepoch(expires_at) < unixepoch(?)', deps.clock.now());
  deps.db.run('INSERT INTO webauthn_challenges (id, purpose, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)', id, purpose, userId, challenge, new Date(Date.parse(deps.clock.now()) + CHALLENGE_TTL_MS).toISOString());
  return id;
}

/** 認証の課題は1回だけ使える。取り出すと同時に消す。 */
function takeChallenge(deps: AppDeps, id: string, purpose: string): ChallengeRow | null {
  return deps.db.transaction(() => {
    const row = deps.db.get<ChallengeRow>('SELECT id, purpose, user_id, challenge, expires_at FROM webauthn_challenges WHERE id = ?', id);
    if (row) deps.db.run('DELETE FROM webauthn_challenges WHERE id = ?', id);
    return row && row.purpose === purpose && Date.parse(row.expires_at) > Date.parse(deps.clock.now()) ? row : null;
  });
}

export async function beginAuthentication(deps: AppDeps) {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(deps), userVerification: 'required' });
  return { challengeId: saveChallenge(deps, 'sign-in', null, options.challenge), publicKey: options };
}

/** 成功したら利用者の ID を返す。署名・オリジン・RP ID は検証の関数が確かめる。 */
export async function finishAuthentication(deps: AppDeps, challengeId: string, assertion: AuthenticationResponseJSON): Promise<string | null> {
  const challenge = takeChallenge(deps, challengeId, 'sign-in');
  const passkey = deps.db.get<PasskeyRow>('SELECT id, user_id, credential_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?', assertion.id);
  if (!challenge || !passkey) return null;
  try {
    const result = await verifyAuthenticationResponse({
      response: assertion, expectedChallenge: challenge.challenge, expectedOrigin: deps.config.origin, expectedRPID: relyingParty(deps), requireUserVerification: true,
      credential: { id: passkey.credential_id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.counter, transports: JSON.parse(passkey.transports) as AuthenticatorTransport[] },
    });
    if (!result.verified) return null;
    deps.db.run('UPDATE passkeys SET counter = ? WHERE id = ?', result.authenticationInfo.newCounter, passkey.id);
    return passkey.user_id;
  } catch {
    return null;
  }
}

export async function beginRegistration(deps: AppDeps, user: { id: string; email: string; displayName: string }) {
  const existing = deps.db.all<{ credential_id: string; transports: string }>('SELECT credential_id, transports FROM passkeys WHERE user_id = ?', user.id);
  const options = await generateRegistrationOptions({
    rpName: 'よりどころ', rpID: relyingParty(deps), userName: user.email, userDisplayName: user.displayName, userID: new TextEncoder().encode(user.id),
    attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((item) => ({ id: item.credential_id, transports: JSON.parse(item.transports) as AuthenticatorTransport[] })),
  });
  return { challengeId: saveChallenge(deps, 'register', user.id, options.challenge), publicKey: options };
}

export async function finishRegistration(deps: AppDeps, userId: string, challengeId: string, credential: RegistrationResponseJSON) {
  const challenge = takeChallenge(deps, challengeId, 'register');
  if (!challenge || challenge.user_id !== userId) return null;
  try {
    const result = await verifyRegistrationResponse({ response: credential, expectedChallenge: challenge.challenge, expectedOrigin: deps.config.origin, expectedRPID: relyingParty(deps), requireUserVerification: true });
    if (!result.verified || !result.registrationInfo) return null;
    const { credential: created } = result.registrationInfo;
    const id = deps.ids.next('passkey');
    const createdAt = deps.clock.now();
    const label = 'パスキー';
    deps.db.run('INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, userId, created.id, created.publicKey, created.counter, JSON.stringify(created.transports ?? []), label, createdAt);
    return { id, label, createdAt, kind: 'passkey' as const, demo: false };
  } catch {
    return null;
  }
}
