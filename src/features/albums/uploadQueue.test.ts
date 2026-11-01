import { describe, expect, it, vi } from 'vitest';
import { DUPLICATE_ITEM_MESSAGE } from '../../domain/albumView';
import { HEIC_MESSAGE } from '../../domain/albumUpload';
import type { AlbumItem, Result } from '../../domain/types';
import { createUploadQueue } from './uploadQueue';
import type { UploadOptions } from '../../data/gateway';

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
const video = (name: string) => new File(['x'], name, { type: 'video/mp4' });
const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });
const until = async (check: () => boolean) => { for (let index = 0; index < 200 && !check(); index += 1) await tick(); expect(check()).toBe(true); };

type UploadCall = [string, File, UploadOptions];

function setup(overrides: Record<string, unknown> = {}) {
  const items: Partial<AlbumItem>[] = [];
  let nextId = 0;
  const gateway: any = {
    uploadItem: vi.fn(async (_album: string, file: File): Promise<Result<{ itemId: string }>> => { nextId += 1; items.push({ id: `i${nextId}`, status: 'ready', originalName: file.name }); return { ok: true, value: { itemId: `i${nextId}` } }; }),
    getAlbum: vi.fn(async () => ({ ok: true as const, value: { album: {}, items } })),
    cancelUpload: vi.fn(async (): Promise<Result<void>> => ({ ok: true, value: undefined })),
    ...overrides,
  };
  const onSettled = vi.fn();
  const makeThumbnail = vi.fn(async (): Promise<Blob | null> => new Blob(['t']));
  const queue = createUploadQueue({ gateway, makeThumbnail, onSettled, pollMs: 1, rateLimitWaitMs: 1 });
  const states = () => queue.getEntries().map((entry) => entry.state);
  const uploads = () => gateway.uploadItem.mock.calls as UploadCall[];
  return { queue, gateway, onSettled, makeThumbnail, items, states, uploads };
}

describe('upload queue', () => {
  it('holds files until started, then sends them in the chosen order', async () => {
    const { queue, gateway, states, uploads } = setup();
    queue.add('a', [photo('1.jpg'), photo('2.jpg')]);
    expect(states()).toEqual(['staged', 'staged']);
    expect(gateway.uploadItem).not.toHaveBeenCalled();
    queue.move(queue.getEntries()[1].key, -1);
    queue.start('a', false);
    await until(() => states().every((state) => state === 'done'));
    expect(uploads().map((call) => call[1].name)).toEqual(['2.jpg', '1.jpg']);
  });

  it('passes the location choice along, off unless asked for', async () => {
    const { queue, states, uploads } = setup();
    queue.add('a', [photo('1.jpg')]);
    queue.start('a', true);
    await until(() => states()[0] === 'done');
    expect(uploads()[0][2]).toMatchObject({ keepLocation: true });
  });

  it('never runs more than three at once, including files still being processed', async () => {
    const release: Array<() => void> = [];
    let running = 0; let peak = 0; let nextId = 0;
    const items: Partial<AlbumItem>[] = [];
    const { queue, states } = setup({
      uploadItem: vi.fn(async (_album: string, _file: File, options: UploadOptions) => {
        running += 1; peak = Math.max(peak, running);
        options.onReserved?.();
        await new Promise<void>((resolve) => { release.push(resolve); });
        nextId += 1; items.push({ id: `i${nextId}`, status: 'ready' });
        running -= 1;
        return { ok: true, value: { itemId: `i${nextId}` } } as const;
      }),
      getAlbum: vi.fn(async () => ({ ok: true as const, value: { album: {}, items } })),
    });
    queue.add('a', ['1', '2', '3', '4', '5'].map((name) => photo(`${name}.jpg`)));
    queue.start('a', false);
    await tick();
    expect(states().filter((state) => state === 'sending')).toHaveLength(3);
    while (states().some((state) => state !== 'done')) { release.shift()?.(); await tick(); }
    expect(peak).toBe(3);
  });

  it('starts the next file only once the previous one has its place, so a slow thumbnail cannot change the order', async () => {
    const reservations: string[] = [];
    const { queue, makeThumbnail, states } = setup({
      uploadItem: vi.fn(async (_album: string, file: File, options: UploadOptions) => {
        reservations.push(file.name);
        options.onReserved?.();
        await tick();
        return { ok: true, value: { itemId: file.name } } as const;
      }),
      getAlbum: vi.fn(async () => ({ ok: true as const, value: { album: {}, items: [{ id: 'first.mp4', status: 'ready' }, { id: 'second.jpg', status: 'ready' }] } })),
    });
    makeThumbnail.mockImplementationOnce(async () => { await tick(); await tick(); return null; });
    queue.add('a', [video('first.mp4'), photo('second.jpg')]);
    queue.start('a', false);
    await until(() => states().every((state) => state === 'done'));
    expect(reservations).toEqual(['first.mp4', 'second.jpg']);
  });

  it('a failure before the place is given does not stop the rest', async () => {
    const { queue, gateway, states } = setup();
    gateway.uploadItem.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: '送れません。', retryable: false } });
    queue.add('a', [photo('1.jpg'), photo('2.jpg')]);
    queue.start('a', false);
    await until(() => states()[1] === 'done');
    expect(states()[0]).toBe('failed');
  });

  it('keeps a failure listed and retries it with the same file', async () => {
    const file = photo('1.jpg');
    const { queue, gateway, states, uploads } = setup();
    gateway.uploadItem.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: '接続できません。', retryable: true } });
    queue.add('a', [file, photo('2.jpg')]);
    queue.start('a', false);
    await until(() => states()[1] === 'done' && states()[0] === 'failed');
    expect(queue.getEntries()[0].message).toBe('接続できません。');
    queue.retry(queue.getEntries()[0].key);
    await until(() => states()[0] === 'done');
    expect(uploads().filter((call) => call[1].name === '1.jpg')).toHaveLength(2);
  });

  it('shows a refusal with its message and no retry', async () => {
    const { queue, items, states } = setup({
      uploadItem: vi.fn(async () => { items.push({ id: 'bad', status: 'rejected', statusMessage: 'この形式のファイルは受け付けていません。' }); return { ok: true, value: { itemId: 'bad' } } as const; }),
    });
    queue.add('a', [photo('fake.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'rejected');
    expect(queue.getEntries()[0]).toMatchObject({ message: 'この形式のファイルは受け付けていません。', retryable: false });
    queue.retry(queue.getEntries()[0].key);
    expect(states()).toEqual(['rejected']);
  });

  it('reports a duplicate without calling it a failure', async () => {
    const { queue, items, states } = setup({
      uploadItem: vi.fn(async () => { items.push({ id: 'same', status: 'rejected', statusMessage: DUPLICATE_ITEM_MESSAGE }); return { ok: true, value: { itemId: 'same' } } as const; }),
    });
    queue.add('a', [photo('same.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'duplicate');
  });

  it('waits for a free slot when the limit is reached elsewhere', async () => {
    const { queue, gateway, states } = setup();
    gateway.uploadItem.mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: '同時に送れるのは3件までです。', retryable: true } });
    queue.add('a', [photo('1.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'done');
    expect(gateway.uploadItem).toHaveBeenCalledTimes(2);
  });

  it('polls while the file is processing', async () => {
    const items: Partial<AlbumItem>[] = [{ id: 'i', status: 'processing' }];
    const { queue, onSettled, states } = setup({
      uploadItem: vi.fn(async () => ({ ok: true, value: { itemId: 'i' } }) as const),
      getAlbum: vi.fn(async () => ({ ok: true as const, value: { album: {}, items } })),
    });
    queue.add('a', [photo('1.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'processing');
    await tick();
    expect(states()).toEqual(['processing']);
    items[0].status = 'ready';
    await until(() => states()[0] === 'done');
    expect(onSettled).toHaveBeenCalledWith('a');
  });

  it('cancel stops what is running and returns it to the staged list', async () => {
    const signals: AbortSignal[] = [];
    const { queue, states } = setup({
      uploadItem: vi.fn((_album: string, _file: File, options: UploadOptions) => new Promise<Result<{ itemId: string }>>((resolve) => {
        signals.push(options.signal!);
        options.onReserved?.();
        options.signal!.addEventListener('abort', () => resolve({ ok: false, error: { code: 'OFFLINE', message: '送信を止めました。', retryable: true } }));
      })),
    });
    queue.add('a', ['1', '2', '3', '4'].map((name) => photo(`${name}.jpg`)));
    queue.start('a', false);
    await tick();
    queue.cancel('a');
    await tick();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(states()).toEqual(['staged', 'staged', 'staged', 'staged']);
  });

  it('keeps refused files listed with the reason and never sends them', async () => {
    const { queue, gateway, states } = setup();
    queue.add('a', [new File(['x'], 'a.heic', { type: 'image/heic' })]);
    queue.start('a', false);
    await tick();
    expect(states()).toEqual(['rejected']);
    expect(queue.getEntries()[0].message).toBe(HEIC_MESSAGE);
    expect(gateway.uploadItem).not.toHaveBeenCalled();
  });

  it('fills in a missing type so a video is treated as a video', () => {
    const { queue } = setup();
    queue.add('a', [new File(['x'], 'a.mov', { type: '' })]);
    expect(queue.getEntries()[0].file.type).toBe('video/quicktime');
  });

  it('makes a thumbnail for a video, and a failure to make one does not block the upload', async () => {
    const { queue, makeThumbnail, states, uploads } = setup();
    makeThumbnail.mockRejectedValueOnce(new Error('no codec'));
    queue.add('a', [video('broken.mp4'), photo('1.jpg')]);
    queue.start('a', false);
    await until(() => states().every((state) => state === 'done'));
    expect(makeThumbnail).toHaveBeenCalledTimes(1);
    expect(uploads().find((call) => call[1].name === 'broken.mp4')?.[2].thumbnail).toBeUndefined();
  });

  it('gives up the slot when a failed file is removed', async () => {
    const { queue, gateway, states } = setup();
    gateway.uploadItem.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: '接続できません。', retryable: true } });
    queue.add('a', [photo('1.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'failed');
    queue.remove(queue.getEntries()[0].key);
    expect(gateway.cancelUpload).toHaveBeenCalledTimes(1);
    expect(states()).toEqual([]);
  });

  it('clears finished files only', async () => {
    const { queue, states } = setup();
    queue.add('a', [photo('1.jpg')]);
    queue.start('a', false);
    await until(() => states()[0] === 'done');
    queue.add('a', [photo('2.jpg')]);
    queue.clearFinished('a');
    expect(states()).toEqual(['staged']);
  });
});
