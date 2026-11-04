import { describe, expect, it } from 'vitest';
import { viewerKindOf } from './attachmentKinds';
import { PDF_RESOURCES, documentOptions, safeLinkUrl } from './pdfOptions';

describe('opening attachments inside the app (A14)', () => {
  it('shows only the types the API serves inline, and offers saving for the rest', () => {
    expect(['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'].map(viewerKindOf)).toEqual(['image', 'image', 'video', 'pdf']);
    for (const other of ['video/quicktime', 'image/heic', 'text/html', 'application/octet-stream', '']) expect(viewerKindOf(other)).toBe('other');
  });

  it('reads CMaps and standard fonts from the same origin, without eval or WebAssembly', () => {
    const options = documentOptions(new Uint8Array([37, 80, 68, 70]), 'https://hub.example.test');
    expect(PDF_RESOURCES).toBe('/pdfjs/');
    expect(options).toMatchObject({ cMapUrl: 'https://hub.example.test/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: 'https://hub.example.test/pdfjs/standard_fonts/', useWasm: false, isEvalSupported: false, enableXfa: false });
  });

  it('opens only http and https links found in a PDF', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLinkUrl('http://example.com/')).toBe('http://example.com/');
    for (const unsafe of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'mailto:a@example.com', 'not a url', undefined, 42]) expect(safeLinkUrl(unsafe)).toBeNull();
  });
});
