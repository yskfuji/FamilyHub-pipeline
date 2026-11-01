import { describe, expect, it, vi } from 'vitest';
import { runGatewaySuite } from './gateway.suite';
import { createHttpGateway } from './httpGateway';
import { createMockGateway } from './mockGateway';

runGatewaySuite(createMockGateway);

describe('mock gateway only', () => {
  it('completes passkey sign-in only for the issued challenge', async () => {
    const gateway = createMockGateway();
    const begun = await gateway.auth.beginPasskey();
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(await gateway.auth.finishPasskey('other', { demo: true })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await gateway.auth.finishPasskey(begun.value.challengeId, { demo: true })).toMatchObject({ ok: true });
  });
});

describe('HTTP gateway', () => {
  it('treats 204 as success without attempting JSON parsing', async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true, headers: new Headers(), json });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.invalid', () => 'x'.repeat(32), () => 1);
    await expect(gateway.auth.signOut()).resolves.toEqual({ ok: true, value: undefined });
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: 'include', method: 'DELETE', headers: expect.objectContaining({ 'X-CSRF-Token': 'x'.repeat(32) }) }));
    vi.unstubAllGlobals();
  });

  it('sends idempotency and permission revision headers for queueable mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true, headers: new Headers(), json: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.invalid', () => 'csrf-token', () => 5);
    await gateway.events.updateEvent('event-school', 'this', { title: '更新' }, 1, { idempotencyKey: 'operation-1', expectedPermissionRevision: 7 });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Idempotency-Key': 'operation-1', 'If-Permission-Revision': '7', 'X-CSRF-Token': 'csrf-token' }),
    }));
    vi.unstubAllGlobals();
  });

  it('reads privacy settings with a plain GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.test', () => 'csrf', () => 1);
    expect(await gateway.household.getPrivacySettings()).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.example.test/v1/households/current/privacy');
    expect(init.method ?? 'GET').toBe('GET');
    vi.unstubAllGlobals();
  });
});
