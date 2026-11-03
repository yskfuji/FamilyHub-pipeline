import { describe, expect, it } from 'vitest';
import { initialAggregate } from '../../data/mockGateway';
import type { AlbumItem } from '../types';
import { createHouseholdRules } from './index';
import type { HouseholdAggregate } from './context';
import { captureDateForms, SEARCH_LIMITS } from './search';

const rulesFor = (aggregate: HouseholdAggregate, actorMembershipId = 'member-aoi') => createHouseholdRules(aggregate, { actorMembershipId, now: () => '2026-10-01T09:00:00+09:00', nextId: (prefix) => `${prefix}-test`, newInviteToken: () => 'token' });
const item = (id: string, status: AlbumItem['status'], extra: Partial<AlbumItem> = {}): AlbumItem => ({ id, albumId: 'album-sports', householdId: 'house-mori', kind: 'photo', originalName: `${id}.jpg`, mimeType: 'image/jpeg', byteSize: 10, status, locationKept: false, hasThumbnail: true, uploaderMembershipId: 'member-aoi', position: 9, createdAt: '2026-09-20T17:00:00+09:00', ...extra });

describe('album search (A17)', () => {
  it('leaves out items that are uploading, processing, rejected or in the trash', () => {
    const aggregate = initialAggregate();
    aggregate.albumItems.push(item('probe-uploading', 'uploading'), item('probe-processing', 'processing'), item('probe-rejected', 'rejected'), item('probe-trashed', 'ready', { deletedAt: '2026-09-30T00:00:00+09:00' }), item('probe-ready', 'ready'));
    const result = rulesFor(aggregate).resources.search('probe-');
    expect(result.ok && result.value.map((entry) => entry.id)).toEqual(['probe-ready']);
  });

  it('applies the limit of each kind separately, in a fixed order of kinds', () => {
    const aggregate = initialAggregate();
    for (let index = 0; index < 30; index += 1) aggregate.albumItems.push(item(`many-${index}`, 'ready'));
    for (let index = 0; index < 8; index += 1) aggregate.albums.push({ ...aggregate.albums[0], id: `album-many-${index}`, title: `many album ${index}` });
    const result = rulesFor(aggregate).resources.search('many');
    expect(result.ok).toBe(true);
    const kinds = result.ok ? result.value.map((entry) => entry.kind) : [];
    expect(kinds.filter((kind) => kind === 'album')).toHaveLength(SEARCH_LIMITS.album);
    expect(kinds.filter((kind) => kind === 'albumItem')).toHaveLength(SEARCH_LIMITS.albumItem);
    expect(kinds.indexOf('albumItem')).toBeGreaterThan(kinds.lastIndexOf('album'));
  });

  it('matches the capture date as written, in four forms', () => {
    expect(captureDateForms('2026-09-05T23:30:00-04:00')).toEqual(['2026-09-05', '2026/09/05', '2026/9/5', '2026年9月5日']);
    expect(captureDateForms(undefined)).toEqual([]);
  });

  it('a viewer without album.read finds no album and no photo', () => {
    const aggregate = initialAggregate();
    aggregate.permissionOverrides.push({ membershipId: 'member-ren', capability: 'album.read', effect: 'deny' });
    const result = rulesFor(aggregate, 'member-ren').resources.search('運動会');
    expect(result.ok && result.value.filter((entry) => entry.kind === 'album' || entry.kind === 'albumItem')).toEqual([]);
  });
});
