import { describe, expect, it } from 'vitest';
import { createMockGateway } from '../data/mockGateway';
import { ATTACHMENT_DOCUMENT_MAX_BYTES, ATTACHMENT_VIDEO_MAX_BYTES, attachmentProblem, formatFileSize } from './memoAttachments';

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe('attachment limits', () => {
  it('accepts images, PDF and MP4 up to their limits', () => {
    expect(attachmentProblem(file('a.pdf', 'application/pdf', ATTACHMENT_DOCUMENT_MAX_BYTES))).toBeNull();
    expect(attachmentProblem(file('a.jpg', 'image/jpeg', 1))).toBeNull();
    expect(attachmentProblem(file('a.png', 'image/png', 1))).toBeNull();
    expect(attachmentProblem(file('a.mp4', 'video/mp4', ATTACHMENT_VIDEO_MAX_BYTES))).toBeNull();
  });

  it('explains what is wrong with anything else', () => {
    expect(attachmentProblem(file('a.pdf', 'application/pdf', ATTACHMENT_DOCUMENT_MAX_BYTES + 1))).toContain('10MB');
    expect(attachmentProblem(file('a.mp4', 'video/mp4', ATTACHMENT_VIDEO_MAX_BYTES + 1))).toContain('120MB');
    expect(attachmentProblem(file('a.heic', 'image/heic', 1))).toContain('PDF');
    expect(attachmentProblem(file('a.exe', '', 1))).toContain('PDF');
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(attachmentProblem(file('動画.MP4', '', ATTACHMENT_DOCUMENT_MAX_BYTES + 1))).toBeNull();
  });

  it('agrees with the rule at the limits', async () => {
    const upload = (name: string, type: string, size: number) => createMockGateway().memos.uploadAttachment('memo-school', file(name, type, size) as File);
    expect((await upload('a.pdf', 'application/pdf', ATTACHMENT_DOCUMENT_MAX_BYTES)).ok).toBe(true);
    expect((await upload('a.pdf', 'application/pdf', ATTACHMENT_DOCUMENT_MAX_BYTES + 1)).ok).toBe(false);
    expect((await upload('a.mp4', 'video/mp4', ATTACHMENT_VIDEO_MAX_BYTES)).ok).toBe(true);
    expect((await upload('a.mp4', 'video/mp4', ATTACHMENT_VIDEO_MAX_BYTES + 1)).ok).toBe(false);
  });

  it('formats sizes', () => {
    expect(formatFileSize(842_310)).toBe('842 KB');
    expect(formatFileSize(1_284_300)).toBe('1.3 MB');
    expect(formatFileSize(12)).toBe('1 KB');
  });
});
