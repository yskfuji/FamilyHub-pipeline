import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverMessages } from '../../../src/content/serverMessages';
import { createHouseholdRules } from '../../../src/domain/commands';
import { idSchema } from '../../../src/domain/schemas';
import type { Memo } from '../../../src/domain/types';
import { ok } from '../../../src/domain/commands/context';
import { loadAggregate, saveAggregate } from '../../db/aggregateStore';
import { stripVideoLocation } from '../../media/mp4Location';
import type { ProcessOutcome } from '../../media/pipeline';
import { acceptClientThumbnail, originalPath, processMedia, quarantinePath, sanitizeImage, sniffFile, thumbnailPath } from '../../media/pipeline';
import { ApiError, invalidInput, requireActor, sendError, unauthenticated } from '../context';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { mutate, read } from '../rules';

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'rule', idempotent: true, ...overrides } as RouteDeclaration });
const reading = (operationId: string) => declare(operationId, { csrf: false, idempotent: false });
const param = (request: { params: unknown }, name: string) => parse(idSchema, (request.params as Record<string, unknown>)[name]);
const media = { media: true };

const UPLOAD_TTL_MS = 24 * 3_600_000;
const MAX_ACTIVE_UPLOADS = 3;
const UPLOAD_ACTIVE_MS = 10 * 60_000;
const ATTACHMENT_FILE_MAX = 130 * 1024 * 1024;
const LINK_TTL_MS = 5 * 60_000;
const contentPolicy = "default-src 'none'; sandbox";

interface UploadRow { id: string; user_id: string; household_id: string; membership_id: string; album_id: string; item_id: string; upload_length: number; upload_offset: number; keep_location: number; expires_at: string }

const defaults = { privacy: { defaultAudience: 'household' as const, hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } };

function sendFile(request: FastifyRequest, reply: FastifyReply, path: string, size: number, mimeType: string, cache: string) {
  void reply.header('Accept-Ranges', 'bytes').header('Content-Type', mimeType).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', cache).header('Content-Security-Policy', contentPolicy);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!request.headers.range) return reply.header('Content-Length', size).send(createReadStream(path));
  const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, size - Number(range[2])) : 0;
  const end = range?.[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (!range || start >= size || start > end) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(path, { start, end }));
}

function signAttachment(deps: AppDeps, attachmentId: string, expires: number) {
  return createHmac('sha256', deps.config.secret).update(`attachment:${attachmentId}:${expires}`).digest('base64url');
}

/** 検査が終わったら記録を更新する。結果の保存に失敗しても、確認待ちのまま開けない状態を保つ。 */
function track(deps: AppDeps, work: Promise<void>) {
  const job = work.catch((error: unknown) => { console.error('media job failed', error instanceof Error ? error.message : 'unknown'); }).finally(() => deps.jobs.delete(job));
  deps.jobs.add(job);
}

async function finishUpload(deps: AppDeps, upload: UploadRow) {
  const source = quarantinePath(deps.config.mediaPath, upload.id);
  deps.db.transaction(() => updateItem(deps, upload, (item) => { item.status = 'processing'; }));
  // 予期しない失敗でも「処理中」のまま残さず、拒否として記録する。
  const outcome = await processMedia({
    root: deps.config.mediaPath, householdId: upload.household_id, itemId: upload.item_id, source, keepLocation: Boolean(upload.keep_location), scanner: deps.scanner,
    findDuplicate: (sha256) => deps.db.get<{ id: string }>("SELECT id FROM records WHERE household_id = ? AND collection = 'albumItems' AND json_extract(body, '$.albumId') = ? AND json_extract(body, '$.sha256') = ? AND json_extract(body, '$.status') = 'ready' AND json_extract(body, '$.deletedAt') IS NULL", upload.household_id, upload.album_id, sha256)?.id ?? null,
  }).catch(async (): Promise<ProcessOutcome> => { await rm(source, { force: true }); return { status: 'rejected', message: '処理できなかったため、保存しませんでした。もう一度追加してください。' }; });
  deps.db.transaction(() => {
    updateItem(deps, upload, (item) => {
      if (outcome.status === 'ready') Object.assign(item, { status: 'ready', sha256: outcome.sha256, mimeType: outcome.mimeType, kind: outcome.kind, ...outcome.media, hasThumbnail: Boolean(item.hasThumbnail) || outcome.media.hasThumbnail });
      else if (outcome.status === 'duplicate') Object.assign(item, { status: 'rejected', statusMessage: '同じ写真がすでにあります。' });
      else Object.assign(item, { status: 'rejected', statusMessage: outcome.message });
    });
    deps.db.run('DELETE FROM uploads WHERE id = ?', upload.id);
  });
}

function updateItem(deps: AppDeps, upload: UploadRow, change: (item: Record<string, unknown>) => void) {
  const row = deps.db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'albumItems' AND id = ?", upload.household_id, upload.item_id);
  if (!row) return;
  const item = JSON.parse(row.body) as Record<string, unknown>;
  change(item);
  deps.db.run("UPDATE records SET body = ? WHERE household_id = ? AND collection = 'albumItems' AND id = ?", JSON.stringify(item), upload.household_id, upload.item_id);
}

function findUpload(deps: AppDeps, request: FastifyRequest): UploadRow {
  const id = param(request, 'uploadId');
  const upload = deps.db.get<UploadRow>('SELECT id, user_id, household_id, membership_id, album_id, item_id, upload_length, upload_offset, keep_location, expires_at FROM uploads WHERE id = ?', id);
  if (!upload || upload.user_id !== request.session?.user_id || Date.parse(upload.expires_at) <= Date.parse(deps.clock.now())) throw new ApiError(404, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
  return upload;
}

const uploadBody = z.object({ albumId: idSchema, name: z.string().min(1).max(200), mimeType: z.string().max(100), byteSize: z.number().int().positive(), keepLocation: z.boolean().default(false) });
const reorderBody = z.object({ itemIds: z.array(idSchema).max(5000), expectedVersion: z.number().int() });
const albumPatch = z.object({ input: z.unknown(), expectedVersion: z.number().int() });

export function registerMediaRoutes(app: FastifyInstance, deps: AppDeps) {
  app.addContentTypeParser('application/offset+octet-stream', (_request, payload, done) => done(null, payload));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_request, body, done) => done(null, body));

  app.get('/v1/albums', { config: reading('listAlbums') }, (request, reply) => read(deps, request, reply, (rules) => rules.albums.listAlbums(), media));
  app.post('/v1/albums', { config: declare('createAlbum', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.albums.createAlbum(request.body), media));
  app.get('/v1/albums/:albumId', { config: reading('getAlbum') }, (request, reply) => read(deps, request, reply, (rules) => rules.albums.getAlbum(param(request, 'albumId')), media));
  app.patch('/v1/albums/:albumId', { config: declare('updateAlbum') }, (request, reply) => {
    const body = parse(albumPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.albums.updateAlbum(param(request, 'albumId'), body.input, body.expectedVersion), media);
  });
  app.delete('/v1/albums/:albumId', { config: declare('deleteAlbum') }, (request, reply) => {
    const expected = parse(z.coerce.number().int(), (request.query as Record<string, unknown>).expectedVersion);
    return mutate(deps, request, reply, (rules) => rules.albums.deleteAlbum(param(request, 'albumId'), expected), media);
  });
  app.post('/v1/albums/:albumId/restore', { config: declare('restoreAlbum') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.albums.restoreAlbum(param(request, 'albumId')), media));
  app.put('/v1/albums/:albumId/order', { config: declare('reorderAlbumItems') }, (request, reply) => {
    const body = parse(reorderBody, request.body);
    return mutate(deps, request, reply, (rules) => rules.albums.reorderItems(param(request, 'albumId'), body.itemIds, body.expectedVersion), media);
  });
  app.delete('/v1/albums/:albumId/items/:itemId', { config: declare('deleteAlbumItem') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.albums.deleteItem(param(request, 'albumId'), param(request, 'itemId')), media));
  app.post('/v1/albums/:albumId/items/:itemId/restore', { config: declare('restoreAlbumItem') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.albums.restoreItem(param(request, 'albumId'), param(request, 'itemId')), media));

  const readableItem = (request: FastifyRequest) => {
    const actor = requireActor(request);
    const { aggregate } = loadAggregate(deps.db, actor.householdId, actor.membershipId, defaults, media);
    const rules = createHouseholdRules(aggregate, { actorMembershipId: actor.membershipId, now: deps.clock.now, nextId: deps.ids.next, newInviteToken: deps.ids.inviteToken });
    const album = rules.albums.getAlbum(param(request, 'albumId'));
    if (!album.ok) throw new ApiError(404, album.error);
    const item = album.value.items.find((entry) => entry.id === param(request, 'itemId'));
    if (!item || item.status !== 'ready') throw new ApiError(404, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
    return { item, householdId: actor.householdId };
  };
  app.get('/v1/albums/:albumId/items/:itemId/file', { config: reading('getAlbumItemFile') }, async (request, reply) => {
    const { item, householdId } = readableItem(request);
    const path = originalPath(deps.config.mediaPath, householdId, item.id);
    return sendFile(request, reply, path, (await stat(path)).size, item.mimeType, 'private, max-age=3600');
  });
  app.get('/v1/albums/:albumId/items/:itemId/thumbnail', { config: reading('getAlbumItemThumbnail') }, async (request, reply) => {
    const { item, householdId } = readableItem(request);
    if (!item.hasThumbnail) throw new ApiError(404, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
    const path = thumbnailPath(deps.config.mediaPath, householdId, item.id);
    return sendFile(request, reply, path, (await stat(path)).size, 'image/jpeg', 'private, max-age=86400');
  });
  app.put('/v1/albums/:albumId/items/:itemId/thumbnail', { config: declare('putAlbumItemThumbnail', { capability: 'own', idempotent: false }) }, async (request, reply) => {
    const actor = requireActor(request);
    const itemId = param(request, 'itemId');
    if (!Buffer.isBuffer(request.body)) throw invalidInput();
    const row = deps.db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'albumItems' AND id = ?", actor.householdId, itemId);
    const item = row ? JSON.parse(row.body) as { uploaderMembershipId: string; kind: string } : null;
    if (!item || item.uploaderMembershipId !== actor.membershipId || item.kind !== 'video') return sendError(reply, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
    try { await acceptClientThumbnail(request.body, thumbnailPath(deps.config.mediaPath, actor.householdId, itemId)); } catch { throw invalidInput(); }
    deps.db.run("UPDATE records SET body = json_set(body, '$.hasThumbnail', json('true')) WHERE household_id = ? AND collection = 'albumItems' AND id = ?", actor.householdId, itemId);
    return reply.code(204).send();
  });

  app.post('/v1/uploads', { config: declare('createUpload', { successStatus: 201 }) }, (request, reply) => {
    const body = parse(uploadBody, request.body);
    const actor = requireActor(request);
    // 閉じたタブの送信が枠をふさがないよう、しばらく動きのないものは数えない（続きからは送れる）。
    const activeSince = new Date(Date.parse(deps.clock.now()) - UPLOAD_ACTIVE_MS).toISOString();
    const active = deps.db.get<{ count: number }>('SELECT count(*) AS count FROM uploads WHERE user_id = ? AND unixepoch(expires_at) > unixepoch(?) AND unixepoch(coalesce(touched_at, ?)) > unixepoch(?)', actor.userId, deps.clock.now(), deps.clock.now(), activeSince);
    if ((active?.count ?? 0) >= MAX_ACTIVE_UPLOADS) throw new ApiError(429, { code: 'RATE_LIMITED', message: '同時に送れるのは3件までです。', retryable: true });
    return mutate(deps, request, reply, (rules) => {
      const reserved = rules.albums.reserveItem(body.albumId, { kind: body.mimeType.startsWith('video/') ? 'video' : 'photo', originalName: body.name, mimeType: body.mimeType, byteSize: body.byteSize, keepLocation: body.keepLocation });
      if (!reserved.ok) return reserved;
      const id = deps.ids.next('upload');
      deps.db.run('INSERT INTO uploads (id, user_id, household_id, membership_id, album_id, item_id, upload_length, upload_offset, keep_location, expires_at, touched_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)', id, actor.userId, actor.householdId, actor.membershipId, body.albumId, reserved.value.id, body.byteSize, body.keepLocation ? 1 : 0, new Date(Date.parse(deps.clock.now()) + UPLOAD_TTL_MS).toISOString(), deps.clock.now());
      return ok({ uploadId: id, itemId: reserved.value.id, offset: 0 });
    }, media);
  });
  app.head('/v1/uploads/:uploadId', { config: declare('getUploadOffset', { csrf: false, capability: 'own', idempotent: false }) }, (request, reply) => {
    const upload = findUpload(deps, request);
    return reply.header('Tus-Resumable', '1.0.0').header('Upload-Offset', upload.upload_offset).header('Upload-Length', upload.upload_length).header('Cache-Control', 'no-store').code(200).send();
  });
  app.patch('/v1/uploads/:uploadId', { config: declare('appendUpload', { capability: 'own', idempotent: false }) }, async (request, reply) => {
    const upload = findUpload(deps, request);
    const offset = Number(request.headers['upload-offset']);
    if (!Number.isInteger(offset) || offset !== upload.upload_offset) return reply.code(409).header('Upload-Offset', upload.upload_offset).type('application/problem+json').send({ code: 'CONFLICT', message: serverMessages.unavailable, retryable: true, reason: 'VERSION' });
    const path = quarantinePath(deps.config.mediaPath, upload.id);
    await mkdir(dirname(path), { recursive: true });
    let received = 0;
    const remaining = upload.upload_length - offset;
    const body = request.body as Readable;
    const counted = async function* (source: Readable) {
      for await (const chunk of source) {
        received += (chunk as Buffer).length;
        if (received > remaining) throw invalidInput();
        yield chunk as Buffer;
      }
    };
    try {
      await pipeline(body, counted, createWriteStream(path, { flags: 'a', start: undefined }));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // 途中で切れた分も受け取った分として記録し、続きから送れるようにする。
    }
    const next = (await stat(path).catch(() => ({ size: 0 }))).size;
    deps.db.run('UPDATE uploads SET upload_offset = ?, touched_at = ? WHERE id = ?', next, deps.clock.now(), upload.id);
    if (next === upload.upload_length) track(deps, finishUpload(deps, { ...upload, upload_offset: next }));
    return reply.code(204).header('Tus-Resumable', '1.0.0').header('Upload-Offset', next).send();
  });
  app.delete('/v1/uploads/:uploadId', { config: declare('cancelUpload', { capability: 'own', idempotent: false }) }, async (request, reply) => {
    const upload = findUpload(deps, request);
    await rm(quarantinePath(deps.config.mediaPath, upload.id), { force: true });
    deps.db.transaction(() => {
      deps.db.run("DELETE FROM records WHERE household_id = ? AND collection = 'albumItems' AND id = ?", upload.household_id, upload.item_id);
      deps.db.run('DELETE FROM uploads WHERE id = ?', upload.id);
    });
    return reply.code(204).send();
  });

  app.post('/v1/memos/:memoId/attachments', { config: declare('uploadAttachment', { successStatus: 202, idempotent: true }) }, async (request, reply) => {
    const actor = requireActor(request);
    const memoId = param(request, 'memoId');
    const part = await request.file({ limits: { fileSize: ATTACHMENT_FILE_MAX, files: 1 } });
    if (!part) throw invalidInput();
    const id = deps.ids.next('quarantine');
    const path = quarantinePath(deps.config.mediaPath, id);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(part.file, createWriteStream(path));
    const rejected = (message: string) => { void rm(path, { force: true }); return sendError(reply, { code: 'ATTACHMENT_REJECTED', message, retryable: false }); };
    if (part.file.truncated) return rejected('ファイルが大きすぎます。');
    const type = await sniffFile(path);
    if ('rejected' in type) return rejected(type.rejected === 'heic' ? 'HEIC の写真は受け付けていません。JPEG で保存し直してください。' : 'この形式のファイルは受け付けていません。');
    const { size } = await stat(path);
    let attachmentId = '';
    const response = mutate(deps, request, reply, (rules) => {
      const accepted = rules.memos.acceptAttachment(memoId, { originalName: part.filename.slice(0, 200), mimeType: type.mimeType, byteSize: size });
      if (!accepted.ok) return accepted;
      attachmentId = accepted.value.id;
      const memo = rules.context.project().memos.find((item) => item.id === memoId);
      return memo ? ok<Memo>(memo) : { ok: false, error: { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false } };
    });
    if (!attachmentId) { await rm(path, { force: true }); return response; }
    track(deps, (async () => {
      const verdict = await deps.scanner.scan(path);
      const destination = originalPath(deps.config.mediaPath, actor.householdId, attachmentId);
      let clean = verdict === 'clean';
      if (clean) {
        try {
          if (type.kind === 'photo') await sanitizeImage(path, destination, false);
          else {
            if (type.kind === 'video') await stripVideoLocation(path);
            await mkdir(dirname(destination), { recursive: true });
            await rename(path, destination);
          }
        } catch { clean = false; }
      }
      if (!clean) await rm(path, { force: true });
      let stillListed = true;
      deps.db.transaction(() => {
        const loaded = loadAggregate(deps.db, actor.householdId, actor.membershipId, defaults);
        createHouseholdRules(loaded.aggregate, { actorMembershipId: actor.membershipId, now: deps.clock.now, nextId: deps.ids.next, newInviteToken: deps.ids.inviteToken }).memos.finishAttachmentCheck(memoId, attachmentId, clean ? 'clean' : 'rejected');
        saveAggregate(deps.db, actor.householdId, actor.membershipId, loaded);
        stillListed = loaded.aggregate.state.memos.some((memo) => memo.attachments.some((item) => item.id === attachmentId));
      });
      // 確認の途中で削除された添付は、ファイルも残さない。
      if (!stillListed) await rm(dirname(destination), { recursive: true, force: true });
    })());
    return response;
  });
  app.delete('/v1/memos/:memoId/attachments/:attachmentId', {
    config: declare('deleteAttachment'),
    // 記録を消せたときだけ実体も消す。応答を返す前に消すので、発行済みのリンクもこの時点で開けなくなる。
    onSend: async (request, reply, payload) => {
      if (reply.statusCode === 204) await rm(dirname(originalPath(deps.config.mediaPath, requireActor(request).householdId, param(request, 'attachmentId'))), { recursive: true, force: true });
      return payload;
    },
  }, (request, reply) => mutate(deps, request, reply, (rules) => rules.memos.deleteAttachment(param(request, 'memoId'), param(request, 'attachmentId'))));
  app.get('/v1/memos/:memoId/attachments/:attachmentId/link', { config: reading('getAttachmentLink') }, (request, reply) => read(deps, request, reply, (rules) => {
    const attachmentId = param(request, 'attachmentId');
    const readable = rules.memos.readableAttachment(param(request, 'memoId'), attachmentId);
    if (!readable.ok) return readable;
    const expires = Date.parse(deps.clock.now()) + LINK_TTL_MS;
    const query = new URLSearchParams({ mime: readable.value.mimeType, name: readable.value.originalName, expires: String(expires), signature: signAttachment(deps, attachmentId, expires) });
    return ok({ url: `/v1/attachment-files/${encodeURIComponent(attachmentId)}?${query}`, expiresAt: new Date(expires).toISOString() });
  }));
  app.get('/v1/attachment-files/:attachmentId', { config: reading('getAttachmentFile') }, async (request, reply) => {
    const actor = requireActor(request);
    if (!request.session) throw unauthenticated();
    const attachmentId = param(request, 'attachmentId');
    const { expires, signature, mime, name } = parse(z.object({ expires: z.coerce.number(), signature: z.string(), mime: z.string(), name: z.string() }), request.query);
    const expected = Buffer.from(signAttachment(deps, attachmentId, expires));
    const presented = Buffer.from(signature);
    if (expires <= Date.parse(deps.clock.now()) || expected.length !== presented.length || !timingSafeEqual(expected, presented)) return sendError(reply, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
    const path = originalPath(deps.config.mediaPath, actor.householdId, attachmentId);
    void reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    const size = (await stat(path).catch(() => null))?.size;
    if (size === undefined) return sendError(reply, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
    return sendFile(request, reply, path, size, ['application/pdf', 'image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'].includes(mime) ? mime : 'application/octet-stream', 'private, no-store');
  });
}
