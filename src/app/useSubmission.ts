import { useRef, useState } from 'react';

/**
 * 送信中の印と、開いているフォームに1つの冪等キー（段階12。計画 C「失敗に強く、間違えにくい作り」）。
 * - start は同じフレームの二度押しも止める（状態の更新を待たずに ref で判定する）。送っている間はボタンを押せなくする。
 * - キーはフォームを開いている間ずっと同じ。API とモックは成功した結果だけを覚えるので、失敗の後に内容を直して送り直してもよく、
 *   応答だけが届かなかった送り直しは前の結果を返し、記録は増えない。
 */
export function useSubmission() {
  const sending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return {
    submitting,
    idempotencyKey,
    /** 送り始める。すでに送っているときは false を返し、何もしない。 */
    start: () => {
      if (sending.current) return false;
      sending.current = true;
      setSubmitting(true);
      return true;
    },
    /** 送り終えた（成功・失敗のどちらでも）。 */
    end: () => {
      sending.current = false;
      setSubmitting(false);
    },
  };
}
