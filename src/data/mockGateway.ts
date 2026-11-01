import type { FamilyHubGateway } from './gateway';
import { baseAlbumItems, baseAlbums, baseInvites, baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, baseSnapshot, sampleEventCandidates, sampleReceipt } from './fixtures';
import { serverMessages } from '../content/serverMessages';
import { readingImageProblem, readingUrlProblem } from '../domain/assistant';
import type { AssistantJob, AssistantJobKind } from '../domain/assistant';
import { accountUpdateSchema, signUpSchema } from '../domain/account';
import { passwordSchema } from '../domain/schemas';
import { toJstRfc3339 } from '../domain/calendarDate';
import { createHouseholdRules } from '../domain/commands';
import type { HouseholdAggregate } from '../domain/commands';
import { fail, missing, ok } from '../domain/commands/context';
import type { AccountProfile, Authenticator, GatewayError, HouseholdSnapshot, Id, Result, Scenario, SecurityOverview } from '../domain/types';

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
    albums: structuredClone(baseAlbums),
    albumItems: structuredClone(baseAlbumItems),
    occurrenceDeletions: [],
  };
}

/** 見本の写真の代わりに表示する画像。 */
function sampleImage(id: string) {
  const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 45% 70%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 40% 45%)"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="500" cy="120" r="56" fill="hsl(45 90% 80%)"/><path d="M0 400 200 240l140 110 110-70 190 120v80H0z" fill="hsl(${(hue + 120) % 360} 30% 35%)"/></svg>`)}`;
}

const imageMarks: ReadonlyArray<readonly number[]> = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47]];

/** ファイルの先頭で画像かどうかを見る。実際の環境と同じ理由で断る。 */
async function imageRejection(file: File): Promise<GatewayError | null> {
  const problem = readingImageProblem(file);
  if (problem) return { code: 'ATTACHMENT_REJECTED', message: problem, retryable: false };
  const head = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsArrayBuffer(file.slice(0, 8));
  }));
  return imageMarks.some((mark) => mark.every((value, index) => head[index] === value)) ? null : { code: 'ATTACHMENT_REJECTED', message: serverMessages.fileTypeRejected, retryable: false };
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
  const mediaUrls = new Map<Id, string>();
  /** 読み取りの代わりの仕事。結果は見本で、読み取られた内容ではない。 */
  const readings = new Map<Id, AssistantJob>();
  const startReading = (kind: AssistantJobKind): Result<AssistantJob> => {
    const allowed = rules.assistant.authorize(kind);
    if (!allowed.ok) return allowed;
    if ([...readings.values()].some((job) => job.status === 'running')) return fail({ code: 'RATE_LIMITED', message: serverMessages.readingBusy, retryable: true });
    const job: AssistantJob = { id: nextId('reading'), kind, status: 'running', sample: true };
    readings.set(job.id, job);
    setTimeout(() => Object.assign(job, { status: 'done' }, kind === 'receipt' ? { receipt: structuredClone(sampleReceipt) } : { events: structuredClone(sampleEventCandidates) }), 300);
    return ok(structuredClone(job));
  };
  const thumbnailUrls = new Map<Id, string>();
  const actorMember = state.memberships.find((item) => item.id === actorMembershipId);
  const account: AccountProfile = { displayName: actorMember?.displayName ?? '', email: `${actorMember?.userId ?? ''}@example.test`, avatar: { kind: 'initial' }, idleTimeoutMinutes: 30, birthdateDeclared: true, adultDeclared: actorMember?.role === 'owner' || actorMember?.role === 'adult', totpEnabled: false };

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
      // 確認用データにはサインインの記録がないので、形だけを返す。実際の検証は API が行う。
      async verifyTotp() { await delay(); return ok({ userId: state.user.id }); },
      async signUp(input) { await delay(); const parsed = signUpSchema.safeParse(input); return parsed.success ? ok({ userId: state.user.id }) : fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '入力を確認してください。', retryable: false }); },
      async requestPasswordReset() { await delay(); return ok({ resendAfterSeconds: 60 }); },
      async confirmPasswordReset(input) { await delay(); const parsed = passwordSchema.safeParse(input.newPassword); return parsed.success ? ok(undefined) : fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false }); },
      async reauthenticate() { await delay(); return ok(undefined); },
      async getAccount() { await delay(); return ok(structuredClone(account)); },
      async updateAccount(input) {
        await delay();
        const parsed = accountUpdateSchema.safeParse(input);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '入力を確認してください。', retryable: false });
        const { birthdate, ...fields } = parsed.data;
        Object.assign(account, fields, birthdate ? { birthdateDeclared: true } : {});
        const member = state.memberships.find((item) => item.id === actorMembershipId);
        if (member && fields.displayName) member.displayName = fields.displayName;
        return ok(structuredClone(account));
      },
      async changeEmail(email) { await delay(); account.email = email; return ok(structuredClone(account)); },
      async deleteAccount() { await delay(); return fail({ code: 'CONFLICT', message: 'この確認用データではアカウントを削除できません。', retryable: false }); },
      async beginTotpEnrollment() { await delay(); return ok({ otpauthUri: 'otpauth://totp/demo?secret=DEMO' }); },
      async confirmTotpEnrollment() { await delay(); account.totpEnabled = true; return ok({ recoveryCodes: ['DEMO1-00000'] }); },
      async disableTotp() { await delay(); account.totpEnabled = false; return ok(undefined); },
      async getSession() { await delay(10); return ok({ stage: 'active' as const, userId: state.user.id, idleTimeoutMinutes: 30 }); },
      async getVersion() { await delay(10); return ok({ build: 'development' }); },
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
      async createHousehold() { await delay(); return ok({ householdId: state.household.id }); },
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
    family: delayed(rules.family),
    links: delayed(rules.links),
    trash: delayed(rules.trash),
    albums: {
      ...delayed(rules.albums),
      async uploadItem(albumId, file, options) {
        await delay(120);
        const reserved = rules.albums.reserveItem(albumId, { kind: file.type.startsWith('video/') ? 'video' : 'photo', originalName: file.name, mimeType: file.type, byteSize: file.size, keepLocation: options.keepLocation });
        if (!reserved.ok) return reserved;
        options.onReserved?.();
        options.onProgress?.(file.size, file.size);
        const item = aggregate.albumItems.find((entry) => entry.id === reserved.value.id);
        if (item) {
          const isVideo = item.kind === 'video';
          Object.assign(item, { status: 'ready', hasThumbnail: !isVideo || Boolean(options.thumbnail) });
          mediaUrls.set(item.id, URL.createObjectURL(file));
          if (isVideo && options.thumbnail) thumbnailUrls.set(item.id, URL.createObjectURL(options.thumbnail));
        }
        return ok({ itemId: reserved.value.id });
      },
      async cancelUpload() { return ok(undefined); },
      mediaUrl: (item, variant) => (variant === 'thumbnail' ? thumbnailUrls.get(item.id) : undefined) ?? mediaUrls.get(item.id) ?? sampleImage(item.id),
    },
    resources: delayed(rules.resources),
    insights: delayed(rules.insights),
    assistant: {
      async getStatus() { await delay(20); const status = rules.assistant.status(true); return status.ok ? ok({ ...status.value, sample: true }) : status; },
      async readReceipt(file) { await delay(); const rejected = await imageRejection(file); return rejected ? fail(rejected) : startReading('receipt'); },
      async readEventImage(file) { await delay(); const rejected = await imageRejection(file); return rejected ? fail(rejected) : startReading('event'); },
      async readEventUrl(url) {
        await delay();
        const problem = readingUrlProblem(url);
        return problem ? fail({ code: 'INVALID_INPUT', message: problem, retryable: false }) : startReading('event');
      },
      async getJob(id) {
        await delay();
        const job = readings.get(id);
        return job ? ok(structuredClone(job)) : fail({ code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
      },
    },
    notifications: delayed(rules.notifications),
    credentials: {
      async create() { await delay(); return ok({ id: nextId('mock-credential'), demo: true }); },
      // 確認用データでは端末の本人確認を模擬する（署名は作らない）。
      async get() { await delay(); return ok({ id: nextId('mock-assertion'), demo: true }); },
    },
  };
}
