import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { READING_POLL_INTERVAL_MS, READING_WAIT_MS } from '../../domain/assistant';
import type { AssistantJob, AssistantStatus } from '../../domain/assistant';
import type { GatewayError, Result } from '../../domain/types';

const waitedTooLong: GatewayError = { code: 'UPSTREAM_FAILURE', message: '時間内に読み取れませんでした。少し待ってからお試しください。', retryable: true };

/** 読み取りの補助の状態。使えないときや確かめられないときは null のままにして、画面に出さない。 */
export function useReadingStatus(): AssistantStatus | null {
  const { gateway } = useApp();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    void gateway.assistant.getStatus().then((result) => { if (mounted && result.ok && result.value.available) setStatus(result.value); });
    return () => { mounted = false; };
  }, [gateway]);
  return status;
}

/** 仕事を始めて、終わるまで問い合わせる。閉じたら問い合わせをやめる。結果は提案で、保存はしない。 */
export function useReadingJob() {
  const { gateway } = useApp();
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);
  useEffect(() => { stopped.current = false; return () => { stopped.current = true; }; }, []);

  const run = useCallback(async (start: () => Promise<Result<AssistantJob>>): Promise<Result<AssistantJob> | null> => {
    setBusy(true);
    try {
      const started = await start();
      if (!started.ok) return started;
      const deadline = Date.now() + READING_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => { setTimeout(resolve, READING_POLL_INTERVAL_MS); });
        if (stopped.current) return null;
        const job = await gateway.assistant.getJob(started.value.id);
        if (!job.ok) return job;
        if (job.value.status === 'done') return job;
        if (job.value.status === 'failed') return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: job.value.message ?? waitedTooLong.message, retryable: true } };
      }
      return { ok: false, error: waitedTooLong };
    } finally {
      if (!stopped.current) setBusy(false);
    }
  }, [gateway]);

  return { busy, run };
}
