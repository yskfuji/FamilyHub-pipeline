import { useEffect, useState } from 'react';

const IDLE_MS = 3500;
const INPUTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/** 全画面の操作の表示。入力がなくなって少し経つと隠し、何か入力があれば戻す。 */
export function useIdleControls(keepVisible: boolean) {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let timer = window.setTimeout(() => setAwake(false), IDLE_MS);
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), IDLE_MS);
    };
    for (const input of INPUTS) window.addEventListener(input, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const input of INPUTS) window.removeEventListener(input, wake);
    };
  }, []);
  return awake || keepVisible;
}
