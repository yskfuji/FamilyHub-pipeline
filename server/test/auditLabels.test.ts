import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditActionLabels, auditGroupLabels, auditTargetLabels } from '../../src/content/auditLabels';
import { auditGroupActions, auditGroups } from '../../src/domain/auditLog';
import { auditedGatewayOperations } from '../../src/data/gatewayOperations';
import { contractOperations } from '../testing/contract';

describe('names in the change record (A5-6)', () => {
  it('has a Japanese name for every operationId in the contract', () => {
    const missing = contractOperations().map((item) => item.operationId).filter((id) => !auditActionLabels[id]?.trim());
    expect(missing).toEqual([]);
  });

  it('has a name for every action the API and the operator commands write, and a group for every change', () => {
    const written = Object.values(auditGroupActions).flat();
    expect(written.filter((action) => !auditActionLabels[action])).toEqual([]);
    const mutations = contractOperations().filter((item) => item.method !== 'GET' && item.method !== 'HEAD' && item.operation.operationId).map((item) => item.operationId);
    const ungrouped = mutations.filter((id) => !written.includes(id));
    // 記録に残らない操作（サインインの前段・送信の続き・本人確認など）だけが、どのまとまりにも入らない。
    expect(ungrouped.sort()).toEqual(['appendUpload', 'beginPasskey', 'beginPasskeyRegistration', 'beginTotpEnrollment', 'cancelUpload', 'putAlbumItemThumbnail', 'reauthenticate', 'requestPasswordReset', 'signOut'].sort());
    for (const operation of Object.values(auditedGatewayOperations)) expect(written).toContain(operation.operationId);
  });

  it('names every group and target kind, and never shows an unknown action as is', () => {
    expect(Object.keys(auditGroupLabels).sort()).toEqual([...auditGroups, 'other'].sort());
    expect(Object.values(auditTargetLabels).every(Boolean)).toBe(true);
    expect(auditActionLabel('somethingNew')).toBe('そのほかの操作');
  });
});
