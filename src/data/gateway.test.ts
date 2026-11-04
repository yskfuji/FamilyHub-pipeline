import { describe, expect, it, vi } from 'vitest';
import { runGatewaySuite } from './gateway.suite';
import { createHttpGateway } from './httpGateway';
import { createMockGateway } from './mockGateway';
import clipBytes from './samples/sample-clip.mp4?inline';
import noticeBytes from './samples/sample-notice.pdf?inline';
import photoBytes from './samples/sample-photo.jpg?inline';
import { sampleAttachmentUrls } from './sampleAttachments';

/** ?inline の data: URL を、元のバイト列に戻す。 */
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (character) => character.charCodeAt(0));
const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

runGatewaySuite(createMockGateway);

describe('mock gateway only', () => {
  it('opens sample files of the same type for attachments, from the same origin (A14-4)', async () => {
    const gateway = createMockGateway();
    const opened = async (memoId: string, attachmentId: string, type: string, disposition?: 'inline' | 'attachment') => {
      const link = await gateway.memos.getAttachmentLink(memoId, attachmentId, disposition);
      if (!link.ok) throw new Error(link.error.message);
      // 同じオリジンのファイル（blob: や data: ではない）。PDF の表示も connect-src 'self' のまま読める。
      expect(link.value.url).toMatch(/^\/[^/]/);
      expect(link.value.url).toBe(sampleAttachmentUrls[type]);
      expect(Date.parse(link.value.expiresAt)).toBeGreaterThan(Date.parse('2026-09-30T07:45:00+09:00'));
    };
    await opened('memo-school', 'attachment-school', 'application/pdf', 'inline');
    await opened('memo-receipt', 'attachment-receipt-photo', 'image/jpeg', 'inline');
    await opened('memo-receipt', 'attachment-receipt-clip', 'video/mp4');
    const pdf = latin1(bytesOf(noticeBytes));
    expect(pdf.startsWith('%PDF-')).toBe(true);
    // 日本語の文字を、埋め込まない CID の書体と CMap で書いた見本（表示する側が CMap を読む）。
    expect(pdf).toContain('/Encoding /UniJIS-UCS2-H');
    expect(pdf).toContain('/Ordering (Japan1)');
    expect(pdf).not.toContain('/FontFile');
    expect([...bytesOf(photoBytes).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(latin1(bytesOf(clipBytes).subarray(4, 8))).toBe('ftyp');
    // 確認が終わっていない添付は開けない。
    expect(await gateway.memos.getAttachmentLink('memo-receipt', 'attachment-receipt', 'inline')).toMatchObject({ ok: false });
  });

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
