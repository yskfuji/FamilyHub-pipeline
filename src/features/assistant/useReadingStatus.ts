import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import type { AssistantStatus } from '../../domain/assistant';

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
