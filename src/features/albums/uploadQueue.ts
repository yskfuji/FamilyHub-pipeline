import { DUPLICATE_ITEM_MESSAGE, isDuplicateItem } from '../../domain/albumView';
import { albumFileProblem, albumFileType, moveStaged, nextToSend } from '../../domain/albumUpload';
import type { UploadEntry } from '../../domain/albumUpload';
import type { Id } from '../../domain/types';
import type { AlbumPort } from '../../data/gateway';

const PROCESSING_LIMIT_MS = 15 * 60_000;
const RATE_LIMIT_ATTEMPTS = 40;

export interface UploadQueueOptions {
  gateway: Pick<AlbumPort, 'uploadItem' | 'getAlbum' | 'cancelUpload'>;
  makeThumbnail(file: File): Promise<Blob | null>;
  /** ファイルの処理が終わるたびに呼ぶ。 */
  onSettled(albumId: Id): void;
  pollMs?: number;
  rateLimitWaitMs?: number;
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/** 種類が空のファイルは、拡張子から種類を補う。受け取る側は種類で写真と動画の上限を分ける。 */
const withType = (file: File) => (file.type ? file : new File([file], file.name, { type: albumFileType(file), lastModified: file.lastModified }));

/**
 * アルバムへの送信の待ち行列。画面の部品から切り離し、閉じた後も送信を続ける。
 * 受け取った後の処理が終わるまでを1件と数え、同時に3件を超えない。
 */
export function createUploadQueue({ gateway, makeThumbnail, onSettled, pollMs = 1000, rateLimitWaitMs = 2000 }: UploadQueueOptions) {
  let entries: UploadEntry[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reserving: string | null = null;
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();

  const set = (next: UploadEntry[]) => { entries = next; listeners.forEach((listener) => listener()); };
  const patch = (key: string, changes: Partial<UploadEntry>) => set(entries.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));

  const schedulePoll = (delay = pollMs) => {
    if (pollTimer === null) pollTimer = setTimeout(() => { pollTimer = null; void poll(); }, delay);
  };

  /** 枠を受け取るまでは次を始めない。並べた順のままアルバムへ入るようにする。 */
  const pump = () => {
    if (reserving !== null) return;
    const [next] = nextToSend(entries);
    if (!next) return;
    reserving = next.key;
    void send(next);
  };
  const reserved = (key: string) => {
    if (reserving !== key) return;
    reserving = null;
    pump();
  };

  async function send(entry: UploadEntry) {
    const { key, albumId, file, keepLocation } = entry;
    const controller = new AbortController();
    controllers.set(key, controller);
    patch(key, { state: 'sending', sentBytes: 0, message: undefined });
    const thumbnail = file.type.startsWith('video/') ? await makeThumbnail(file).catch(() => null) : null;
    for (let attempt = 0; ; attempt += 1) {
      if (controller.signal.aborted) { reserved(key); return; }
      const result = await gateway.uploadItem(albumId, file, { keepLocation, ...(thumbnail ? { thumbnail } : {}), signal: controller.signal, onReserved: () => reserved(key), onProgress: (sentBytes) => patch(key, { sentBytes }) });
      if (controller.signal.aborted) { reserved(key); return; }
      if (result.ok) {
        controllers.delete(key);
        patch(key, { state: 'processing', sentBytes: file.size, itemId: result.value.itemId, processingSince: Date.now() });
        reserved(key);
        schedulePoll(0);
        return;
      }
      // ほかのタブや処理中の分で枠が埋まっているときは、空くのを待つ。
      if (result.error.code === 'RATE_LIMITED' && attempt < RATE_LIMIT_ATTEMPTS) { await pause(rateLimitWaitMs, controller.signal); continue; }
      controllers.delete(key);
      patch(key, { state: 'failed', message: result.error.message, retryable: result.error.retryable });
      reserved(key);
      pump();
      return;
    }
  }

  async function poll() {
    const processing = entries.filter((entry) => entry.state === 'processing');
    for (const albumId of new Set(processing.map((entry) => entry.albumId))) {
      const result = await gateway.getAlbum(albumId);
      if (!result.ok) continue;
      let settled = false;
      for (const entry of processing.filter((candidate) => candidate.albumId === albumId)) {
        const item = result.value.items.find((candidate) => candidate.id === entry.itemId);
        if (item?.status === 'ready') { patch(entry.key, { state: 'done' }); settled = true; }
        else if (item && isDuplicateItem(item)) { patch(entry.key, { state: 'duplicate', message: DUPLICATE_ITEM_MESSAGE }); settled = true; }
        else if (item?.status === 'rejected') { patch(entry.key, { state: 'rejected', message: item.statusMessage ?? 'このファイルは保存できませんでした。', retryable: false }); settled = true; }
        else if (!item) { patch(entry.key, { state: 'failed', message: 'このファイルは保存できませんでした。', retryable: true }); settled = true; }
      }
      if (settled) onSettled(albumId);
    }
    for (const entry of entries) {
      if (entry.state === 'processing' && Date.now() - (entry.processingSince ?? 0) > PROCESSING_LIMIT_MS) patch(entry.key, { state: 'failed', message: '確認に時間がかかっています。しばらくしてからアルバムを開き直してください。', retryable: false });
    }
    pump();
    if (entries.some((entry) => entry.state === 'processing')) schedulePoll();
  }

  return {
    getEntries: () => entries,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** 選んだファイルを待ち行列に置く。送らないファイルは理由と一緒に残す。 */
    add(albumId: Id, files: readonly File[]) {
      set([...entries, ...files.map((file): UploadEntry => {
        const problem = albumFileProblem(file);
        return { key: crypto.randomUUID(), albumId, file: problem ? file : withType(file), keepLocation: false, state: problem ? 'rejected' : 'staged', sentBytes: 0, retryable: false, ...(problem ? { message: problem } : {}) };
      })]);
    },
    move(key: string, step: -1 | 1) { set(moveStaged(entries, key, step)); },
    start(albumId: Id, keepLocation: boolean) {
      set(entries.map((entry) => (entry.albumId === albumId && entry.state === 'staged' ? { ...entry, state: 'waiting', keepLocation } : entry)));
      pump();
    },
    retry(key: string) {
      const entry = entries.find((candidate) => candidate.key === key);
      if (entry?.state !== 'failed' || !entry.retryable) return;
      patch(key, { state: 'waiting', message: undefined });
      pump();
    },
    /** 送っている途中の分を止め、送る前の状態へ戻す。受け取り済みの分は止められない。 */
    cancel(albumId: Id) {
      set(entries.map((entry) => (entry.albumId === albumId && (entry.state === 'waiting' || entry.state === 'sending') ? { ...entry, state: 'staged', sentBytes: 0 } : entry)));
      for (const [key, controller] of controllers) {
        if (entries.some((entry) => entry.key === key && entry.albumId === albumId)) { controller.abort(); controllers.delete(key); }
      }
      pump();
    },
    remove(key: string) {
      const entry = entries.find((candidate) => candidate.key === key);
      if (!entry || ['waiting', 'sending', 'processing'].includes(entry.state)) return;
      set(entries.filter((candidate) => candidate !== entry));
      if (entry.state === 'failed') void gateway.cancelUpload(entry.file);
    },
    clearFinished(albumId: Id) { set(entries.filter((entry) => entry.albumId !== albumId || !['done', 'duplicate'].includes(entry.state))); },
    /** 画面を離れるとき。止めた分の枠も手放す。 */
    dispose() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      reserving = null;
      set([]);
    },
  };
}
