import { useEffect, useState } from 'react';
import { isNewerBuild } from '../domain/buildVersion';
import { useApp } from './AppContext';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** 開いている画面より新しい版が配信されていたら true。確認用データでは常に false。 */
export function useNewVersion() {
  const { gateway, runtimeMode } = useApp();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (runtimeMode !== 'http' || available) return;
    let active = true;
    const check = async () => {
      const result = await gateway.auth.getVersion();
      if (active && result.ok && isNewerBuild(import.meta.env.VITE_BUILD_ID, result.value.build)) setAvailable(true);
    };
    const whenShown = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    window.addEventListener('focus', whenShown);
    document.addEventListener('visibilitychange', whenShown);
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.removeEventListener('focus', whenShown);
      document.removeEventListener('visibilitychange', whenShown);
      window.clearInterval(timer);
    };
  }, [available, gateway, runtimeMode]);
  return available;
}
