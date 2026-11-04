import { addDateKeyDays, dateKeyFromRfc3339 } from './calendarDate';
import { auditGroups } from './auditLog';
import type { AuditQuery, AuditTarget } from './auditLog';
import type { Id, IsoDate } from './types';

/**
 * 設定の「変更の記録」（A5-8）の見せ方。絞り込みは URL のクエリに持ち、共有や戻るで同じ表示に戻れるようにする。
 * view=mine は自分のアカウントの記録（サインインやパスワードの変更など）。
 */
export const AUDIT_PAGE_SIZE = 20;
export const auditPeriods = ['all', 'today', 'week', 'month'] as const;
export type AuditPeriod = (typeof auditPeriods)[number];
export type AuditGroupKey = (typeof auditGroups)[number];

export interface AuditFilters {
  view: 'household' | 'mine';
  membershipId: Id | null;
  group: AuditGroupKey | null;
  period: AuditPeriod;
}

/** URL のクエリから絞り込みを読む。知らない値は無視して「すべて」にする。人は今の家族のメンバーだけを受け付ける。 */
export function readAuditFilters(search: string, memberIds: readonly Id[]): AuditFilters {
  const params = new URLSearchParams(search);
  const who = params.get('who');
  const kind = params.get('kind');
  const period = params.get('period');
  return {
    view: params.get('view') === 'mine' ? 'mine' : 'household',
    membershipId: who && memberIds.includes(who) ? who : null,
    group: kind && (auditGroups as readonly string[]).includes(kind) ? kind as AuditGroupKey : null,
    period: period && (auditPeriods as readonly string[]).includes(period) ? period as AuditPeriod : 'all',
  };
}

/** 絞り込みを URL のクエリにする（先頭の ? を含む。何もなければ空）。自分の記録では家族の絞り込みを持たない。 */
export function auditSearch(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.view === 'mine') params.set('view', 'mine');
  else {
    if (filters.membershipId) params.set('who', filters.membershipId);
    if (filters.group) params.set('kind', filters.group);
    if (filters.period !== 'all') params.set('period', filters.period);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** 期間を日付の範囲にする。today は家族の時間帯での今日（asOf の日付）。範囲は両端を含む。 */
export function periodRange(period: AuditPeriod, today: string): Pick<AuditQuery, 'from' | 'to'> {
  if (period === 'all') return {};
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  return { from: addDateKeyDays(today, -(days - 1)) as IsoDate, to: today as IsoDate };
}

/** 一覧の条件。cursor は前のページの nextCursor。 */
export function auditQueryFor(filters: AuditFilters, asOf: string, cursor?: string): AuditQuery {
  return {
    limit: AUDIT_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(filters.membershipId ? { membershipId: filters.membershipId } : {}),
    ...(filters.group ? { group: filters.group } : {}),
    ...periodRange(filters.period, dateKeyFromRfc3339(asOf)),
  };
}

/** 新しい順の記録を、日付（記録の時刻を書いた時差での日付）ごとにまとめる。順は変えない。 */
export function groupByDay<T extends { at: string }>(items: readonly T[]): Array<{ day: string; items: T[] }> {
  const days: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const day = item.at.slice(0, 10);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item); else days.push({ day, items: [item] });
  }
  return days;
}

/** 見られる対象の画面。伏せた対象（hidden）と、開く画面のない対象は null。 */
export function auditTargetHref(target: AuditTarget | null): string | null {
  if (!target || target.hidden || !target.id) return null;
  const id = encodeURIComponent(target.id);
  switch (target.kind) {
    case 'event': return `/calendar/${id}`;
    case 'task': return `/tasks/${id}`;
    case 'memo': return `/notes/${id}`;
    case 'expense': return `/budget/${id}`;
    case 'settlementBatch': return '/budget?view=settlements';
    case 'album': return `/albums/${id}`;
    case 'member': case 'invite': case 'colorLabel': return '/settings/household';
    default: return null;
  }
}
