import { describe, expect, it } from 'vitest';
import { albumDraftProblem, albumDraftToCreateInput, albumDraftToUpdateInput, albumToDraft, newAlbumDraft } from './albumForm';
import type { Album } from './types';

const album: Album = { id: 'a', householdId: 'h', title: '運動会', description: 'お弁当', bgmPreset: 'bright', creatorMembershipId: 'm', visibility: { creatorMembershipId: 'm', audience: 'selected', selectedMembershipIds: ['x'] }, createdAt: '2026-09-20T17:00:00+09:00', version: 1 };

describe('album form', () => {
  it('requires a title and someone to share with', () => {
    expect(albumDraftProblem(newAlbumDraft('household'))).toContain('アルバム名');
    expect(albumDraftProblem({ ...newAlbumDraft('selected'), title: '旅行' })).toContain('1人以上');
    expect(albumDraftProblem({ ...newAlbumDraft('household'), title: '旅行' })).toBeNull();
  });
  it('leaves empty optional fields out when creating', () => {
    expect(albumDraftToCreateInput({ ...newAlbumDraft('creator'), title: ' 旅行 ', description: '  ' })).toEqual({ title: '旅行', visibility: { audience: 'creator', selectedMembershipIds: [] } });
    expect(albumDraftToCreateInput({ ...newAlbumDraft('creator'), title: '旅行', description: '夏', bgmPreset: 'calm' })).toMatchObject({ description: '夏', bgmPreset: 'calm' });
  });
  it('round-trips an album and sends the audience only when it changed', () => {
    const draft = albumToDraft(album);
    expect(albumDraftToUpdateInput(draft, album)).toEqual({ title: '運動会', description: 'お弁当', bgmPreset: 'bright' });
    expect(albumDraftToUpdateInput({ ...draft, audience: 'adults' }, album)).toMatchObject({ visibility: { audience: 'adults', selectedMembershipIds: [] } });
  });
  it('clears the description and the music with null', () => {
    expect(albumDraftToUpdateInput({ ...albumToDraft(album), description: '', bgmPreset: '' }, album)).toMatchObject({ description: null, bgmPreset: null });
  });
});
