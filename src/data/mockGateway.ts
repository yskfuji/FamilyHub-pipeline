import type { FamilyHubGateway } from './gateway';
import { auditedGatewayOperations } from './gatewayOperations';
import { baseAlbumItems, baseAlbums, baseInvites, baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, adultDeclaredUsers, sampleEventCandidates, sampleReceipt, seedAuditHistory, seededSnapshot, withCoOwner } from './fixtures';
import { serverMessages } from '../content/serverMessages';
import { sampleAttachmentUrls } from './sampleAttachments';
import { readingImageProblem, readingUrlProblem } from '../domain/assistant';
import type { AssistantJob, AssistantJobKind } from '../domain/assistant';
import { ADULT_AGE, accountUpdateSchema, ageOn, signUpSchema } from '../domain/account';
import { checkNewPassword } from '../domain/passwordPolicy';
import { currentPasswordSchema, passwordSchema } from '../domain/schemas';
import { toJstRfc3339 } from '../domain/calendarDate';
import { auditFieldsFor, matchesAuditFilter } from '../domain/auditLog';
import type { StoredAuditRow } from '../domain/auditLog';
import { createHouseholdRules } from '../domain/commands';
import { accountAuditRequest, presentAccountAudit } from '../domain/commands/audit';
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

/** 確認用の画面だけで使う見本の設定。同等性の試験は既定（どれもなし）で動かす。 */
export interface MockOptions {
  /** 管理者を2人にする（碧さんと蓮さん）。 */
  coOwner?: boolean;
  /** これまでの変更の記録の見本を入れておく。 */
  auditHistory?: boolean;
}

export function initialAggregate(options: MockOptions = {}): HouseholdAggregate {
  return {
    state: options.coOwner ? withCoOwner(seededSnapshot()) : seededSnapshot(),
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

export function createMockGateway(actorMembershipId: Id = 'member-aoi', options: MockOptions = {}): FamilyHubGateway {
  const aggregate = initialAggregate(options);
  const security: SecurityOverview = structuredClone(baseSecurityOverview);
  let offline = false;
  /** 「データなし」の見本を読んだあとは、アルバムの一覧も空にする（アルバムの空の状態の確認用）。 */
  let emptied = false;
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-mock-${++sequence}`;
  // 確認用データの時計。操作のたびに1分進め、記録の前後関係（履歴の並び）を再現できるようにする。
  let clockTick = 0;
  const timeAt = (tick: number) => toJstRfc3339(new Date(Date.parse('2026-09-30T07:45:00+09:00') + tick * 60_000));
  const now = () => timeAt(clockTick++);
  /** 時計を進めずに今の時刻を読む（変更の記録に使い、ほかの記録の時刻をずらさない）。 */
  const peek = () => timeAt(clockTick);
  /** 変更の記録。API と同じく、成功した変更の操作ごとに1行を残す（src/data/gatewayOperations.ts の対応表で決める）。 */
  const auditRows: StoredAuditRow[] = options.auditHistory ? seedAuditHistory.map((row, index) => ({ ...row, seq: index + 1, id: `audit-seed-${index + 1}` })) : [];
  const recordAudit = (key: string, args: readonly unknown[], value: unknown) => {
    const operation = auditedGatewayOperations[key];
    const actor = state.memberships.find((item) => item.id === actorMembershipId);
    if (!operation) return;
    const params = args.slice(0, operation.params).map(String);
    const created = operation.created ? (value as { id?: unknown } | undefined)?.id : undefined;
    const fields = operation.fieldsArg === undefined ? null : auditFieldsFor(operation.operationId, args[operation.fieldsArg]);
    auditRows.push({
      seq: auditRows.length + 1, id: `audit-mock-${auditRows.length + 1}`, at: peek(), household_id: operation.household ? state.household.id : null, actor_user_id: actor?.userId ?? null,
      action: operation.operationId, target: params.length ? params.join('/') : typeof created === 'string' ? created : null, detail: fields?.length ? JSON.stringify({ fields }) : null,
    });
  };
  /** 利用者ごとの成人の申告。見本の家族では、実際の環境の見本と同じく碧さんと蓮さんだけが申告している。 */
  const adultDeclarations = new Set<Id>(adultDeclaredUsers);
  const rules = createHouseholdRules(aggregate, {
    actorMembershipId, now, nextId,
    isAdultDeclared: (userId) => adultDeclarations.has(userId),
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
  const account: AccountProfile = { displayName: actorMember?.displayName ?? '', email: `${actorMember?.userId ?? ''}@example.test`, avatar: { kind: 'initial' }, idleTimeoutMinutes: 30, birthdateDeclared: true, adultDeclared: adultDeclarations.has(actorMember?.userId ?? ''), totpEnabled: false, totpUnavailable: false };

  const gateway: FamilyHubGateway = {
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
      async signUp(input) {
        await delay();
        const parsed = signUpSchema.safeParse(input);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '入力を確認してください。', retryable: false });
        const problem = await checkNewPassword(parsed.data.password, { email: parsed.data.email, displayName: parsed.data.displayName });
        return problem ? fail({ code: 'INVALID_INPUT', message: problem, retryable: false }) : ok({ userId: state.user.id });
      },
      async requestPasswordReset() { await delay(); return ok({ resendAfterSeconds: 60 }); },
      async confirmPasswordReset(input) {
        await delay();
        const parsed = passwordSchema.safeParse(input.newPassword);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false });
        const problem = await checkNewPassword(parsed.data, input.email ? { email: input.email } : undefined);
        return problem ? fail({ code: 'INVALID_INPUT', message: problem, retryable: false }) : ok(undefined);
      },
      async reauthenticate() { await delay(); return ok(undefined); },
      async getAccount() { await delay(); return ok(structuredClone(account)); },
      async updateAccount(input) {
        await delay();
        const parsed = accountUpdateSchema.safeParse(input);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '入力を確認してください。', retryable: false });
        const { birthdate, ...fields } = parsed.data;
        const member = state.memberships.find((item) => item.id === actorMembershipId);
        // 実際の環境と同じく、誕生日を申告したときに成人かどうかを記録し直す。
        if (birthdate && member) {
          if (ageOn(birthdate, now().slice(0, 10)) >= ADULT_AGE) adultDeclarations.add(member.userId); else adultDeclarations.delete(member.userId);
        }
        Object.assign(account, fields, birthdate ? { birthdateDeclared: true, adultDeclared: adultDeclarations.has(member?.userId ?? '') } : {});
        if (member && fields.displayName) member.displayName = fields.displayName;
        return ok(structuredClone(account));
      },
      async changeEmail(email) { await delay(); account.email = email; return ok(structuredClone(account)); },
      async deleteAccount() { await delay(); return fail({ code: 'CONFLICT', message: 'この確認用データではアカウントを削除できません。', retryable: false }); },
      async beginTotpEnrollment() { await delay(); return ok({ otpauthUri: 'otpauth://totp/demo?secret=DEMO' }); },
      async confirmTotpEnrollment() { await delay(); account.totpEnabled = true; return ok({ recoveryCodes: ['DEMO1-00000'] }); },
      async disableTotp() { await delay(); account.totpEnabled = false; account.totpUnavailable = false; return ok(undefined); },
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
        if (!currentPasswordSchema.safeParse(currentPassword).success) return fail({ code: 'UNAUTHENTICATED', message: '現在のパスワードを確認してください。', retryable: false });
        const parsed = passwordSchema.safeParse(newPassword);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false });
        const problem = await checkNewPassword(parsed.data, { email: account.email, displayName: account.displayName, householdName: state.household.name, memberNames: state.memberships.filter((member) => member.id !== actorMember?.id).map((member) => member.displayName) });
        return problem ? fail({ code: 'INVALID_INPUT', message: problem, retryable: false }) : ok(undefined);
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
        emptied = scenario === 'empty';
        const error = scenarioError(scenario);
        if (error) return fail(error);
        const snapshot = project();
        if (scenario === 'empty') {
          snapshot.events = []; snapshot.todos = []; snapshot.memos = []; snapshot.expenses = []; snapshot.settlementBatches = [];
        }
        if (scenario === 'all-done') {
          // 夜になって、今日の予定が終わり、タスクも全部済んだ日（「全部済んだ」の空の状態の確認用）。
          snapshot.todos = snapshot.todos.map((todo) => ({ ...todo, status: 'done' }));
          snapshot.context.asOf = '2026-09-30T21:30:00+09:00';
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
        // 原本の代わりに、同じ種類の見本のファイルを開く。開くと保存は同じ URL になる（見本は保存の指定を持たない）。
        const url = sampleAttachmentUrls[readable.value.mimeType];
        if (!url) return fail({ code: 'NOT_FOUND', message: 'この確認用データには、この種類の見本のファイルがないため開けません。実際の環境では、確認済みのファイルを期限付きのリンクで開きます。', retryable: false });
        return ok({ url, expiresAt: toJstRfc3339(new Date(Date.parse(peek()) + 5 * 60_000)) });
      },
    },
    expenses: delayed(rules.expenses),
    family: delayed(rules.family),
    links: delayed(rules.links),
    trash: delayed(rules.trash),
    albums: {
      ...delayed(rules.albums),
      async listAlbums() { await delay(); return emptied ? ok([]) : rules.albums.listAlbums(); },
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
    audit: {
      async list(query = {}) {
        await delay();
        const request = rules.audit.request(query);
        if (!request.ok) return request;
        const { filter, cursor, limit } = request.value;
        const rows = auditRows.filter((row) => row.household_id === state.household.id && (cursor === undefined || row.seq < cursor) && matchesAuditFilter(row, filter)).sort((a, b) => b.seq - a.seq).slice(0, limit + 1);
        return rules.audit.present(rows, limit, { state: 'ok', checkedAt: peek() });
      },
      async listMine(query = {}) {
        await delay();
        const request = accountAuditRequest(query);
        if (!request.ok) return request;
        const userId = state.memberships.find((item) => item.id === actorMembershipId)?.userId;
        const { cursor, limit } = request.value;
        const rows = auditRows.filter((row) => row.household_id === null && row.actor_user_id === userId && (cursor === undefined || row.seq < cursor)).sort((a, b) => b.seq - a.seq).slice(0, limit + 1);
        return ok(presentAccountAudit(rows, limit));
      },
    },
  };
  // 対応表にある操作は、成功したときに変更の記録を残す。
  for (const [portName, port] of Object.entries(gateway) as Array<[string, Record<string, unknown>]>) {
    for (const [method, implementation] of Object.entries(port)) {
      const key = `${portName}.${method}`;
      if (!auditedGatewayOperations[key] || typeof implementation !== 'function') continue;
      port[method] = async (...args: unknown[]) => {
        const result = await (implementation as (...values: unknown[]) => Promise<Result<unknown>>)(...args);
        if (result.ok) recordAudit(key, args, result.value);
        return result;
      };
    }
  }
  // 冪等キーを受け取る操作は、API と同じく、同じキーと同じ内容なら前の結果を返し（記録は増やさない）、内容が違えば断る。
  const replays = new Map<string, { fingerprint: string; result: Result<unknown> }>();
  const idempotent = <A extends unknown[], R>(name: string, method: (...args: A) => Promise<Result<R>>, keyOf: (...args: A) => string | undefined) => async (...args: A): Promise<Result<R>> => {
    const key = keyOf(...args);
    if (!key) return method(...args);
    const fingerprint = JSON.stringify([name, ...args]);
    const stored = replays.get(key);
    if (stored) {
      await delay();
      return stored.fingerprint === fingerprint ? structuredClone(stored.result) as Result<R> : fail({ code: 'CONFLICT', message: serverMessages.idempotencyReused, retryable: false, reason: 'IDEMPOTENCY' });
    }
    const result = await method(...args);
    if (result.ok) replays.set(key, { fingerprint, result: structuredClone(result) });
    return result;
  };
  // 作成の操作も、フォームごとの1つの冪等キーを受け取る（段階12。二度押しや応答の失われた送り直しで記録を増やさない）。
  gateway.events.createEvent = idempotent('createEvent', gateway.events.createEvent, (_input, context) => context?.idempotencyKey);
  gateway.todos.createTodo = idempotent('createTodo', gateway.todos.createTodo, (_input, context) => context?.idempotencyKey);
  gateway.memos.createMemo = idempotent('createMemo', gateway.memos.createMemo, (_input, context) => context?.idempotencyKey);
  gateway.expenses.createExpense = idempotent('createExpense', gateway.expenses.createExpense, (_input, key) => key);
  gateway.expenses.settleAll = idempotent('settleAll', gateway.expenses.settleAll, (_input, key) => key);
  gateway.expenses.reverseBatch = idempotent('reverseBatch', gateway.expenses.reverseBatch, (_batchId, key) => key);
  return gateway;
}
