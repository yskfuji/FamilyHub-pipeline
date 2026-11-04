import type { MemoInput } from './schemas';
import type { Id, Memo, PlaceRef } from './types';
import { visibilityChange, visibilityInput, visibilityProblem } from './visibilityForm';

export const MAX_TAGS = 10;

/** メモには「参加者」がないので、選べる範囲が狭い。 */
export type MemoAudience = NonNullable<MemoInput['visibility']>['audience'];

export interface MemoDraft {
  title: string;
  body: string;
  /** 読点またはカンマで区切ったタグ。 */
  tags: string;
  /** YYYY-MM-DD。空なら指定なし。 */
  memoDate: string;
  audience: MemoAudience;
  selectedIds: Id[];
  place: PlaceRef | null;
}

export const parseTags = (text: string) => text.split(/[,、]/).map((tag) => tag.trim()).filter(Boolean);

export const newMemoDraft = (date: string, audience: MemoAudience): MemoDraft => ({ title: '', body: '', tags: '', memoDate: date, audience, selectedIds: [], place: null });

export const memoToDraft = (memo: Memo): MemoDraft => ({
  title: memo.title, body: memo.body, tags: memo.tags.join('、'), memoDate: memo.memoDate ?? '',
  audience: memo.visibility.audience as MemoAudience, selectedIds: [...memo.visibility.selectedMembershipIds], place: memo.place ?? null,
});

export function memoDraftProblem(draft: MemoDraft): string | null {
  if (!draft.title.trim()) return 'タイトルを入力してください。';
  if (!draft.body.trim()) return '本文を入力してください。';
  if (parseTags(draft.tags).length > MAX_TAGS) return `タグは${MAX_TAGS}件までです。`;
  return visibilityProblem(draft.audience, draft.selectedIds);
}

export function memoDraftToCreateInput(draft: MemoDraft): MemoInput {
  return {
    title: draft.title.trim(), body: draft.body.trim(), tags: parseTags(draft.tags), visibility: visibilityInput(draft.audience, draft.selectedIds),
    ...(draft.memoDate ? { memoDate: draft.memoDate } : {}),
    ...(draft.place ? { place: draft.place } : {}),
  };
}

/** 変更の入力。日付は空にすると外す。場所と公開範囲は変えたときだけ送る。 */
export function memoDraftToUpdateInput(draft: MemoDraft, original: Memo): Partial<MemoInput> {
  return {
    title: draft.title.trim(), body: draft.body.trim(), tags: parseTags(draft.tags), memoDate: draft.memoDate || null,
    ...(draft.place === (original.place ?? null) ? {} : { place: draft.place }),
    ...visibilityChange(draft.audience, draft.selectedIds, original.visibility),
  };
}
