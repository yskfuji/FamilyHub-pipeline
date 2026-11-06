import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { serverMessages } from '../../src/content/serverMessages';
import { auditFieldsFor } from '../../src/domain/auditLog';
import { createHouseholdRules } from '../../src/domain/commands';
import type { HouseholdAggregate } from '../../src/domain/commands';
import type { GatewayError, Id, NotificationPreferences, PrivacySettings, Result, User } from '../../src/domain/types';
import { loadAggregate, saveAggregate } from '../db/aggregateStore';
import type { LoadedAggregate, LoadOptions } from '../db/aggregateStore';
import { ApiError, requireActor, sendError } from './context';
import type { AppDeps } from './context';

const defaults: { privacy: PrivacySettings; notificationPreferences: NotificationPreferences } = {
  privacy: { defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null },
  notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true },
};

interface UserRow { id: string; email: string; display_name: string; avatar_tone: User['avatarTone'] }

export type Rules = ReturnType<typeof createHouseholdRules>;

function rulesFor(deps: AppDeps, aggregate: HouseholdAggregate, membershipId: Id, userId: Id): Rules {
  return createHouseholdRules(aggregate, {
    actorMembershipId: membershipId,
    now: deps.clock.now,
    nextId: deps.ids.next,
    newInviteToken: deps.ids.inviteToken,
    isAdultDeclared: (id) => Boolean(deps.db.get<{ adult_declared_at: string | null }>('SELECT adult_declared_at FROM users WHERE id = ? AND deleted_at IS NULL', id)?.adult_declared_at),
    describeUser: () => {
      const row = deps.db.get<UserRow>('SELECT id, email, display_name, avatar_tone FROM users WHERE id = ?', userId);
      if (!row) throw new Error('user not found');
      return { id: row.id, displayName: row.display_name, email: row.email, avatarTone: row.avatar_tone };
    },
  });
}

export interface WorkContext {
  rules: Rules;
  loaded: LoadedAggregate;
  /** 監査の記録の detail に、変えた項目の名前だけを残す（値は残さない）。例: ["kind"]。 */
  auditFields(fields: readonly string[]): void;
}

/** 監査の detail。変えた項目の名前だけで、値は入れない。 */
const auditDetail = (fields: readonly string[] | null) => fields && fields.length ? JSON.stringify({ fields }) : null;

/** 読み取り。保存しない。 */
export function read<T>(deps: AppDeps, request: FastifyRequest, reply: FastifyReply, work: (rules: Rules) => Result<T>, options?: LoadOptions) {
  const actor = requireActor(request);
  const loaded = loadAggregate(deps.db, actor.householdId, actor.membershipId, defaults, options);
  return respond(reply, work(rulesFor(deps, loaded.aggregate, actor.membershipId, actor.userId)));
}

function respond<T>(reply: FastifyReply, result: Result<T>, status = 200) {
  if (!result.ok) return sendError(reply, result.error);
  if (result.value === undefined) return reply.code(204).send();
  return reply.code(status).type('application/json').send(result.value);
}

const requestHash = (request: FastifyRequest) => createHash('sha256').update(`${request.method}\u0000${request.url}\u0000${JSON.stringify(request.body ?? null)}`).digest('base64url');

interface StoredResponse { request_hash: string; status: number; body: string | null }

/**
 * 変更の操作。規則の実行・保存・監査・冪等の記録を1つのトランザクションで行う。
 * 規則が失敗を返したら、途中の変更は保存しない。
 */
/**
 * storedBody: 冪等の記録に残す応答の本文。秘密（招待コードなど）を含む応答は、ここで取り除いた形を残す。
 * 送り直しのときは取り除いた形が返る（コードを見られなかったときは、招待を出し直す）。
 */
export function mutate<T>(deps: AppDeps, request: FastifyRequest, reply: FastifyReply, work: (rules: Rules, context: WorkContext) => Result<T>, options?: LoadOptions, storedBody: (value: T) => unknown = (value) => value) {
  const actor = requireActor(request);
  const key = request.headers['idempotency-key'];
  const idempotencyKey = typeof key === 'string' ? key : undefined;
  const scope = actor.userId;
  const fingerprint = requestHash(request);
  const declaration = request.routeOptions.config.route;
  const outcome = deps.db.transaction<{ replay?: StoredResponse; result?: Result<T> }>(() => {
    if (idempotencyKey) {
      const stored = deps.db.get<StoredResponse>('SELECT request_hash, status, body FROM idempotency_records WHERE scope = ? AND key = ?', scope, idempotencyKey);
      if (stored) {
        if (stored.request_hash !== fingerprint) throw new ApiError(409, { code: 'CONFLICT', message: serverMessages.idempotencyReused, retryable: false, reason: 'IDEMPOTENCY' } satisfies GatewayError);
        return { replay: stored };
      }
    }
    const loaded = loadAggregate(deps.db, actor.householdId, actor.membershipId, defaults, options);
    const rules = rulesFor(deps, loaded.aggregate, actor.membershipId, actor.userId);
    let fields: string[] | null = null;
    const result = work(rules, { rules, loaded, auditFields: (names) => { fields = [...new Set(names)].sort(); } });
    if (!result.ok) return { result };
    saveAggregate(deps.db, actor.householdId, actor.membershipId, loaded, options);
    deps.audit.record({
      id: deps.ids.next('audit'), at: deps.clock.now(), householdId: actor.householdId, actorUserId: actor.userId,
      action: declaration?.operationId ?? request.url, target: targetOf(request, declaration?.successStatus === 201 ? result.value : undefined),
      detail: auditDetail(fields ?? auditFieldsFor(declaration?.operationId ?? '', (request.body as { input?: unknown } | null)?.input)),
    });
    if (idempotencyKey) deps.db.run('INSERT INTO idempotency_records (scope, key, request_hash, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', scope, idempotencyKey, fingerprint, result.value === undefined ? 204 : declaration?.successStatus ?? 200, result.value === undefined ? null : JSON.stringify(storedBody(result.value)), deps.clock.now());
    return { result };
  }, (value) => Boolean(value.replay || value.result?.ok));
  if (outcome.replay) {
    reply.header('Idempotency-Replayed', 'true');
    if (outcome.replay.status === 204) return reply.code(204).send();
    return reply.code(outcome.replay.status).type('application/json').send(outcome.replay.body);
  }
  return respond(reply, outcome.result as Result<T>, declaration?.successStatus);
}

/**
 * 監査の記録には本文を残さず、どの記録に対する操作かだけを残す。経路の ID（例: 支出/精算）を並べ、
 * 経路に ID のない作成の操作では、作った記録の ID を使う。
 */
const targetOf = (request: FastifyRequest, created?: unknown) => {
  const fromPath = Object.values((request.params ?? {}) as Record<string, string>).join('/');
  if (fromPath) return fromPath;
  const id = (created as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : null;
};
