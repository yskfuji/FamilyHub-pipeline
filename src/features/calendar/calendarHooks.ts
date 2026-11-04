import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BOTTOM_NAV_QUERY as NARROW_QUERY } from '../../design-system/sizeClass';
import { minutesOfDay } from '../../domain/calendarLayout';

/** 狭い幅かどうか（下のナビがある幅）。global.css の `(width < 42.7rem)` の切り替えと同じ条件。 */
export function useIsNarrow() {
  return useSyncExternalStore((notify) => {
    const media = window.matchMedia(NARROW_QUERY);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  }, () => window.matchMedia(NARROW_QUERY).matches);
}

/** 今の時刻（分）。基準は画面の基準時刻で、開いている間は実際の経過の分だけ進める。 */
export function useNowMinutes(asOf: string) {
  const [elapsed, setElapsed] = useState(0);
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - openedAt.current), 60_000);
    return () => window.clearInterval(timer);
  }, [asOf]);
  return minutesOfDay(new Date(Date.parse(asOf) + elapsed).toISOString());
}

/** 目印が画面に近づいたら onReach を呼ぶ。呼んだ結果で key が変わると、まだ近ければ続けて呼ぶ。 */
export function useReachedEnd(enabled: boolean, key: string, onReach: () => void) {
  const marker = useRef<HTMLDivElement>(null);
  const reach = useRef(onReach);
  useEffect(() => { reach.current = onReach; });
  useEffect(() => {
    if (!enabled || !marker.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) reach.current(); }, { rootMargin: '400px 0px' });
    observer.observe(marker.current);
    return () => observer.disconnect();
  }, [enabled, key]);
  return marker;
}
