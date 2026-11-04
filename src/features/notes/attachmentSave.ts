import { useApp } from '../../app/AppContext';
import { attachmentViewerCopy } from '../../content/ja';
import type { Attachment, Memo } from '../../domain/types';
import { saveFile } from '../albums/saveFile';

/** 保存は開くのとは別のリンク（?download=1）で行う。新しい窓は開かず、ブラウザの保存に渡す。 */
export function useSaveAttachment(memo: Memo, attachment: Attachment) {
  const { gateway, announce } = useApp();
  return async () => {
    const result = await gateway.memos.getAttachmentLink(memo.id, attachment.id, 'attachment');
    if (!result.ok) { announce(result.error.message); return; }
    saveFile(result.value.url, attachment.originalName);
    announce(attachmentViewerCopy.saving);
  };
}

