import { describe, expect, it } from 'vitest';
import { audienceChoices, defaultAudience, visibilityChange, visibilityProblem } from './visibilityForm';

describe('audience choices', () => {
  it('has no participants on memos', () => {
    expect(audienceChoices('owner', 'memo')).toEqual(['household', 'adults', 'creator', 'selected']);
    expect(audienceChoices('owner', 'task')).toContain('participants');
    expect(audienceChoices('child', 'memo')).toEqual(['creator', 'selected']);
  });

  it('keeps showing an audience the viewer could not pick', () => {
    expect(audienceChoices('child', 'task', 'household')).toEqual(['household', 'participants', 'creator', 'selected']);
    expect(audienceChoices('child', 'task', 'creator')).toEqual(['participants', 'creator', 'selected']);
  });

  it('falls back when the preferred audience is not available', () => {
    expect(defaultAudience('owner', 'task', 'household')).toBe('household');
    expect(defaultAudience('owner', 'memo', undefined)).toBe('household');
    expect(defaultAudience('child', 'memo', 'household')).toBe('creator');
    expect(defaultAudience('child', 'task', 'creator')).toBe('creator');
  });
});

describe('visibility input', () => {
  const original = { audience: 'selected' as const, creatorMembershipId: 'a', selectedMembershipIds: ['b', 'c'] };

  it('needs at least one person and at most eight', () => {
    expect(visibilityProblem('selected', [])).toContain('1人以上');
    expect(visibilityProblem('selected', Array.from({ length: 9 }, (_, index) => `m${index}`))).toContain('8人');
    expect(visibilityProblem('household', [])).toBeNull();
  });

  it('notices a change, ignoring the order of the members', () => {
    expect(visibilityChange('selected', ['c', 'b'], original)).toEqual({});
    expect(visibilityChange('selected', ['b'], original)).toEqual({ visibility: { audience: 'selected', selectedMembershipIds: ['b'] } });
    expect(visibilityChange('household', ['b', 'c'], original)).toEqual({ visibility: { audience: 'household', selectedMembershipIds: [] } });
  });
});
