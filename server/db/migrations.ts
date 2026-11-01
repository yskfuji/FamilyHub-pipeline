/** スキーマの変更は末尾に足す。適用済みのものは書き換えない。 */
export const migrations: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    avatar_tone TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE household_members (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    household_id TEXT NOT NULL,
    membership_id TEXT NOT NULL UNIQUE
  );
  CREATE INDEX household_members_household ON household_members(household_id);
  CREATE TABLE records (
    household_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (household_id, collection, id)
  ) WITHOUT ROWID;
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    location TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    reauthenticated_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    credential_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    user_id TEXT,
    challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE idempotency_records (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    body TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  ) WITHOUT ROWID;
  CREATE TABLE rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    household_id TEXT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX audit_events_household ON audit_events(household_id, at);
  `,
];
