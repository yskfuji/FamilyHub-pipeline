import type { FamilyHubGateway } from './gateway';
import { baseInvites, baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, baseSnapshot } from './fixtures';
import { passwordSchema } from '../domain/schemas';
import { toJstRfc3339 } from '../domain/calendarDate';
import { createHouseholdRules } from '../domain/commands';
import type { HouseholdAggregate } from '../domain/commands';
import { fail, missing, ok } from '../domain/commands/context';
import type { Authenticator, GatewayError, HouseholdSnapshot, Id, Result, Scenario, SecurityOverview } from '../domain/types';

const delay = (ms = 90) => new Promise((resolve) => setTimeout(resolve, ms));

/** 確認用の実装は規則をそのまま呼び、通信の待ち時間だけを足す。 */
const delayed = <T extends object>(port: T): { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never } =>
  Object.fromEntries(Object.entries(port).map(([key, method]) => [key, async (...args: unknown[]) => { await delay(); return (method as (...values: unknown[]) => unknown)(...args); }])) as never;

const scenarioError = (scenario?: Scenario): GatewayError | null => {
  if (scenario === 'offline') return { code: 'OFFLINE', message: 'インターネットに接続できません。最後に取得した内容を表示しています。', retryable: true };
  if (scenario === 'conflict') return { code: 'CONFLICT', message: 'ほかの端末で内容が変更されました。最新の内容を確認してください。', retryable: true };
  if (scenario === 'expired-invite') return { code: 'UNAUTHENTICATED', message: '招待の有効期限が切れています。新しい招待を依頼してください。', retryable: false };
  if (scenario === 'expired-session') return { code: 'UNAUTHENTICATED', message: 'サインインの有効期限が切れました。もう一度サインインしてください。', retryable: false };
  return null;
};

export function initialAggregate(): HouseholdAggregate {
  return {
    state: structuredClone(baseSnapshot),
    permissionOverrides: [],
    permissionRevision: 1,
    invites: structuredClone(baseInvites),
    notifications: structuredClone(baseNotifications),
    notificationPreferences: structuredClone(baseNotificationPreferences),
    privacy: structuredClone(basePrivacySettings),
    archives: { events: {}, todos: {}, memos: {}, expenses: {} },
  };
}

export function createMockGateway(actorMembershipId: Id = 'member-aoi'): FamilyHubGateway {
  const aggregate = initialAggregate();
  const security: SecurityOverview = structuredClone(baseSecurityOverview);
  let offline = false;
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-mock-${++sequence}`;
  // 確認用データの時計。操作のたびに1分進め、記録の前後関係（履歴の並び）を再現できるようにする。
  let clockTick = 0;
  const now = () => toJstRfc3339(new Date(Date.parse('2026-09-30T07:45:00+09:00') + (clockTick++) * 60_000));
  const rules = createHouseholdRules(aggregate, {
    actorMembershipId, now, nextId,
    newInviteToken: () => `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME`,
    connectionLost: () => offline,
    describeUser: (member, base) => ({ ...base, email: `${member.userId}@example.test` }),
  });
  const { project, requireCapability } = rules.context;
  const { state } = aggregate;
  let passkeyChallenge: string | null = null;

  return {
    auth: {
      async beginPasskey() { await delay(); passkeyChallenge = nextId('passkey-challenge'); return ok({ challengeId: passkeyChallenge, publicKey: null }); },
      async finishPasskey(challengeId, assertion) {
        await delay();
        // 確認用データでは端末の本人確認を模擬する。実際の検証（署名・origin・RP ID）は API 側の責務。
        if (!passkeyChallenge || challengeId !== passkeyChallenge || !assertion) return fail({ code: 'UNAUTHENTICATED', message: 'パスキーで本人確認できませんでした。もう一度お試しください。', retryable: true });
        passkeyChallenge = null;
        return ok({ userId: state.user.id });
      },
      async signInWithPassword(email, password) {
        await delay();
        if (!email.includes('@') || password.length < 15) return fail({ code: 'INVALID_INPUT', message: '入力内容を確認してください。', retryable: false });
        return ok({ userId: state.user.id });
      },
      async signOut() { await delay(); return ok(undefined); },
      async getSession() { await delay(10); return ok({ stage: 'active' as const, userId: state.user.id, idleTimeoutMinutes: 30 }); },
      async getSecurityOverview() { await delay(); const guard = requireCapability<SecurityOverview>('settings.own'); return guard ?? ok(structuredClone(security)); },
      async beginPasskeyRegistration() { await delay(); const guard = requireCapability<{ challengeId: Id; publicKey: null }>('settings.own'); return guard ?? ok({ challengeId: nextId('challenge'), publicKey: null }); },
      async finishPasskeyRegistration(challengeId, credential) {
        await delay();
        const guard = requireCapability<Authenticator>('settings.own'); if (guard) return guard;
        if (!challengeId || !credential) return fail({ code: 'INVALID_INPUT', message: 'パスキー登録を完了できませんでした。', retryable: true });
        const authenticator: Authenticator = { id: nextId('authenticator'), label: 'この端末（デモ）', createdAt: now(), kind: 'passkey', demo: true };
        security.authenticators.push(authenticator);
        return ok(structuredClone(authenticator));
      },
      async changePassword(currentPassword, newPassword) {
        await delay();
        const guard = requireCapability<void>('settings.own'); if (guard) return guard;
        if (!passwordSchema.safeParse(currentPassword).success) return fail({ code: 'UNAUTHENTICATED', message: '現在のパスワードを確認してください。', retryable: false });
        const parsed = passwordSchema.safeParse(newPassword);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false });
        return ok(undefined);
      },
      async revokeSession(sessionId) {
        await delay();
        const guard = requireCapability<void>('settings.own'); if (guard) return guard;
        const target = security.sessions.find((session) => session.id === sessionId);
        if (!target || target.current) return fail({ code: 'FORBIDDEN', message: 'この端末はここからサインアウトできません。', retryable: false });
        security.sessions.splice(security.sessions.indexOf(target), 1);
        return ok(undefined);
      },
    },
    household: {
      ...delayed(rules.household),
      async getSnapshot(scenario): Promise<Result<HouseholdSnapshot>> {
        await delay(scenario === 'loading' ? 700 : 80);
        offline = scenario === 'offline';
        const error = scenarioError(scenario);
        if (error) return fail(error);
        const snapshot = project();
        if (scenario === 'empty') {
          snapshot.events = []; snapshot.todos = []; snapshot.memos = []; snapshot.expenses = [];
        }
        if (scenario === 'quarantined') {
          snapshot.memos[0].attachments[0].status = 'quarantined';
          snapshot.memos[0].attachments[0].statusMessage = 'ファイルを確認しています。完了するまで開けません';
        }
        if (scenario === 'weather') snapshot.context.weather = { location: snapshot.context.weather.location, condition: 'storm', temperatureC: 20, precipitationPercent: 95, alert: '雷を伴う激しい雨のおそれ。屋外予定を確認してください' };
        return ok(snapshot);
      },
    },
    events: delayed(rules.events),
    todos: delayed(rules.todos),
    memos: {
      ...delayed(rules.memos),
      async uploadAttachment(memoId, file) {
        await delay(260);
        const accepted = rules.memos.acceptAttachment(memoId, { originalName: file.name, mimeType: file.type, byteSize: file.size });
        if (!accepted.ok) return accepted;
        // 確認用データでは、数秒後に確認が終わった状態へ進める（実際はウイルス検査などの結果を待つ）。
        setTimeout(() => rules.memos.finishAttachmentCheck(memoId, accepted.value.id, 'clean'), 3000);
        const memo = project().memos.find((item) => item.id === memoId);
        return memo ? ok(memo) : missing('メモ');
      },
      async getAttachmentLink(memoId, attachmentId) {
        await delay();
        const readable = rules.memos.readableAttachment(memoId, attachmentId);
        if (!readable.ok) return readable;
        return fail({ code: 'NOT_FOUND', message: 'この確認用データには原本のファイルが含まれていないため開けません。実際の環境では、確認済みのファイルを期限付きのリンクで開きます。', retryable: false });
      },
    },
    expenses: delayed(rules.expenses),
    resources: delayed(rules.resources),
    insights: delayed(rules.insights),
    notifications: delayed(rules.notifications),
    credentials: {
      async create() { await delay(); return ok({ id: nextId('mock-credential'), demo: true }); },
      // 確認用データでは端末の本人確認を模擬する（署名は作らない）。
      async get() { await delay(); return ok({ id: nextId('mock-assertion'), demo: true }); },
    },
  };
}
