import type { AlbumInput, AlbumUpdateInput } from './schemas';
import type { Album, BgmPreset, Id } from './types';
import { visibilityChange, visibilityInput, visibilityProblem } from './visibilityForm';

/** アルバムには「参加者」がないので、選べる範囲が狭い。 */
export type AlbumAudience = NonNullable<AlbumInput['visibility']>['audience'];

export interface AlbumDraft {
  title: string;
  description: string;
  audience: AlbumAudience;
  selectedIds: Id[];
  /** 空なら指定なし。 */
  bgmPreset: BgmPreset | '';
}

export const newAlbumDraft = (audience: AlbumAudience): AlbumDraft => ({ title: '', description: '', audience, selectedIds: [], bgmPreset: '' });

export const albumToDraft = (album: Album): AlbumDraft => ({
  title: album.title, description: album.description ?? '', audience: album.visibility.audience as AlbumAudience,
  selectedIds: [...album.visibility.selectedMembershipIds], bgmPreset: album.bgmPreset ?? '',
});

export function albumDraftProblem(draft: AlbumDraft): string | null {
  if (!draft.title.trim()) return 'アルバム名を入力してください。';
  return visibilityProblem(draft.audience, draft.selectedIds);
}

export function albumDraftToCreateInput(draft: AlbumDraft): AlbumInput {
  return {
    title: draft.title.trim(), visibility: visibilityInput(draft.audience, draft.selectedIds),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.bgmPreset ? { bgmPreset: draft.bgmPreset } : {}),
  };
}

/** 変更の入力。説明と曲は空にすると外す。公開範囲は変えたときだけ送る。 */
export function albumDraftToUpdateInput(draft: AlbumDraft, original: Album): AlbumUpdateInput {
  return {
    title: draft.title.trim(), description: draft.description.trim() || null, bgmPreset: draft.bgmPreset || null,
    ...visibilityChange(draft.audience, draft.selectedIds, original.visibility),
  };
}
