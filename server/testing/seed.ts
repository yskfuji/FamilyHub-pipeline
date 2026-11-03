import { adultDeclaredUsers, baseAlbumItems, baseAlbums, baseInvites, baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSnapshot, seededSnapshot } from '../../src/data/fixtures';
import type { HouseholdAggregate } from '../../src/domain/commands';
import { loadAggregate, saveAggregate } from '../db/aggregateStore';
import type { Db } from '../db/db';
import { hashInviteToken } from '../http/routes/household';

export const SEED_PASSWORD = 'current-password-long-enough';

/** 見本の家族を入れる。試験と開発の起動でだけ使い、本番の組み立てには含めない。 */
export function seedHousehold(db: Db, passwordHash: string, createdAt: string) {
  const { memberships, household } = baseSnapshot;
  db.transaction(() => {
    for (const member of memberships) {
      const name = member.userId.replace('user-', '');
      db.run('INSERT INTO users (id, email, display_name, avatar_tone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', member.userId, `${name}@example.test`, member.displayName, 'indigo', passwordHash, createdAt);
      db.run('INSERT INTO household_members (user_id, household_id, membership_id) VALUES (?, ?, ?)', member.userId, household.id, member.id);
    }
    db.run("INSERT INTO entitlements (household_id, status, updated_at) VALUES (?, 'active', ?)", household.id, createdAt);
    for (const userId of adultDeclaredUsers) db.run('UPDATE users SET adult_declared_at = ? WHERE id = ?', createdAt, userId);
    const defaults = { privacy: basePrivacySettings, notificationPreferences: baseNotificationPreferences };
    const loaded = loadAggregate(db, household.id, 'member-aoi', defaults);
    const seeded: HouseholdAggregate = {
      state: seededSnapshot(),
      permissionOverrides: [], permissionRevision: 1,
      invites: structuredClone(baseInvites).map((invite) => ({ ...invite, token: invite.token ? hashInviteToken(invite.token) : undefined })),
      notifications: structuredClone(baseNotifications), notificationPreferences: structuredClone(baseNotificationPreferences), privacy: structuredClone(basePrivacySettings),
      archives: { events: {}, todos: {}, memos: {}, expenses: {} }, albums: structuredClone(baseAlbums), albumItems: structuredClone(baseAlbumItems), occurrenceDeletions: [],
    };
    saveAggregate(db, household.id, 'member-aoi', { aggregate: seeded, loaded: loaded.loaded }, { media: true });
  });
}
