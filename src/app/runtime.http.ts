import { createHttpGateway } from '../data/httpGateway';
import type { CsrfProvider } from '../data/httpGateway';
import type { HouseholdSnapshot } from '../domain/types';
import type { AppRuntime } from './runtime';
import { bootFetch, takeBootPrefetch } from './bootFetch';

const empty: HouseholdSnapshot = {
  viewer: { userId: '', membershipId: '', role: 'guest', status: 'invited', capabilities: [], permissionRevision: 0 },
  permissionOverrides: [], user: { id: '', displayName: '', email: '', avatarTone: 'indigo' },
  household: { id: '', name: '', timezone: 'Asia/Tokyo' },
  memberships: [], events: [], todos: [], memos: [], expenses: [], settlementBatches: [], resources: [], links: [], colorLabels: [],
  context: { asOf: new Date().toISOString(), timezone: 'Asia/Tokyo', weather: { location: '', condition: 'sunny', temperatureC: 0, precipitationPercent: 0 }, holidays: [], sync: { state: 'syncing', lastSyncedAt: new Date().toISOString() } },
};

export function createHttpRuntime(): AppRuntime {
  let token: string | undefined;
  let revision: number | undefined;
  // CSRF トークンはメモリにだけ置く。
  const csrf: CsrfProvider = async (refresh) => {
    if (token && !refresh) return token;
    const response = await fetch('/v1/auth/csrf', { credentials: 'include', headers: { Accept: 'application/json' } });
    token = (await response.json() as { token: string }).token;
    return token;
  };
  return {
    mode: 'http', actorId: '', initialSnapshot: empty, initialSession: null,
    // <head> の先読み（bootPrefetch.ts）で取ったセッションと家族の記録を、最初の1回だけ使う。
    gateway: createHttpGateway(window.location.origin, csrf, () => revision, bootFetch(takeBootPrefetch(), window.location.origin)),
    setPermissionRevision: (next) => { revision = next > 0 ? next : undefined; },
  };
}
