import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from '../authz/policy';
import { canTransitionTodo, inlineTodoAction, todoActionStatus, todoFlowFor } from './todoFlow';
import type { MembershipRole, Todo, ViewerContext } from './types';

const viewer = (membershipId: string, role: MembershipRole = 'child'): ViewerContext => ({ userId: `user-${membershipId}`, membershipId, role, status: 'active', capabilities: capabilitiesFor(role), permissionRevision: 1 });
const todo = (changes: Partial<Todo> = {}): Pick<Todo, 'status' | 'creatorMembershipId' | 'assigneeMembershipId' | 'reviewerMembershipId'> => ({ status: 'doing', creatorMembershipId: 'creator', assigneeMembershipId: 'assignee', ...changes });

describe('todoFlowFor', () => {
  it('suggests finishing when nobody reviews', () => {
    expect(todoFlowFor(todo(), viewer('assignee')).suggested).toBe('complete');
    expect(todoFlowFor(todo({ status: 'open' }), viewer('assignee')).suggested).toBe('complete');
    expect(todoFlowFor(todo({ status: 'waiting' }), viewer('assignee')).suggested).toBe('complete');
  });

  it('asks the assignee to request review when a reviewer exists', () => {
    expect(todoFlowFor(todo({ reviewerMembershipId: 'reviewer' }), viewer('assignee')).suggested).toBe('request-review');
    expect(todoFlowFor(todo({ status: 'open', reviewerMembershipId: 'reviewer' }), viewer('assignee')).suggested).toBe('request-review');
  });

  it('asks the reviewer to confirm a task under review', () => {
    expect(todoFlowFor(todo({ status: 'review', reviewerMembershipId: 'reviewer' }), viewer('reviewer')).suggested).toBe('confirm-done');
  });

  it('lets the reviewer finish a task that is not under review yet', () => {
    expect(todoFlowFor(todo({ reviewerMembershipId: 'reviewer' }), viewer('reviewer')).suggested).toBe('complete');
  });

  it('tells others they are waiting, but still lets them finish: the flow is guidance', () => {
    const flow = todoFlowFor(todo({ status: 'review', reviewerMembershipId: 'reviewer' }), viewer('assignee'));
    expect(flow.suggested).toBeNull();
    expect(flow.awaitingReviewer).toBe(true);
    expect(flow.others).toContain('complete');
  });

  it('offers every other status, and never the current one or a second way to the suggested one', () => {
    expect(todoFlowFor(todo({ status: 'open' }), viewer('assignee')).others).toEqual(['start', 'wait']);
    expect(todoFlowFor(todo({ status: 'doing' }), viewer('assignee')).others).toEqual(['wait', 'reset']);
    expect(todoFlowFor(todo({ status: 'waiting' }), viewer('assignee')).others).toEqual(['start', 'reset']);
    expect(todoFlowFor(todo({ status: 'review', reviewerMembershipId: 'reviewer' }), viewer('reviewer')).others).toEqual(['start', 'wait', 'reset']);
    expect(todoFlowFor(todo({ reviewerMembershipId: 'reviewer' }), viewer('assignee')).others).toEqual(['complete', 'wait', 'reset']);
  });

  it('only offers reopening a finished task', () => {
    expect(todoFlowFor(todo({ status: 'done' }), viewer('assignee'))).toEqual({ suggested: 'reopen', others: [], awaitingReviewer: false });
  });

  it('offers nothing to people who cannot change the status', () => {
    expect(todoFlowFor(todo(), viewer('guest', 'guest'))).toEqual({ suggested: null, others: [], awaitingReviewer: false });
    expect(todoFlowFor(todo(), viewer('other-child'))).toEqual({ suggested: null, others: [], awaitingReviewer: false });
  });

  it('never offers a review request without a reviewer', () => {
    for (const status of ['open', 'doing', 'waiting'] as const) {
      const flow = todoFlowFor(todo({ status }), viewer('assignee'));
      expect([flow.suggested, ...flow.others].map((action) => action && todoActionStatus[action])).not.toContain('review');
    }
  });
});

describe('canTransitionTodo', () => {
  it('matches the people the rule lets through', () => {
    expect(canTransitionTodo(viewer('creator'), todo())).toBe(true);
    expect(canTransitionTodo(viewer('assignee'), todo())).toBe(true);
    expect(canTransitionTodo(viewer('reviewer'), todo({ reviewerMembershipId: 'reviewer' }))).toBe(true);
    expect(canTransitionTodo(viewer('adult', 'adult'), todo())).toBe(true);
    expect(canTransitionTodo(viewer('other-child'), todo())).toBe(false);
    expect(canTransitionTodo({ ...viewer('assignee'), status: 'suspended' }, todo())).toBe(false);
  });
});

describe('inlineTodoAction', () => {
  it('keeps to the suggested action', () => {
    expect(inlineTodoAction(todo(), viewer('assignee'))).toBe('complete');
    expect(inlineTodoAction(todo({ reviewerMembershipId: 'reviewer' }), viewer('assignee'))).toBe('request-review');
    expect(inlineTodoAction(todo({ reviewerMembershipId: 'reviewer', status: 'review' }), viewer('assignee'))).toBeNull();
    expect(inlineTodoAction(todo({ reviewerMembershipId: 'reviewer', status: 'review' }), viewer('reviewer'))).toBe('confirm-done');
    expect(inlineTodoAction(todo({ status: 'done' }), viewer('assignee'))).toBeNull();
    expect(inlineTodoAction(todo(), viewer('other-child'))).toBeNull();
  });
});
