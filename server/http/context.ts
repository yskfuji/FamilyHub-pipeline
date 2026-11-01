import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config';
import type { Db } from '../db/db';
import type { SessionRow } from '../auth/sessions';
import { serverMessages } from '../../src/content/serverMessages';
import type { GatewayError, Id, Rfc3339 } from '../../src/domain/types';

export interface ServerClock { now(): Rfc3339; }
export interface IdSource { next(prefix: string): Id; inviteToken(): string; }

export interface AppDeps {
  db: Db;
  config: ServerConfig;
  clock: ServerClock;
  ids: IdSource;
}

/** 経路ごとに必ず宣言する。宣言のない経路は起動時に止める。 */
export interface RouteDeclaration {
  operationId: string;
  auth: 'public' | 'session';
  csrf: boolean;
  /** 権限の判定を行う場所。rule は共有の規則の中で判定することを表す。 */
  capability: 'rule' | 'own' | 'none';
  idempotent: boolean;
  /** 直近の本人確認が要る操作。 */
  recentAuth?: boolean;
  /** 200 以外で成功を返す操作。 */
  successStatus?: 201 | 202;
}

declare module 'fastify' {
  interface FastifyContextConfig { route?: RouteDeclaration }
  interface FastifyRequest {
    session: SessionRow | null;
    actor: { userId: Id; householdId: Id; membershipId: Id } | null;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly error: GatewayError;
  constructor(status: number, error: GatewayError) { super(error.message); this.status = status; this.error = error; }
}

const statuses: Record<GatewayError['code'], number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, REAUTH_REQUIRED: 403, INVALID_INPUT: 422,
  CONFLICT: 409, OFFLINE: 503, RATE_LIMITED: 429, UPSTREAM_FAILURE: 502, ATTACHMENT_REJECTED: 422,
};

export const statusOf = (error: GatewayError) => error.reason === 'IDEMPOTENCY' ? 409 : statuses[error.code];

export function sendError(reply: FastifyReply, error: GatewayError) {
  return reply.code(statusOf(error)).type('application/problem+json').send(error);
}

export const unauthenticated = () => new ApiError(401, { code: 'UNAUTHENTICATED', message: serverMessages.signInRequired, retryable: false });
export const invalidInput = (message: string = serverMessages.invalidInput) => new ApiError(422, { code: 'INVALID_INPUT', message, retryable: false });

export function requireActor(request: FastifyRequest) {
  if (!request.actor) throw new ApiError(403, { code: 'FORBIDDEN', message: serverMessages.noHousehold, retryable: false, reason: 'MEMBERSHIP_INACTIVE' });
  return request.actor;
}
