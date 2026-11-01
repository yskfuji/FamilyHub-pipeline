import { describe, expect, it } from 'vitest';
import { MAX_TAGS, memoDraftProblem, memoDraftToCreateInput, memoDraftToUpdateInput, memoToDraft, newMemoDraft, parseTags } from './memoForm';
import { memoInputSchema } from './schemas';
import type { Memo, PlaceRef } from './types';

const draft = (changes = {}) => ({ ...newMemoDraft('2026-09-30', 'household'), title: '連絡', body: '本文', ...changes });
const place: PlaceRef = { name: '学校', capturedVia: 'manual', selectedAt: '2026-09-30T07:30:00+09:00' };
const memo = (changes: Partial<Memo> = {}): Memo => ({
  id: 'm', householdId: 'h', title: '元', body: '本文', updatedAt: '2026-09-30T07:30:00+09:00', authorMembershipId: 'a', tags: ['学校', '今週'], attachments: [], version: 1,
  visibility: { audience: 'adults', creatorMembershipId: 'a', selectedMembershipIds: [] }, ...changes,
});

describe('memo drafts', () => {
  it('splits tags on either comma', () => {
    expect(parseTags('学校、今週, 家計 ,,')).toEqual(['学校', '今週', '家計']);
  });

  it('checks the title, the body, the tags and the audience', () => {
    expect(memoDraftProblem(draft())).toBeNull();
    expect(memoDraftProblem(draft({ title: ' ' }))).toContain('タイトル');
    expect(memoDraftProblem(draft({ body: ' ' }))).toContain('本文');
    expect(memoDraftProblem(draft({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, index) => `t${index}`).join('、') }))).toContain('タグ');
    expect(memoDraftProblem(draft({ audience: 'selected' }))).toContain('公開する人');
  });

  it('creates with the memo date, the audience and a place', () => {
    const input = memoDraftToCreateInput(draft({ tags: '学校', place, audience: 'selected', selectedIds: ['b'] }));
    expect(input).toEqual({ title: '連絡', body: '本文', tags: ['学校'], memoDate: '2026-09-30', place, visibility: { audience: 'selected', selectedMembershipIds: ['b'] } });
    expect(memoInputSchema.safeParse(input).success).toBe(true);
  });

  it('leaves an empty date out when creating, and clears it when editing', () => {
    expect(memoDraftToCreateInput(draft({ memoDate: '' }))).not.toHaveProperty('memoDate');
    const original = memo({ memoDate: '2026-09-29' });
    expect(memoDraftToUpdateInput({ ...memoToDraft(original), memoDate: '' }, original).memoDate).toBeNull();
  });

  it('sends the place and the audience only when they changed', () => {
    const original = memo({ place });
    const unchanged = memoDraftToUpdateInput(memoToDraft(original), original);
    expect(unchanged).not.toHaveProperty('place');
    expect(unchanged).not.toHaveProperty('visibility');
    const changed = memoDraftToUpdateInput({ ...memoToDraft(original), place: null, audience: 'creator' }, original);
    expect(changed.place).toBeNull();
    expect(changed.visibility).toEqual({ audience: 'creator', selectedMembershipIds: [] });
  });
});
