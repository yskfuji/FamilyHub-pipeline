import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverMessages } from '../../../src/content/serverMessages';
import { READING_IMAGE_MAX_BYTES, readingUrlProblem } from '../../../src/domain/assistant';
import type { AssistantJobKind } from '../../../src/domain/assistant';
import { fail, ok } from '../../../src/domain/commands/context';
import { idSchema } from '../../../src/domain/schemas';
import { PageRefused } from '../../adapters/urlFetcher';
import { findReading, hasActiveReading, insertReading, runReading, sweepInterrupted } from '../../assistant/jobs';
import { readEventImage, readEventPage, readReceiptImage, removeFile } from '../../assistant/reading';
import { quarantinePath, sniffFile } from '../../media/pipeline';
import { ApiError, invalidInput, requireActor, sendError } from '../context';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { limit } from '../rateLimit';
import { mutate, read } from '../rules';

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'rule', idempotent: true, ...overrides } as RouteDeclaration });
const reading = (operationId: string) => declare(operationId, { csrf: false, idempotent: false });

const urlBody = z.object({ url: z.string().min(1).max(2048) });
const READINGS_PER_HOUR = 30;

export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps) {
  const requireLlm = () => {
    if (!deps.llm.available) throw new ApiError(502, { code: 'UPSTREAM_FAILURE', message: serverMessages.readingUnavailable, retryable: false });
  };

  /** 受け付けの権限と順番を確かめて仕事の行を作る。同じ操作の送り直しでは、最初の仕事を返す。 */
  const accept = (request: FastifyRequest, reply: FastifyReply, kind: AssistantJobKind, fileId: string | null, work: () => Promise<object>) => {
    const actor = requireActor(request);
    let id = '';
    const response = mutate(deps, request, reply, (rules) => {
      const allowed = rules.assistant.authorize(kind);
      if (!allowed.ok) return allowed;
      sweepInterrupted(deps, actor.householdId);
      if (hasActiveReading(deps, actor.householdId)) return fail({ code: 'RATE_LIMITED', message: serverMessages.readingBusy, retryable: true });
      id = insertReading(deps, actor, kind, fileId);
      return ok({ id, kind, status: 'queued' as const });
    });
    if (id) runReading(deps, id, fileId, work);
    return { response, accepted: Boolean(id) };
  };

  /** 画像を受け取る。形式の判定と大きさの上限は、ほかの添付と同じ仕組みで行う。 */
  const acceptImage = async (request: FastifyRequest, reply: FastifyReply, kind: AssistantJobKind, readFile: (path: string) => Promise<object>) => {
    const actor = requireActor(request);
    requireLlm();
    limit(deps, `reading:${actor.userId}`, READINGS_PER_HOUR, 3_600_000);
    const part = await request.file({ limits: { fileSize: READING_IMAGE_MAX_BYTES, files: 1 } });
    if (!part) throw invalidInput();
    const fileId = deps.ids.next('quarantine');
    const path = quarantinePath(deps.config.mediaPath, fileId);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(part.file, createWriteStream(path));
    const rejected = async (message: string) => { await removeFile(path); return sendError(reply, { code: 'ATTACHMENT_REJECTED', message, retryable: false }); };
    if (part.file.truncated) return rejected(serverMessages.fileTooLarge);
    const type = await sniffFile(path);
    if ('rejected' in type) return rejected(type.rejected === 'heic' ? serverMessages.heicRejected : serverMessages.fileTypeRejected);
    if (type.kind !== 'photo') return rejected(serverMessages.readingImageOnly);
    const { response, accepted } = accept(request, reply, kind, fileId, () => readFile(path));
    if (!accepted) await removeFile(path);
    return response;
  };

  app.get('/v1/assistant/status', { config: reading('getAssistantStatus') }, (request, reply) => read(deps, request, reply, (rules) => rules.assistant.status(deps.llm.available)));

  app.post('/v1/assistant/receipt', { config: declare('readReceipt', { successStatus: 202 }) }, (request, reply) => acceptImage(request, reply, 'receipt', (path) => readReceiptImage(deps, path)));
  app.post('/v1/assistant/event-image', { config: declare('readEventImage', { successStatus: 202 }) }, (request, reply) => acceptImage(request, reply, 'event', (path) => readEventImage(deps, path)));
  app.post('/v1/assistant/event-url', { config: declare('readEventUrl', { successStatus: 202 }) }, (request, reply) => {
    requireLlm();
    const { url } = parse(urlBody, request.body);
    const problem = readingUrlProblem(url);
    if (problem) throw invalidInput(problem);
    try { deps.pages.check(url); } catch (error) {
      if (error instanceof PageRefused) throw invalidInput(serverMessages.readingRefused);
      throw error;
    }
    limit(deps, `reading:${requireActor(request).userId}`, READINGS_PER_HOUR, 3_600_000);
    return accept(request, reply, 'event', null, () => readEventPage(deps, url)).response;
  });

  app.get('/v1/assistant/jobs/:jobId', { config: reading('getAssistantJob') }, (request, reply) => {
    const id = parse(idSchema, (request.params as Record<string, unknown>).jobId);
    const { userId, householdId } = requireActor(request);
    sweepInterrupted(deps, householdId);
    return read(deps, request, reply, (rules) => {
      const job = findReading(deps, id, userId);
      if (!job) throw new ApiError(404, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
      const allowed = rules.assistant.authorize(job.kind);
      return allowed.ok ? ok(job) : allowed;
    });
  });
}
