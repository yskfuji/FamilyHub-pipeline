import { randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverMessages } from '../../../src/content/serverMessages';
import { accountUpdateSchema, ADULT_AGE, ageOn, signUpSchema } from '../../../src/domain/account';
import { auditFieldsFor } from '../../../src/domain/auditLog';
import { checkNewPassword } from '../../../src/domain/passwordPolicy';
import type { PasswordContext } from '../../../src/domain/passwordPolicy';
import { householdProfileSchema, passwordSchema } from '../../../src/domain/schemas';
import type { HouseholdMembership, Result } from '../../../src/domain/types';
import { ok } from '../../../src/domain/commands/context';
import { loadAggregate, saveAggregate } from '../../db/aggregateStore';
import { hashPassword, verifyAndUpgradePassword } from '../../auth/password';
import { Keyring } from '../../auth/keyring';
import { hashRecoveryCode, matchingStep, newRecoveryCodes, openTotpSecret, sealTotpSecret, totpUri } from '../../auth/totp';
import { clearSessionCookie } from '../../auth/sessions';
import { sendError, unauthenticated } from '../context';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { limit } from '../rateLimit';

const RESET_TTL_MS = 30 * 60_000;
const RESEND_INTERVAL_MS = 60_000;
const MAX_RESET_ATTEMPTS = 5;

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'own', idempotent: false, ...overrides } as RouteDeclaration });
const anonymous = (operationId: string) => declare(operationId, { auth: 'public', capability: 'none' });

interface AccountRow { id: string; email: string; display_name: string; password_hash: string | null; birthdate: string | null; adult_declared_at: string | null; avatar: string | null; idle_timeout_minutes: number; totp_secret: string | null; totp_enabled_at: string | null; totp_last_step: number | null }

const today = (deps: AppDeps) => deps.clock.now().slice(0, 10);
/** 本人のアカウントの操作の記録。家族には属さない（本人の「アカウントの記録」にだけ出る）。 */
export const auditAccount = (deps: AppDeps, userId: string, action: string, options: { householdId?: string; fields?: readonly string[] } = {}) => deps.audit.record({ id: deps.ids.next('audit'), at: deps.clock.now(), householdId: options.householdId ?? null, actorUserId: userId, action, detail: options.fields?.length ? JSON.stringify({ fields: [...options.fields].sort() }) : null });
const clientKey = (request: FastifyRequest) => request.ip;

/** 新しいパスワードと比べる、その人に関わる語（メールアドレス・表示名・家族グループの名前）。 */
export function passwordContextFor(deps: AppDeps, userId: string): PasswordContext {
  const user = deps.db.get<{ email: string; display_name: string }>('SELECT email, display_name FROM users WHERE id = ?', userId);
  const member = deps.db.get<{ household_id: string }>('SELECT household_id FROM household_members WHERE user_id = ?', userId);
  const household = member ? deps.db.get<{ name: string | null }>("SELECT json_extract(body, '$.household.name') AS name FROM records WHERE household_id = ? AND collection = 'meta' AND id = 'household'", member.household_id) : undefined;
  return { email: user?.email, displayName: user?.display_name, householdName: household?.name ?? null };
}

const weakPassword = (message: string) => ({ code: 'INVALID_INPUT' as const, message, retryable: false });

function current(deps: AppDeps, request: FastifyRequest) {
  if (!request.session) throw unauthenticated();
  const row = deps.db.get<AccountRow>('SELECT id, email, display_name, password_hash, birthdate, adult_declared_at, avatar, idle_timeout_minutes, totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id = ? AND deleted_at IS NULL', request.session.user_id);
  if (!row) throw unauthenticated();
  return row;
}

type SecondFactorRow = Pick<AccountRow, 'id' | 'totp_secret' | 'totp_last_step'>;

/**
 * 二段階認証の秘密を読む。鍵がない・引退した・秘密が違うときは null にして、運用ログに理由を出す（500 にしない）。
 * そのときも回復コードとパスキーでサインインでき、設定から登録し直せる（A7-5、A7-6）。
 */
function readTotpSecret(deps: AppDeps, row: SecondFactorRow) {
  if (!row.totp_secret) return null;
  const secret = openTotpSecret(deps.config.keys, row.id, row.totp_secret);
  if (!secret) console.warn(`keys: a two-step secret sealed with key ${Keyring.kidOf(row.totp_secret)} cannot be read (${deps.config.keys.stateOf(Keyring.kidOf(row.totp_secret))}); accepting recovery codes only`);
  return secret;
}

/** 二段階認証を設定済みなのに、鍵がなくて確認コードを確かめられない。 */
export const totpUnavailable = (deps: AppDeps, row: SecondFactorRow & { totp_enabled_at: string | null }) => Boolean(row.totp_enabled_at && row.totp_secret && !openTotpSecret(deps.config.keys, row.id, row.totp_secret));

const profileOf = (deps: AppDeps, row: AccountRow) => ({
  displayName: row.display_name, email: row.email, avatar: row.avatar ? JSON.parse(row.avatar) as unknown : { kind: 'initial' as const },
  idleTimeoutMinutes: row.idle_timeout_minutes, birthdateDeclared: Boolean(row.birthdate), adultDeclared: Boolean(row.adult_declared_at), totpEnabled: Boolean(row.totp_enabled_at),
  totpUnavailable: totpUnavailable(deps, row),
});

/** 秘密が保存されていて確認も済んだ利用者のコードを確かめ、一度使った時間枠を記録する。回復コードも受け付ける。 */
export function verifySecondFactor(deps: AppDeps, row: SecondFactorRow, code: string) {
  const normalized = code.trim();
  if (row.totp_secret && /^\d{6}$/.test(normalized)) {
    const secret = readTotpSecret(deps, row);
    if (!secret) return false;
    const step = matchingStep(secret, normalized, Date.parse(deps.clock.now()), row.totp_last_step);
    if (step === null) return false;
    deps.db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, row.id);
    return true;
  }
  const used = deps.db.run('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', deps.clock.now(), row.id, hashRecoveryCode(normalized));
  return Number(used.changes) === 1;
}

function respondResult<T>(reply: FastifyReply, result: Result<T>) {
  return result.ok ? (result.value === undefined ? reply.code(204).send() : reply.send(result.value)) : sendError(reply, result.error);
}

export function registerAccountRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/auth/sign-up', { config: anonymous('signUp') }, async (request, reply) => {
    limit(deps, `sign-up:${clientKey(request)}`, 10, 3_600_000);
    const input = parse(signUpSchema, request.body);
    const problem = await checkNewPassword(input.password, { email: input.email, displayName: input.displayName });
    if (problem) return sendError(reply, weakPassword(problem));
    const age = ageOn(input.birthdate, today(deps));
    if (age < 0 || age > 130) return sendError(reply, { code: 'INVALID_INPUT', message: serverMessages.birthdateInvalid, retryable: false });
    if (age < ADULT_AGE && !input.guardianConsent) return sendError(reply, { code: 'INVALID_INPUT', message: serverMessages.guardianConsentRequired, retryable: false });
    const hash = await hashPassword(input.password);
    const taken = deps.db.get('SELECT id FROM users WHERE email = ?', input.email);
    if (taken) return sendError(reply, { code: 'CONFLICT', message: serverMessages.emailTaken, retryable: false });
    const id = deps.ids.next('user');
    deps.db.run('INSERT INTO users (id, email, display_name, avatar_tone, password_hash, created_at, birthdate, adult_declared_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.email, input.displayName, 'indigo', hash, deps.clock.now(), input.birthdate, age >= ADULT_AGE ? deps.clock.now() : null);
    auditAccount(deps, id, 'signUp');
    return reply.code(201).send({ userId: id });
  });

  app.post('/v1/auth/password-reset', { config: anonymous('requestPasswordReset') }, async (request, reply) => {
    const { email } = parse(z.object({ email: z.string().max(254) }), request.body);
    limit(deps, `reset:${clientKey(request)}`, 10, 3_600_000);
    const user = deps.db.get<{ id: string; email: string }>('SELECT id, email FROM users WHERE email = ? AND deleted_at IS NULL', email.trim());
    // 登録の有無で応答を変えない。
    if (!user || !deps.mailer.available) return reply.code(202).send({ resendAfterSeconds: 60 });
    const latest = deps.db.get<{ created_at: string }>('SELECT created_at FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', user.id);
    const now = Date.parse(deps.clock.now());
    if (latest && now - Date.parse(latest.created_at) < RESEND_INTERVAL_MS) return reply.code(202).send({ resendAfterSeconds: 60 });
    const token = randomBytes(32).toString('base64url');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    deps.db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', deps.clock.now(), user.id);
    deps.db.run('INSERT INTO password_resets (id, user_id, token_hash, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', deps.ids.next('reset'), user.id, deps.config.keys.sign('reset', token), deps.config.keys.sign('reset', `${user.id}:${code}`), deps.clock.now(), new Date(now + RESET_TTL_MS).toISOString());
    await deps.mailer.send({ to: user.email, subject: serverMessages.resetSubject, text: serverMessages.resetBody(code, `${deps.config.origin}/reset-password#token=${token}`) });
    return reply.code(202).send({ resendAfterSeconds: 60 });
  });

  app.post('/v1/auth/password-reset/confirm', { config: anonymous('confirmPasswordReset') }, async (request, reply) => {
    const body = parse(z.object({ email: z.string().max(254).optional(), code: z.string().max(10).optional(), token: z.string().max(100).optional(), newPassword: z.string().max(200) }), request.body);
    const rejected = { code: 'UNAUTHENTICATED' as const, message: serverMessages.resetInvalid, retryable: false };
    limit(deps, `reset-confirm:${clientKey(request)}`, 20, 3_600_000);
    const parsed = passwordSchema.safeParse(body.newPassword);
    if (!parsed.success) return sendError(reply, { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? serverMessages.invalidInput, retryable: false });
    // 一覧と並びは、誰の再設定かを確かめる前に見る。その人に関わる語は、確かめた後に見る。
    const common = await checkNewPassword(parsed.data);
    if (common) return sendError(reply, weakPassword(common));
    interface ResetRow { id: string; user_id: string; code_hash: string; attempts: number; expires_at: string; used_at: string | null }
    let row: ResetRow | undefined;
    // 鍵を替えた後も、引退していないすべての鍵で探す。
    if (body.token) row = deps.db.get<ResetRow>('SELECT id, user_id, code_hash, attempts, expires_at, used_at FROM password_resets WHERE token_hash IN (SELECT value FROM json_each(?))', JSON.stringify(deps.config.keys.candidates('reset', body.token)));
    else if (body.email && body.code) {
      const user = deps.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', body.email.trim());
      row = user ? deps.db.get<ResetRow>('SELECT id, user_id, code_hash, attempts, expires_at, used_at FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', user.id) : undefined;
      if (row && !deps.config.keys.verify('reset', `${row.user_id}:${body.code}`, row.code_hash)) {
        deps.db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', row.id);
        return sendError(reply, rejected);
      }
    }
    if (!row || row.used_at || row.attempts >= MAX_RESET_ATTEMPTS || Date.parse(row.expires_at) <= Date.parse(deps.clock.now())) return sendError(reply, rejected);
    const personal = await checkNewPassword(parsed.data, passwordContextFor(deps, row.user_id));
    if (personal) return sendError(reply, weakPassword(personal));
    const hashed = await hashPassword(parsed.data);
    const { id, user_id: userId } = row;
    deps.db.transaction(() => {
      deps.db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', deps.clock.now(), id);
      deps.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashed, userId);
      // 再設定の後は自動でサインインせず、すべての端末をサインアウトする。
      deps.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', deps.clock.now(), userId);
      auditAccount(deps, userId, 'confirmPasswordReset');
    });
    return reply.code(204).send();
  });

  app.post('/v1/auth/reauthenticate', { config: declare('reauthenticate') }, async (request, reply) => {
    const row = current(deps, request);
    limit(deps, `reauth:${row.id}`, 10, 900_000);
    const { password } = parse(z.object({ password: z.string().max(200) }), request.body);
    if (!(await verifyAndUpgradePassword(deps.db, row.id, password, row.password_hash))) return sendError(reply, { code: 'UNAUTHENTICATED', message: serverMessages.passwordWrong, retryable: false, reason: 'REAUTH_FAILED' });
    deps.db.run('UPDATE sessions SET reauthenticated_at = ? WHERE id = ?', deps.clock.now(), request.session?.id ?? '');
    return reply.code(204).send();
  });

  app.get('/v1/account', { config: declare('getAccount', { csrf: false }) }, (request) => profileOf(deps, current(deps, request)));
  app.patch('/v1/account', { config: declare('updateAccount') }, (request, reply) => {
    const row = current(deps, request);
    const input = parse(accountUpdateSchema, request.body);
    if (input.birthdate && row.birthdate) return sendError(reply, { code: 'CONFLICT', message: serverMessages.birthdateOnce, retryable: false });
    deps.db.transaction(() => {
      if (input.displayName) {
        deps.db.run('UPDATE users SET display_name = ? WHERE id = ?', input.displayName, row.id);
        const member = deps.db.get<{ household_id: string; membership_id: string }>('SELECT household_id, membership_id FROM household_members WHERE user_id = ?', row.id);
        if (member) {
          const stored = deps.db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'memberships' AND id = ?", member.household_id, member.membership_id);
          if (stored) deps.db.run("UPDATE records SET body = ? WHERE household_id = ? AND collection = 'memberships' AND id = ?", JSON.stringify({ ...JSON.parse(stored.body), displayName: input.displayName }), member.household_id, member.membership_id);
        }
      }
      if (input.avatar) deps.db.run('UPDATE users SET avatar = ? WHERE id = ?', JSON.stringify(input.avatar), row.id);
      if (input.idleTimeoutMinutes) deps.db.run('UPDATE users SET idle_timeout_minutes = ? WHERE id = ?', input.idleTimeoutMinutes, row.id);
      if (input.birthdate) {
        const adult = ageOn(input.birthdate, today(deps)) >= ADULT_AGE;
        deps.db.run('UPDATE users SET birthdate = ?, adult_declared_at = ? WHERE id = ?', input.birthdate, adult ? deps.clock.now() : null, row.id);
      }
      auditAccount(deps, row.id, 'updateAccount', { fields: auditFieldsFor('updateAccount', input) ?? [] });
    });
    return profileOf(deps, current(deps, request));
  });
  app.post('/v1/account/email', { config: declare('changeEmail', { recentAuth: true }) }, async (request, reply) => {
    const row = current(deps, request);
    const { email } = parse(z.object({ email: z.email(serverMessages.emailInvalid).max(254) }), request.body);
    if (deps.db.get('SELECT id FROM users WHERE email = ? AND id <> ?', email, row.id)) return sendError(reply, { code: 'CONFLICT', message: serverMessages.emailTaken, retryable: false });
    deps.db.run('UPDATE users SET email = ? WHERE id = ?', email, row.id);
    auditAccount(deps, row.id, 'changeEmail');
    // 乗っ取りに気づけるよう、変更前のアドレスへ知らせる。
    await deps.mailer.send({ to: row.email, subject: serverMessages.emailChangedSubject, text: serverMessages.emailChangedBody });
    return profileOf(deps, current(deps, request));
  });
  app.delete('/v1/account', { config: declare('deleteAccount', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    const result = deps.db.transaction(() => {
      const member = deps.db.get<{ household_id: string; membership_id: string }>('SELECT household_id, membership_id FROM household_members WHERE user_id = ?', row.id);
      if (member) {
        const loaded = loadAggregate(deps.db, member.household_id, member.membership_id, { privacy: { defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } });
        const { memberships } = loaded.aggregate.state;
        const self = memberships.find((item) => item.id === member.membership_id);
        const others = memberships.filter((item) => item.id !== member.membership_id && item.status === 'active');
        if (self?.role === 'owner' && others.length > 0) return { ok: false as const, error: { code: 'CONFLICT' as const, message: serverMessages.ownerHandover, retryable: false, reason: 'OWNER_REQUIRED' as const } };
        if (self) { self.displayName = serverMessages.deletedMember; self.status = 'suspended'; self.version += 1; }
        saveAggregate(deps.db, member.household_id, member.membership_id, loaded);
        deps.db.run('DELETE FROM household_members WHERE user_id = ?', row.id);
      }
      deps.db.run("UPDATE users SET email = ?, display_name = ?, password_hash = NULL, totp_secret = NULL, totp_enabled_at = NULL, avatar = NULL, birthdate = NULL, deleted_at = ? WHERE id = ?", `deleted+${row.id}@invalid.invalid`, serverMessages.deletedMember, deps.clock.now(), row.id);
      deps.db.run('DELETE FROM passkeys WHERE user_id = ?', row.id);
      deps.db.run('DELETE FROM recovery_codes WHERE user_id = ?', row.id);
      deps.db.run('DELETE FROM assistant_jobs WHERE user_id = ?', row.id);
      deps.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', deps.clock.now(), row.id);
      auditAccount(deps, row.id, 'deleteAccount');
      return ok(undefined);
    });
    if (result.ok) clearSessionCookie(reply, deps.config);
    return respondResult(reply, result);
  });

  app.post('/v1/account/totp', { config: declare('beginTotpEnrollment', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    if (row.totp_enabled_at) return sendError(reply, { code: 'CONFLICT', message: serverMessages.alreadySet, retryable: false });
    const secret = randomBytes(20);
    deps.db.run('UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?', sealTotpSecret(deps.config.keys, row.id, secret), row.id);
    return { otpauthUri: totpUri(row.email, secret) };
  });
  app.post('/v1/account/totp/confirm', { config: declare('confirmTotpEnrollment', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    const { code } = parse(z.object({ code: z.string().max(20) }), request.body);
    limit(deps, `totp:${row.id}`, 10, 900_000);
    if (!row.totp_secret || row.totp_enabled_at || !verifySecondFactor(deps, row, code)) return sendError(reply, { code: 'INVALID_INPUT', message: serverMessages.totpInvalid, retryable: false });
    const codes = newRecoveryCodes();
    deps.db.transaction(() => {
      deps.db.run('UPDATE users SET totp_enabled_at = ? WHERE id = ?', deps.clock.now(), row.id);
      deps.db.run('DELETE FROM recovery_codes WHERE user_id = ?', row.id);
      for (const value of codes) deps.db.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', row.id, hashRecoveryCode(value));
      auditAccount(deps, row.id, 'confirmTotpEnrollment');
    });
    return { recoveryCodes: codes };
  });
  app.delete('/v1/account/totp', { config: declare('disableTotp', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    deps.db.transaction(() => {
      deps.db.run('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', row.id);
      deps.db.run('DELETE FROM recovery_codes WHERE user_id = ?', row.id);
      auditAccount(deps, row.id, 'disableTotp');
    });
    return reply.code(204).send();
  });

  app.post('/v1/households', { config: declare('createHousehold') }, (request, reply) => {
    const row = current(deps, request);
    const { name } = parse(householdProfileSchema, request.body);
    if (request.actor) return sendError(reply, { code: 'CONFLICT', message: serverMessages.householdExists, retryable: false });
    if (!row.adult_declared_at) return sendError(reply, { code: 'FORBIDDEN', message: serverMessages.adultRequired, retryable: false });
    const householdId = deps.ids.next('household');
    const membershipId = deps.ids.next('member');
    const now = deps.clock.now();
    const membership: HouseholdMembership = { id: membershipId, householdId, userId: row.id, displayName: row.display_name, role: 'owner', status: 'active', color: '#315c80', version: 1 };
    deps.db.transaction(() => {
      deps.db.run('INSERT INTO household_members (user_id, household_id, membership_id) VALUES (?, ?, ?)', row.id, householdId, membershipId);
      deps.db.run("INSERT INTO entitlements (household_id, status, ends_at, updated_at) VALUES (?, 'trial', ?, ?)", householdId, new Date(Date.parse(now) + 14 * 86_400_000).toISOString(), now);
      const loaded = loadAggregate(deps.db, householdId, membershipId, { privacy: { defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } });
      loaded.aggregate.state.household = { id: householdId, name, timezone: 'Asia/Tokyo' };
      loaded.aggregate.state.context.asOf = now;
      loaded.aggregate.state.memberships.push(membership);
      saveAggregate(deps.db, householdId, membershipId, loaded);
      auditAccount(deps, row.id, 'createHousehold', { householdId });
    });
    return reply.code(201).send({ householdId });
  });
}
