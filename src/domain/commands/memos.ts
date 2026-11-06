import type { MemoPort } from '../../data/gateway';
import { authorizeVisibleResource, canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { memoInputSchema } from '../schemas';
import type { Attachment, Id, Memo, Result } from '../types';
import { applyPatch, archive, denied, invalid, missing, ok, fail, archivedRecord } from './context';
import type { CommandContext, SyncPort } from './context';

type RuleMemoPort = SyncPort<Omit<MemoPort, 'uploadAttachment' | 'getAttachmentLink'>> & {
  /** 添付の受け付け。形式と大きさと権限を確かめ、確認待ちとして記録する。ファイルの保存は呼び出し側が行う。 */
  acceptAttachment(memoId: Id, file: { originalName: string; mimeType: string; byteSize: number }): Result<Attachment>;
  finishAttachmentCheck(memoId: Id, attachmentId: Id, status: 'clean' | 'rejected'): void;
  /** 開いてよい添付だけを返す。リンクの発行は呼び出し側が行う。 */
  readableAttachment(memoId: Id, attachmentId: Id): Result<Attachment>;
};

export function createMemoCommands(c: CommandContext): RuleMemoPort {
  const { a, state, nextId, now, viewer, requireCapability, offlineFailure, permissionConflict, visible, placeWriteGuard, withinRestoreWindow, defaultVisibility, resolveVisibility } = c;
  const seen = (item: Memo) => authorizeVisibleResource(viewer(), 'memo.read', item.visibility, [item.authorMembershipId]).allowed;
  return {
    createMemo(input, context) {
      const revision = permissionConflict<Memo>(context); if (revision) return revision;
      const guard = requireCapability<Memo>('memo.create'); if (guard) return guard;
      const placeGuard = placeWriteGuard<Memo>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Memo>(); if (network) return network;
      const parsed = memoInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { place, memoDate, ocrText, visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, viewer().membershipId) : ok(defaultVisibility());
      if (!visibility.ok) return visibility;
      const memo: Memo = { id: nextId('memo'), householdId: state.household.id, ...fields, ...(place ? { place } : {}), ...(memoDate ? { memoDate: memoDate as Memo['memoDate'] } : {}), ...(ocrText ? { ocrText } : {}), updatedAt: now(), authorMembershipId: viewer().membershipId, attachments: [], visibility: visibility.value, version: 1 };
      state.memos = [memo, ...state.memos];
      return ok(visible(memo));
    },
    updateMemo(id, input, expectedVersion, context) {
      const target = state.memos.find((item) => item.id === id && !item.deletedAt); if (!target || !seen(target)) return missing('メモ');
      const revision = permissionConflict<Memo>(context); if (revision) return revision;
      const decision = canMutateOwnedResource(viewer(), 'memo.update', target.authorMembershipId); if (!decision.allowed) return denied(decision);
      const placeGuard = placeWriteGuard<Memo>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Memo>(); if (network) return network;
      if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末でメモが更新されています。', retryable: true, reason: 'VERSION' });
      const parsed = memoInputSchema.partial().safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, target.visibility.creatorMembershipId) : null;
      if (visibility && !visibility.ok) return visibility;
      applyPatch(target, fields);
      if (visibility?.ok) target.visibility = visibility.value;
      target.version += 1; target.updatedAt = now(); return ok(visible(target));
    },
    acceptAttachment(memoId, file) {
      const target = state.memos.find((memo) => memo.id === memoId && !memo.deletedAt);
      if (!target || !seen(target)) return missing('メモ');
      const decision = canMutateOwnedResource(viewer(), 'memo.attach', target.authorMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<Attachment>(); if (network) return network;
      const video = ['video/mp4', 'video/quicktime'].includes(file.mimeType);
      if (!video && !['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimeType)) return fail({ code: 'ATTACHMENT_REJECTED', message: '形式が許可範囲外です。PDF・JPEG・PNG・MP4にしてください。', retryable: false });
      if (file.byteSize > (video ? 120_000_000 : 10_000_000)) return fail({ code: 'ATTACHMENT_REJECTED', message: video ? '動画は120MB以内にしてください。' : 'サイズが許可範囲外です。10MB以内にしてください。', retryable: false });
      const used = state.memos.flatMap((memo) => memo.attachments).reduce((sum, item) => sum + item.byteSize, 0);
      if (used + file.byteSize > 1024 * 1024 * 1024) return fail({ code: 'ATTACHMENT_REJECTED', message: '添付の保存容量を超えます。不要な添付を削除してください。', retryable: false });
      const attachment: Attachment = { id: nextId('attachment'), memoId, originalName: file.originalName, mimeType: file.mimeType, byteSize: file.byteSize, status: 'quarantined', statusMessage: 'ファイルを確認しています。完了するまで開けません' };
      target.attachments.push(attachment);
      return ok(structuredClone(attachment));
    },
    finishAttachmentCheck(memoId, attachmentId, status) {
      const attachment = state.memos.find((memo) => memo.id === memoId)?.attachments.find((item) => item.id === attachmentId);
      if (attachment?.status !== 'quarantined') return;
      Object.assign(attachment, status === 'clean'
        ? { status, statusMessage: '確認が終わり、開ける状態です' }
        : { status, statusMessage: '安全を確認できなかったため、開けません' });
    },
    deleteAttachment(memoId, attachmentId) {
      const target = state.memos.find((memo) => memo.id === memoId && !memo.deletedAt);
      if (!target || !seen(target)) return missing('メモ');
      const decision = canMutateOwnedResource(viewer(), 'memo.attach', target.authorMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      if (!target.attachments.some((item) => item.id === attachmentId)) return missing('添付ファイル');
      target.attachments = target.attachments.filter((item) => item.id !== attachmentId);
      target.version += 1; target.updatedAt = now();
      return ok(undefined);
    },
    readableAttachment(memoId, attachmentId) {
      const target = state.memos.find((memo) => memo.id === memoId && !memo.deletedAt);
      if (!target || !seen(target)) return missing('メモ');
      const attachment = target.attachments.find((item) => item.id === attachmentId);
      if (!attachment) return missing('添付ファイル');
      if (attachment.status !== 'clean') return fail({ code: 'ATTACHMENT_REJECTED', message: '確認が終わるまで、このファイルは開けません。', retryable: true });
      return ok(structuredClone(attachment));
    },
    deleteMemo(id) {
      const target = state.memos.find((item) => item.id === id && !item.deletedAt); if (!target || !seen(target)) return missing('メモ');
      const decision = canDeleteResource(viewer(), 'memo.delete', [target.authorMembershipId]); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      target.deletedAt = now(); archive(a.archives.memos, id, structuredClone(target)); return ok(undefined);
    },
    restoreMemo(id) {
      const target = state.memos.find((item) => item.id === id) ?? archivedRecord(a.archives.memos, id); if (!target || !seen(target)) return missing('メモ');
      const decision = canDeleteResource(viewer(), 'memo.delete', [target.authorMembershipId]); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      delete target.deletedAt; target.version += 1; delete a.archives.memos[id]; return ok(visible(target));
    },
  };
}
