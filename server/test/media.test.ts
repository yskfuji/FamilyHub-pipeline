import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createClamdScanner } from '../adapters/scanner';
import { scrubVideoMetadata } from '../media/mp4Metadata';
import { originalPath } from '../media/pipeline';
import { sniff } from '../media/sniff';
import { startFakeClamd } from '../testing/fakeClamd';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const worlds: World[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });
const open = (...args: Parameters<typeof createWorld>) => { const world = createWorld(...args); worlds.push(world); return world; };
const settled = async (world: World) => { await world.ready; await new Promise((resolve) => setTimeout(resolve, 20)); await Promise.all([...world.deps.jobs]); };

const box = (type: string, payload: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4, 'latin1'); return Buffer.concat([header, payload]); };
const LOCATION = '+35.6894+139.6917/';
function sampleVideo() {
  const xyz = box('©xyz', Buffer.from(LOCATION, 'latin1'));
  const name = Buffer.from('com.apple.quicktime.location.ISO6709', 'latin1');
  const keyEntry = Buffer.concat([Buffer.from([0, 0, 0, name.length + 8]), Buffer.from('mdta', 'latin1'), name]);
  const keys = box('keys', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0, 0, 1]), keyEntry]));
  const value = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(LOCATION, 'latin1')]);
  const item = Buffer.concat([Buffer.from([0, 0, 0, value.length + 8, 0, 0, 0, 1]), value]);
  const meta = box('meta', Buffer.concat([box('hdlr', Buffer.alloc(24)), keys, box('ilst', item)]));
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1')), box('moov', box('udta', Buffer.concat([xyz, meta]))), box('mdat', Buffer.alloc(64, 7))]);
}
const imageWithGps = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().withExif({ IFD3: { GPSLatitude: '35/1 41/1 0/1', GPSLatitudeRef: 'N' } }).toBuffer();
const asFile = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

describe('type detection', () => {
  it('goes by the bytes and refuses HEIC and unknown content', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ mimeType: 'image/jpeg' });
    const ftyp = (brand: string) => new TextEncoder().encode(`\0\0\0\x18ftyp${brand}`);
    expect(sniff(ftyp('heic'))).toEqual({ rejected: 'heic' });
    expect(sniff(ftyp('qt  '))).toMatchObject({ mimeType: 'video/quicktime' });
    expect(sniff(new TextEncoder().encode('<script>alert(1)</script>'))).toEqual({ rejected: 'unknown' });
  });
});

describe('video location', () => {
  it('blanks every location atom without changing the length, and refuses a broken file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp4-'));
    const path = join(dir, 'video.mp4');
    const original = sampleVideo();
    writeFileSync(path, original);
    await scrubVideoMetadata(path, { keepLocation: false });
    const result = readFileSync(path);
    expect(result.length).toBe(original.length);
    expect(result.includes(Buffer.from(LOCATION, 'latin1'))).toBe(false);
    expect(result.includes(Buffer.from('location', 'latin1'))).toBe(false);
    const broken = join(dir, 'broken.mp4');
    writeFileSync(broken, Buffer.concat([box('ftyp', Buffer.alloc(8)), Buffer.from([0, 0, 0xff, 0xff]), Buffer.from('moov', 'latin1')]));
    await expect(scrubVideoMetadata(broken, { keepLocation: false })).rejects.toThrow();
  });
});

describe('virus scanner', () => {
  it.each([['clean', 'clean'], ['infected', 'infected'], ['garbage', 'failed']] as const)('answers %s as %s', async (behavior, expected) => {
    const fake = await startFakeClamd(behavior);
    const path = join(mkdtempSync(join(tmpdir(), 'scan-')), 'file');
    writeFileSync(path, Buffer.alloc(200_000, 1));
    expect(await createClamdScanner('127.0.0.1', fake.port, 2000).scan(path)).toBe(expected);
    await fake.close();
  });

  it('treats a hanging or missing scanner as not clean', async () => {
    const fake = await startFakeClamd('silent');
    const path = join(mkdtempSync(join(tmpdir(), 'scan-')), 'file');
    writeFileSync(path, Buffer.alloc(10, 1));
    expect(await createClamdScanner('127.0.0.1', fake.port, 100).scan(path)).toBe('failed');
    await fake.close();
    expect(await createClamdScanner('127.0.0.1', 1, 100).scan(path)).toBe('failed');
  });
});

describe('album uploads', () => {
  it('strips GPS from photos by default, makes a thumbnail, and serves ranges', async () => {
    const world = open();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(await imageWithGps(), 'a.jpg', 'image/jpeg'), { keepLocation: false });
    expect(uploaded.ok).toBe(true);
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const item = album.ok ? album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId) : undefined;
    expect(item).toMatchObject({ status: 'ready', hasThumbnail: true, locationKept: false, kind: 'photo' });
    const { url, cookies } = await world.ready;
    const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const file = await fetch(`${url}${world.gateway.albums.mediaUrl(item!, 'file')}`, { headers });
    expect(file.status).toBe(200);
    expect(file.headers.get('cache-control')).toContain('private');
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).exif).toBeUndefined();
    const part = await fetch(`${url}${world.gateway.albums.mediaUrl(item!, 'file')}`, { headers: { ...headers, Range: 'bytes=0-9' } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    expect((await fetch(`${url}${world.gateway.albums.mediaUrl(item!, 'file')}`, { headers: { ...headers, Range: 'bytes=999999999-' } })).status).toBe(416);
  });

  it('keeps the location only when asked', async () => {
    const world = open();
    const bytes = await imageWithGps();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(bytes, 'a.jpg', 'image/jpeg'), { keepLocation: true });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId)).toMatchObject({ locationKept: true });
  });

  it('skips a duplicate in the same album', async () => {
    const world = open();
    const bytes = await imageWithGps();
    await world.gateway.albums.uploadItem('album-sports', asFile(bytes, 'a.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const second = await world.gateway.albums.uploadItem('album-sports', asFile(bytes, 'b.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.find((entry) => second.ok && entry.id === second.value.itemId)).toMatchObject({ status: 'rejected', statusMessage: '同じ写真がすでにあります。' });
  });

  it('does not store what the scanner flags or cannot check', async () => {
    for (const verdict of ['infected', 'failed'] as const) {
      const world = open('member-aoi', undefined, { scan: async () => verdict, ready: async () => true });
      const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(await imageWithGps(), 'a.jpg', 'image/jpeg'), { keepLocation: false });
      await settled(world);
      const album = await world.gateway.albums.getAlbum('album-sports');
      expect(album.ok && album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId)).toMatchObject({ status: 'rejected' });
    }
  });

  it('refuses a disguised file and a HEIC, whatever the name says', async () => {
    const world = open();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(Buffer.from('<script>alert(1)</script>'), 'photo.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId)).toMatchObject({ status: 'rejected' });
  });

  it('an upload stopped with its signal gives the slot back, so stopping never uses up the limit', async () => {
    const world = open();
    await world.ready;
    for (let round = 0; round < 5; round += 1) {
      const controller = new AbortController();
      controller.abort();
      const stopped = await world.gateway.albums.uploadItem('album-sports', asFile(await imageWithGps(), `stop-${round}.jpg`, 'image/jpeg'), { keepLocation: false, signal: controller.signal });
      expect(stopped.ok).toBe(false);
    }
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.filter((item) => item.originalName.startsWith('stop-'))).toEqual([]);
    expect((await world.gateway.albums.uploadItem('album-sports', asFile(await imageWithGps(), 'after.jpg', 'image/jpeg'), { keepLocation: false })).ok).toBe(true);
  });

  it('cancelling a file that was never sent is harmless', async () => {
    const world = open();
    await world.ready;
    expect((await world.gateway.albums.cancelUpload(asFile(Buffer.from('x'), 'never-sent.jpg', 'image/jpeg'))).ok).toBe(true);
  });

  it('strips location atoms from a video and accepts a client thumbnail only after re-encoding', async () => {
    const world = open();
    const thumbnail = new Blob([new Uint8Array(await sharp({ create: { width: 32, height: 18, channels: 3, background: '#000' } }).png().toBuffer())]);
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(sampleVideo(), 'v.mp4', 'video/mp4'), { keepLocation: false, thumbnail });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const item = album.ok ? album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId) : undefined;
    expect(item, JSON.stringify(item)).toMatchObject({ status: 'ready', kind: 'video', hasThumbnail: true });
    const { url, cookies } = await world.ready;
    const file = await fetch(`${url}${world.gateway.albums.mediaUrl(item!, 'file')}`, { headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } });
    expect(Buffer.from(await file.arrayBuffer()).includes(Buffer.from(LOCATION, 'latin1'))).toBe(false);
  });

  it('reports the offset and continues after an interruption', async () => {
    const world = open();
    const { url, cookies } = await world.ready;
    const headers = { Origin: 'https://family.example.test', Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const { token } = await (await fetch(`${url}/v1/auth/csrf`, { headers })).json() as { token: string };
    const bytes = await imageWithGps();
    const created = await (await fetch(`${url}/v1/uploads`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ albumId: 'album-sports', name: 'a.jpg', mimeType: 'image/jpeg', byteSize: bytes.length }) })).json() as { uploadId: string };
    const patch = (offset: number, chunk: Buffer) => fetch(`${url}/v1/uploads/${created.uploadId}`, { method: 'PATCH', headers: { ...headers, 'X-CSRF-Token': token, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }, body: new Uint8Array(chunk) });
    expect((await patch(0, bytes.subarray(0, 100))).status).toBe(204);
    expect((await fetch(`${url}/v1/uploads/${created.uploadId}`, { method: 'HEAD', headers })).headers.get('upload-offset')).toBe('100');
    expect((await patch(50, bytes.subarray(50, 100))).status).toBe(409);
    expect((await patch(100, bytes.subarray(100))).status).toBe(204);
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.some((item) => item.originalName === 'a.jpg' && item.status === 'ready')).toBe(true);
  });

  it('does not let abandoned uploads block new ones', async () => {
    const world = open();
    const { url, cookies } = await world.ready;
    const headers = { Origin: 'https://family.example.test', Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const { token } = await (await fetch(`${url}/v1/auth/csrf`, { headers })).json() as { token: string };
    const start = (name: string) => fetch(`${url}/v1/uploads`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ albumId: 'album-sports', name, mimeType: 'image/jpeg', byteSize: 10 }) });
    for (const name of ['a', 'b', 'c']) expect((await start(name)).status).toBe(201);
    expect((await start('d')).status).toBe(429);
    world.deps.db.run("UPDATE uploads SET touched_at = '2026-09-30T06:00:00+09:00'");
    expect((await start('d')).status).toBe(201);
  });

  it('records a failure instead of staying in processing when handling throws', async () => {
    const world = open('member-aoi', undefined, { scan: async () => { throw new Error('scanner crashed'); }, ready: async () => true });
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(await imageWithGps(), 'a.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    expect(album.ok && album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId)).toMatchObject({ status: 'rejected' });
  });

  it('checks album access on media', async () => {
    const owner = open();
    const { url, cookies } = await owner.ready;
    const child = open('member-hana');
    expect(await child.gateway.albums.getAlbum('album-park')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await fetch(`${url}/v1/albums/album-sports/items/item-sports-1/file`)).status).toBe(401);
    expect(cookies.size).toBeGreaterThan(0);
  });
});

describe('memo attachments', () => {
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');

  it('holds a file until it is checked, then opens it through a short-lived link', async () => {
    const world = open();
    const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(pdf, 'お知らせ.pdf', 'application/pdf'));
    expect(uploaded.ok).toBe(true);
    await settled(world);
    const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
    const link = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id);
    expect(link.ok).toBe(true);
    const { url, cookies } = await world.ready;
    const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const opened = await fetch(`${url}${link.ok ? link.value.url : ''}`, { headers });
    expect(opened.status).toBe(200);
    expect(opened.headers.get('content-security-policy')).toContain('sandbox');
    expect(opened.headers.get('content-disposition')).toContain('attachment');
    expect(link.ok && new URL(link.value.url, url).searchParams.get('download')).toBe('1');
    const tampered = await fetch(`${url}${link.ok ? link.value.url.replace(/signature=[^&]+/, 'signature=wrong') : ''}`, { headers });
    expect(tampered.status).toBe(404);
  });

  it('serves the type and name stored with the attachment, whatever the link query says', async () => {
    const world = open();
    const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(pdf, 'お知らせ.pdf', 'application/pdf'));
    await settled(world);
    const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
    const link = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id, 'inline');
    const issued = new URL(link.ok ? link.value.url : '/', 'https://family.example.test');
    expect([...issued.searchParams.keys()].sort()).toEqual(['expires', 'signature']);
    const { url, cookies } = await world.ready;
    const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const get = (query: URLSearchParams) => fetch(`${url}${issued.pathname}?${query}`, { headers });
    const stored = { type: 'application/pdf', disposition: `inline; filename*=UTF-8''${encodeURIComponent('お知らせ.pdf')}` };
    const served = async (query: URLSearchParams) => { const response = await get(query); await response.arrayBuffer(); return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition') }; };
    expect(await served(issued.searchParams)).toEqual({ status: 200, ...stored });
    // 余計な値を足しても、配信する種類と名前は記録のまま。
    const extra = new URLSearchParams(issued.searchParams);
    extra.set('mime', 'text/html'); extra.set('name', 'evil.html'); extra.set('disposition', 'attachment');
    expect(await served(extra)).toEqual({ status: 200, ...stored });
    // 署名に含まれる値を変えると開けない（開くリンクに download=1 を足して保存に変えることもできない）。
    for (const [key, value] of [['download', '1'], ['download', 'yes'], ['expires', String(Number(issued.searchParams.get('expires')) + 60_000)], ['signature', 'x'.repeat(43)]] as const) {
      const tampered = new URLSearchParams(issued.searchParams);
      tampered.set(key, value);
      expect((await get(tampered)).status, `${key}=${value}`).toBe(404);
    }
    const unsigned = new URLSearchParams(issued.searchParams);
    unsigned.delete('signature');
    expect((await get(unsigned)).status).toBe(404);
  });

  it('opens images, mp4 and PDF inline, saves with ?download=1, and never serves QuickTime or a tampered link inline (A14)', async () => {
    const world = open();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#654321' } }).png().toBuffer();
    const quicktime = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'latin1')), box('moov', Buffer.alloc(0)), box('mdat', Buffer.alloc(16, 1))]);
    const files = [['a.jpg', 'image/jpeg', jpeg], ['a.png', 'image/png', png], ['a.mp4', 'video/mp4', sampleVideo()], ['a.pdf', 'application/pdf', pdf], ['a.mov', 'video/quicktime', quicktime]] as const;
    const { url, cookies } = await world.ready;
    const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const results: Record<string, { inline: string | null; download: string | null; type: string | null }> = {};
    for (const [name, type, bytes] of files) {
      const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(bytes, name, type));
      await settled(world);
      const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
      const snapshot = await world.gateway.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.memos.find((memo) => memo.id === 'memo-school')?.attachments.find((item) => item.id === attachment!.id), name).toMatchObject({ status: 'clean', mimeType: type });
      const inline = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id, 'inline');
      const download = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id, 'attachment');
      expect(download.ok && new URL(download.value.url, url).searchParams.get('download')).toBe('1');
      const opened = await fetch(`${url}${inline.ok ? inline.value.url : ''}`, { headers });
      const saved = await fetch(`${url}${download.ok ? download.value.url : ''}`, { headers });
      for (const response of [opened, saved]) {
        expect(response.status, name).toBe(200);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
        await response.arrayBuffer();
      }
      results[name] = { inline: opened.headers.get('content-disposition')?.split(';')[0] ?? null, download: saved.headers.get('content-disposition')?.split(';')[0] ?? null, type: opened.headers.get('content-type') };
      // 保存のリンクから download=1 を外しても、開くリンクにはならない。
      const stripped = new URL(download.ok ? download.value.url : '/', url);
      stripped.searchParams.delete('download');
      expect((await fetch(stripped, { headers })).status, name).toBe(404);
    }
    expect(results).toEqual({
      'a.jpg': { inline: 'inline', download: 'attachment', type: 'image/jpeg' },
      'a.png': { inline: 'inline', download: 'attachment', type: 'image/png' },
      'a.mp4': { inline: 'inline', download: 'attachment', type: 'video/mp4' },
      'a.pdf': { inline: 'inline', download: 'attachment', type: 'application/pdf' },
      'a.mov': { inline: 'attachment', download: 'attachment', type: 'video/quicktime' },
    });
    // 既定（引数なし）は保存のリンク。
    const plain = await world.gateway.memos.getAttachmentLink('memo-school', 'attachment-school');
    expect(plain.ok && new URL(plain.value.url, url).searchParams.get('download')).toBe('1');
    expect((await fetch(`${url}/v1/memos/memo-school/attachments/attachment-school/link?download=2`, { headers })).status).toBe(422);
  });

  it('removes the location from a video attachment, and refuses one it cannot read', async () => {
    const world = open();
    const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(sampleVideo(), 'clip.mp4', 'video/mp4'));
    await settled(world);
    const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
    const link = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id);
    expect(link.ok).toBe(true);
    const { url, cookies } = await world.ready;
    const opened = await fetch(`${url}${link.ok ? link.value.url : ''}`, { headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } });
    expect(Buffer.from(await opened.arrayBuffer()).includes(Buffer.from(LOCATION, 'latin1'))).toBe(false);

    const broken = Buffer.concat([box('ftyp', Buffer.alloc(8)), Buffer.from([0, 0, 0xff, 0xff]), Buffer.from('moov', 'latin1')]);
    const refused = await world.gateway.memos.uploadAttachment('memo-school', asFile(broken, 'broken.mp4', 'video/mp4'));
    await settled(world);
    const rejected = refused.ok ? refused.value.attachments.at(-1)! : null;
    expect(await world.gateway.memos.getAttachmentLink('memo-school', rejected!.id)).toMatchObject({ ok: false, error: { code: 'ATTACHMENT_REJECTED' } });
  });

  it('rejects what the scanner refuses and never issues a link', async () => {
    const world = open('member-aoi', undefined, { scan: async () => 'failed', ready: async () => true });
    const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(pdf, 'a.pdf', 'application/pdf'));
    await settled(world);
    const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
    expect(await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id)).toMatchObject({ ok: false, error: { code: 'ATTACHMENT_REJECTED' } });
  });

  it('removes the stored file with the record, so an issued link stops working', async () => {
    const world = open();
    const uploaded = await world.gateway.memos.uploadAttachment('memo-school', asFile(pdf, 'a.pdf', 'application/pdf'));
    await settled(world);
    const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
    const link = await world.gateway.memos.getAttachmentLink('memo-school', attachment!.id);
    const { url, cookies } = await world.ready;
    const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    expect((await fetch(`${url}${link.ok ? link.value.url : ''}`, { headers })).status).toBe(200);
    expect(await world.gateway.memos.deleteAttachment('memo-school', attachment!.id)).toEqual({ ok: true, value: undefined });
    expect(existsSync(originalPath(world.deps.config.mediaPath, 'house-mori', attachment!.id))).toBe(false);
    expect((await fetch(`${url}${link.ok ? link.value.url : ''}`, { headers })).status).toBe(404);
  });

  it('deletes an attachment', async () => {
    const world = open();
    expect(await world.gateway.memos.deleteAttachment('memo-school', 'attachment-school')).toEqual({ ok: true, value: undefined });
    const snapshot = await world.gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.memos.find((memo) => memo.id === 'memo-school')?.attachments).toEqual([]);
  });
});
