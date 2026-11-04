import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { attachmentProblem } from '../../domain/memoAttachments';
import type { Id } from '../../domain/types';

export interface QueuedFile {
  /** 送り直しでも変えない。応答だけが届かなかったときに、添付が2つにならないようにする。 */
  key: string;
  memoId: Id;
  file: File;
  state: 'waiting' | 'sending' | 'failed';
  message?: string;
  retryable: boolean;
}

export interface AttachmentQueue {
  items: QueuedFile[];
  add: (memoId: Id, files: readonly File[]) => void;
  retry: (key: string) => void;
  discard: (key: string) => void;
}

const CHECK_POLL_MS = 2500;
const CHECK_POLLS = 12;

/**
 * 添付の送信の待ち行列。メモの一覧の画面が持つので、詳細を閉じても残る。
 * 失敗したファイルはメモとは別に残るので、送り直してもメモは増えない。
 */
export function useAttachmentQueue(): AttachmentQueue {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [items, setItems] = useState<QueuedFile[]>([]);
  const [watch, setWatch] = useState<{ memoIds: Id[]; polls: number }>({ memoIds: [], polls: 0 });
  const waiting = useRef<QueuedFile[]>([]);
  const sending = useRef(false);
  const update = (key: string, changes: Partial<QueuedFile>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    for (let item = waiting.current.shift(); item; item = waiting.current.shift()) {
      const { key, memoId, file } = item;
      update(key, { state: 'sending', message: undefined });
      const result = await gateway.memos.uploadAttachment(memoId, file, key);
      if (!result.ok) { update(key, { state: 'failed', message: result.error.message, retryable: result.error.retryable }); continue; }
      setItems((current) => current.filter((entry) => entry.key !== key));
      setWatch((current) => ({ memoIds: [...new Set([...current.memoIds, memoId])], polls: CHECK_POLLS }));
      await refresh();
      announce('ファイルを受け付けました。確認が終わるまで開けません。');
    }
    sending.current = false;
  };

  const add = (memoId: Id, files: readonly File[]) => {
    const added = files.map((file): QueuedFile => {
      const problem = attachmentProblem(file);
      return { key: crypto.randomUUID(), memoId, file, state: problem ? 'failed' : 'waiting', message: problem ?? undefined, retryable: !problem };
    });
    setItems((current) => [...current, ...added]);
    waiting.current.push(...added.filter((item) => item.state === 'waiting'));
    void send();
  };

  const retry = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item || item.state !== 'failed' || !item.retryable) return;
    update(key, { state: 'waiting', message: undefined });
    waiting.current.push(item);
    void send();
  };

  const discard = (key: string) => setItems((current) => current.filter((item) => item.key !== key));

  // 確認の結果を待つあいだ、読み直して表示を進める。
  const checking = snapshot.memos.some((memo) => watch.memoIds.includes(memo.id) && memo.attachments.some((attachment) => attachment.status === 'quarantined'));
  useEffect(() => {
    if (!checking || watch.polls <= 0) return;
    const timer = window.setTimeout(() => {
      setWatch((current) => ({ ...current, polls: current.polls - 1 }));
      void refresh();
    }, CHECK_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [checking, watch.polls, refresh]);

  return { items, add, retry, discard };
}
