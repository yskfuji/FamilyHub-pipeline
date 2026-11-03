import type { HouseholdPort } from '../../data/gateway';
import { capabilityCeilingFor } from '../../authz/policy';
import { toJstRfc3339 } from '../calendarDate';
import { MAX_HOUSEHOLD_MEMBERS, MAX_NAME_CHANGES_PER_DAY, activeMemberCount, recentNameChanges } from '../householdLimits';
import { householdProfileSchema, privacySettingsSchema } from '../schemas';
import type { HouseholdInvite, HouseholdSnapshot, PermissionOverride, PrivacySettings } from '../types';
import { fail, invalid, missing, ok } from './context';
import type { CommandContext, SyncPort } from './context';

export function createHouseholdCommands(c: CommandContext): SyncPort<Omit<HouseholdPort, 'getSnapshot' | 'createHousehold'>> {
  const { a, state, env, nextId, now, requireCapability, offlineFailure, ownerCandidateProblem, project } = c;
  return {
    acceptInvite(code) {
      // 期限切れ・使用済み・取り消し・存在しないコードを区別しない（推測を防ぐ）。
      const invite = a.invites.find((item) => item.token === code.trim());
      const usable = invite && !invite.revokedAt && invite.remainingUses > 0 && Date.parse(invite.expiresAt) > Date.parse(now());
      if (!invite || !usable) return fail({ code: 'UNAUTHENTICATED', message: '招待コードが正しくないか、有効期限が切れています。招待した人に新しいコードを依頼してください。', retryable: false });
      if (activeMemberCount(state.memberships) >= MAX_HOUSEHOLD_MEMBERS) return fail({ code: 'CONFLICT', message: `家族グループは${MAX_HOUSEHOLD_MEMBERS}人までです。`, retryable: false });
      invite.remainingUses -= 1;
      return ok({ householdId: state.household.id });
    },
    updateProfile(input) {
      const guard = requireCapability<HouseholdSnapshot['household']>('household.members.manage'); if (guard) return guard;
      const network = offlineFailure<HouseholdSnapshot['household']>(); if (network) return network;
      const parsed = householdProfileSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const recent = recentNameChanges(state.household.nameChanges, now());
      if (recent.length >= MAX_NAME_CHANGES_PER_DAY) return fail({ code: 'RATE_LIMITED', message: `名前の変更は1日${MAX_NAME_CHANGES_PER_DAY}回までです。時間をおいてお試しください。`, retryable: false });
      state.household.name = parsed.data.name;
      state.household.nameChanges = [...recent, now()];
      return ok(structuredClone(state.household));
    },
    updateMembershipRole(id, role, expectedVersion) {
      const guard = requireCapability<HouseholdSnapshot['memberships'][number]>('household.members.manage'); if (guard) return guard;
      const network = offlineFailure<HouseholdSnapshot['memberships'][number]>(); if (network) return network;
      const target = state.memberships.find((member) => member.id === id);
      if (!target) return missing('メンバー');
      if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で権限が更新されています。', retryable: true, reason: 'VERSION' });
      const activeOwners = state.memberships.filter((member) => member.status === 'active' && member.role === 'owner');
      if (target.role === 'owner' && role !== 'owner' && activeOwners.length === 1) return fail({ code: 'FORBIDDEN', message: '管理者は1人以上必要です。先に別のメンバーを管理者に変更してください。', retryable: false, reason: 'OWNER_REQUIRED' });
      if (role === 'owner' && target.role !== 'owner') { const problem = ownerCandidateProblem<HouseholdSnapshot['memberships'][number]>(target); if (problem) return problem; }
      target.role = role; target.version += 1; a.permissionRevision += 1;
      return ok(structuredClone(target));
    },
    createInvite(role) {
      const guard = requireCapability<HouseholdInvite>('household.invites.manage'); if (guard) return guard;
      const network = offlineFailure<HouseholdInvite>(); if (network) return network;
      const invite = { id: nextId('invite'), householdId: state.household.id, role, token: env.newInviteToken(), expiresAt: toJstRfc3339(new Date(Date.parse(now()) + 24 * 60 * 60 * 1000)), remainingUses: 1 } as const;
      a.invites.push(invite);
      return ok(structuredClone(invite));
    },
    // 招待コードは作成時の応答でだけ返す。一覧には含めない（画面の共有や記録から漏れないようにする）。
    listInvites() { const guard = requireCapability<HouseholdInvite[]>('household.invites.manage'); return guard ?? ok(a.invites.map((invite) => { const listed = structuredClone(invite); delete listed.token; return listed; })); },
    revokeInvite(id) {
      const guard = requireCapability<HouseholdInvite>('household.invites.manage'); if (guard) return guard;
      const network = offlineFailure<HouseholdInvite>(); if (network) return network;
      const invite = a.invites.find((item) => item.id === id); if (!invite) return missing('招待');
      invite.revokedAt = now(); invite.remainingUses = 0; return ok(structuredClone(invite));
    },
    getPermissionOverrides(membershipId) {
      const guard = requireCapability<PermissionOverride[]>('household.members.manage');
      return guard ?? ok(structuredClone(a.permissionOverrides.filter((item) => item.membershipId === membershipId)));
    },
    updatePermissionOverrides(membershipId, overrides, expectedPermissionRevision) {
      const guard = requireCapability<HouseholdSnapshot>('household.members.manage'); if (guard) return guard;
      const network = offlineFailure<HouseholdSnapshot>(); if (network) return network;
      if (expectedPermissionRevision !== a.permissionRevision) return fail({ code: 'CONFLICT', message: '別の端末で権限が変更されました。最新の内容を確認してください。', retryable: true, reason: 'PERMISSION_REVISION' });
      const member = state.memberships.find((item) => item.id === membershipId); if (!member) return missing('メンバー');
      const ceiling = new Set(capabilityCeilingFor(member.role));
      if (overrides.some((item) => item.membershipId !== membershipId || (item.effect === 'allow' && !ceiling.has(item.capability)))) return fail({ code: 'INVALID_INPUT', message: 'この役割で利用できない機能は、個別に許可できません。必要な場合は役割を変更してください。', retryable: false });
      a.permissionOverrides = [...a.permissionOverrides.filter((item) => item.membershipId !== membershipId), ...structuredClone(overrides)];
      a.permissionRevision += 1; return ok(project());
    },
    resetPermissionOverrides(membershipId, expectedPermissionRevision) {
      const guard = requireCapability<HouseholdSnapshot>('household.members.manage'); if (guard) return guard;
      if (expectedPermissionRevision !== a.permissionRevision) return fail({ code: 'CONFLICT', message: '別の端末で権限が変更されました。最新の内容を確認してください。', retryable: true, reason: 'PERMISSION_REVISION' });
      if (!state.memberships.some((item) => item.id === membershipId)) return missing('メンバー');
      a.permissionOverrides = a.permissionOverrides.filter((item) => item.membershipId !== membershipId); a.permissionRevision += 1; return ok(project());
    },
    getPrivacySettings() { const guard = requireCapability<PrivacySettings>('settings.own'); return guard ?? ok(structuredClone(a.privacy)); },
    savePrivacySettings(settings) {
      const guard = requireCapability<PrivacySettings>('settings.own'); if (guard) return guard;
      const parsed = privacySettingsSchema.safeParse(settings);
      if (!parsed.success) return invalid(parsed.error.issues);
      const next = parsed.data;
      const previous = a.privacy.placeLookupConsent;
      // 同意の日時は利用者の端末ではなく受け付けた側の時計で記録する。
      const placeLookupConsent = next.placeLookupConsent
        ? (previous?.noticeVersion === next.placeLookupConsent.noticeVersion ? previous : { noticeVersion: next.placeLookupConsent.noticeVersion, grantedAt: now() })
        : null;
      a.privacy = { ...next, placeLookupConsent };
      return ok(structuredClone(a.privacy));
    },
  };
}
