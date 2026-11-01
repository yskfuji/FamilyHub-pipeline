import { randomBytes, randomInt, createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverMessages } from '../../../src/content/serverMessages';
import { accountUpdateSchema, ADULT_AGE, ageOn, signUpSchema } from '../../../src/domain/account';
import { householdProfileSchema, passwordSchema } from '../../../src/domain/schemas';
import type { HouseholdMembership, Result } from '../../../src/domain/types';
import { ok } from '../../../src/domain/commands/context';
import { loadAggregate, saveAggregate } from '../../db/aggregateStore';
import { hashPassword, verifyPassword } from '../../auth/password';
import { decryptSecret, encryptSecret, hashRecoveryCode, matchingStep, newRecoveryCodes, totpUri } from '../../auth/totp';
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
const accountColumns = 'id, email, display_name, password_hash, birthdate, adult_declared_at, avatar, idle_timeout_minutes, totp_secret, totp_enabled_at, totp_last_step';

const today = (deps: AppDeps) => deps.clock.now().slice(0, 10);
const audit = (deps: AppDeps, userId: string, action: string) => deps.db.run('INSERT INTO audit_events (id, actor_user_id, action, at) VALUES (?, ?, ?, ?)', deps.ids.next('audit'), userId, action, deps.clock.now());
const clientKey = (request: FastifyRequest) => request.ip;
const secretHash = (deps: AppDeps, value: string) => createHmac('sha256', deps.config.secret).update(`reset:${value}`).digest('base64url');

function current(deps: AppDeps, request: FastifyRequest) {
  if (!request.session) throw unauthenticated();
  const row = deps.db.get<AccountRow>(`SELECT ${accountColumns} FROM users WHERE id = ? AND deleted_at IS NULL`, request.session.user_id);
  if (!row) throw unauthenticated();
  return row;
}

const profileOf = (row: AccountRow) => ({
  displayName: row.display_name, email: row.email, avatar: row.avatar ? JSON.parse(row.avatar) as unknown : { kind: 'initial' as const },
  idleTimeoutMinutes: row.idle_timeout_minutes, birthdateDeclared: Boolean(row.birthdate), adultDeclared: Boolean(row.adult_declared_at), totpEnabled: Boolean(row.totp_enabled_at),
});

/** 秘密が保存されていて確認も済んだ利用者のコードを確かめ、一度使った時間枠を記録する。回復コードも受け付ける。 */
export function verifySecondFactor(deps: AppDeps, row: AccountRow | { id: string; totp_secret: string | null; totp_last_step: number | null }, code: string) {
  const normalized = code.trim();
  if (row.totp_secret && /^\d{6}$/.test(normalized)) {
    const step = matchingStep(decryptSecret(deps.config.secret, row.totp_secret), normalized, Date.parse(deps.clock.now()), row.totp_last_step);
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
    const age = ageOn(input.birthdate, today(deps));
    if (age < 0 || age > 130) return sendError(reply, { code: 'INVALID_INPUT', message: '誕生日を確認してください。', retryable: false });
    if (age < ADULT_AGE && !input.guardianConsent) return sendError(reply, { code: 'INVALID_INPUT', message: '18歳未満の方は、保護者の同意が必要です。', retryable: false });
    const hash = await hashPassword(input.password);
    const taken = deps.db.get('SELECT id FROM users WHERE email = ?', input.email);
    if (taken) return sendError(reply, { code: 'CONFLICT', message: serverMessages.emailTaken, retryable: false });
    const id = deps.ids.next('user');
    deps.db.run('INSERT INTO users (id, email, display_name, avatar_tone, password_hash, created_at, birthdate, adult_declared_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.email, input.displayName, 'indigo', hash, deps.clock.now(), input.birthdate, age >= ADULT_AGE ? deps.clock.now() : null);
    audit(deps, id, 'signUp');
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
    deps.db.run('INSERT INTO password_resets (id, user_id, token_hash, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', deps.ids.next('reset'), user.id, secretHash(deps, token), secretHash(deps, `${user.id}:${code}`), deps.clock.now(), new Date(now + RESET_TTL_MS).toISOString());
    await deps.mailer.send({ to: user.email, subject: serverMessages.resetSubject, text: serverMessages.resetBody(code, `${deps.config.origin}/reset-password#token=${token}`) });
    return reply.code(202).send({ resendAfterSeconds: 60 });
  });

  app.post('/v1/auth/password-reset/confirm', { config: anonymous('confirmPasswordReset') }, async (request, reply) => {
    const body = parse(z.object({ email: z.string().max(254).optional(), code: z.string().max(10).optional(), token: z.string().max(100).optional(), newPassword: z.string().max(200) }), request.body);
    const rejected = { code: 'UNAUTHENTICATED' as const, message: serverMessages.resetInvalid, retryable: false };
    limit(deps, `reset-confirm:${clientKey(request)}`, 20, 3_600_000);
    const parsed = passwordSchema.safeParse(body.newPassword);
    if (!parsed.success) return sendError(reply, { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? serverMessages.invalidInput, retryable: false });
    interface ResetRow { id: string; user_id: string; code_hash: string; attempts: number; expires_at: string; used_at: string | null }
    const columns = 'id, user_id, code_hash, attempts, expires_at, used_at';
    let row: ResetRow | undefined;
    if (body.token) row = deps.db.get<ResetRow>(`SELECT ${columns} FROM password_resets WHERE token_hash = ?`, secretHash(deps, body.token));
    else if (body.email && body.code) {
      const user = deps.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', body.email.trim());
      row = user ? deps.db.get<ResetRow>(`SELECT ${columns} FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, user.id) : undefined;
      if (row && row.code_hash !== secretHash(deps, `${row.user_id}:${body.code}`)) {
        deps.db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', row.id);
        return sendError(reply, rejected);
      }
    }
    if (!row || row.used_at || row.attempts >= MAX_RESET_ATTEMPTS || Date.parse(row.expires_at) <= Date.parse(deps.clock.now())) return sendError(reply, rejected);
    const hashed = await hashPassword(parsed.data);
    const { id, user_id: userId } = row;
    deps.db.transaction(() => {
      deps.db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', deps.clock.now(), id);
      deps.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashed, userId);
      // 再設定の後は自動でサインインせず、すべての端末をサインアウトする。
      deps.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', deps.clock.now(), userId);
      audit(deps, userId, 'confirmPasswordReset');
    });
    return reply.code(204).send();
  });

  app.post('/v1/auth/reauthenticate', { config: declare('reauthenticate') }, async (request, reply) => {
    const row = current(deps, request);
    limit(deps, `reauth:${row.id}`, 10, 900_000);
    const { password } = parse(z.object({ password: z.string().max(200) }), request.body);
    if (!(await verifyPassword(password, row.password_hash))) return sendError(reply, { code: 'UNAUTHENTICATED', message: serverMessages.passwordWrong, retryable: false, reason: 'REAUTH_FAILED' });
    deps.db.run('UPDATE sessions SET reauthenticated_at = ? WHERE id = ?', deps.clock.now(), request.session?.id ?? '');
    return reply.code(204).send();
  });

  app.get('/v1/account', { config: declare('getAccount', { csrf: false }) }, (request) => profileOf(current(deps, request)));
  app.patch('/v1/account', { config: declare('updateAccount') }, (request, reply) => {
    const row = current(deps, request);
    const input = parse(accountUpdateSchema, request.body);
    if (input.birthdate && row.birthdate) return sendError(reply, { code: 'CONFLICT', message: '誕生日は一度だけ申告できます。', retryable: false });
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
      audit(deps, row.id, 'updateAccount');
    });
    return profileOf(current(deps, request));
  });
  app.post('/v1/account/email', { config: declare('changeEmail', { recentAuth: true }) }, async (request, reply) => {
    const row = current(deps, request);
    const { email } = parse(z.object({ email: z.email('メールアドレスを確認してください。').max(254) }), request.body);
    if (deps.db.get('SELECT id FROM users WHERE email = ? AND id <> ?', email, row.id)) return sendError(reply, { code: 'CONFLICT', message: serverMessages.emailTaken, retryable: false });
    deps.db.run('UPDATE users SET email = ? WHERE id = ?', email, row.id);
    audit(deps, row.id, 'changeEmail');
    // 乗っ取りに気づけるよう、変更前のアドレスへ知らせる。
    await deps.mailer.send({ to: row.email, subject: serverMessages.emailChangedSubject, text: serverMessages.emailChangedBody });
    return profileOf(current(deps, request));
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
        if (self) { self.displayName = '退会したメンバー'; self.status = 'suspended'; self.version += 1; }
        saveAggregate(deps.db, member.household_id, member.membership_id, loaded);
        deps.db.run('DELETE FROM household_members WHERE user_id = ?', row.id);
      }
      deps.db.run("UPDATE users SET email = ?, display_name = '退会したメンバー', password_hash = NULL, totp_secret = NULL, totp_enabled_at = NULL, avatar = NULL, birthdate = NULL, deleted_at = ? WHERE id = ?", `deleted+${row.id}@invalid.invalid`, deps.clock.now(), row.id);
      deps.db.run('DELETE FROM passkeys WHERE user_id = ?', row.id);
      deps.db.run('DELETE FROM recovery_codes WHERE user_id = ?', row.id);
      deps.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', deps.clock.now(), row.id);
      audit(deps, row.id, 'deleteAccount');
      return ok(undefined);
    });
    if (result.ok) clearSessionCookie(reply, deps.config);
    return respondResult(reply, result);
  });

  app.post('/v1/account/totp', { config: declare('beginTotpEnrollment', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    if (row.totp_enabled_at) return sendError(reply, { code: 'CONFLICT', message: 'すでに設定されています。', retryable: false });
    const secret = randomBytes(20);
    deps.db.run('UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?', encryptSecret(deps.config.secret, secret), row.id);
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
      audit(deps, row.id, 'enableTotp');
    });
    return { recoveryCodes: codes };
  });
  app.delete('/v1/account/totp', { config: declare('disableTotp', { recentAuth: true }) }, (request, reply) => {
    const row = current(deps, request);
    deps.db.transaction(() => {
      deps.db.run('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', row.id);
      deps.db.run('DELETE FROM recovery_codes WHERE user_id = ?', row.id);
      audit(deps, row.id, 'disableTotp');
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
      audit(deps, row.id, 'createHousehold');
    });
    return reply.code(201).send({ householdId });
  });
}
