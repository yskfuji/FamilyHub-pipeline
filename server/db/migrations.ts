/**
 * スキーマの変更は末尾に足す。適用済みのものは書き換えない。
 * 監査の記録は別のファイル（audit.db、server/audit/schema.ts）に置く。本体には、同じトランザクションで書く
 * 送り出しの箱（audit_outbox）と、毎日の基準点の控え（audit_anchors）だけを置く。
 * 7番目の変更で、それまで本体にあった audit_events の行を送り出しの箱へ移し、鎖の起点にする。
 */
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
  `
  ALTER TABLE users ADD COLUMN birthdate TEXT;
  ALTER TABLE users ADD COLUMN adult_declared_at TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  ALTER TABLE users ADD COLUMN idle_timeout_minutes INTEGER NOT NULL DEFAULT 30;
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
  CREATE TABLE recovery_codes (
    user_id TEXT NOT NULL REFERENCES users(id),
    code_hash TEXT NOT NULL,
    used_at TEXT,
    PRIMARY KEY (user_id, code_hash)
  ) WITHOUT ROWID;
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX password_resets_user ON password_resets(user_id, created_at);
  CREATE TABLE entitlements (
    household_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    ends_at TEXT,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
  `
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    household_id TEXT NOT NULL,
    membership_id TEXT NOT NULL,
    album_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    upload_length INTEGER NOT NULL,
    upload_offset INTEGER NOT NULL,
    keep_location INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX uploads_user ON uploads(user_id);
  `,
  `
  ALTER TABLE uploads ADD COLUMN touched_at TEXT;
  `,
  `
  CREATE TABLE assistant_jobs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    file_id TEXT,
    result TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE UNIQUE INDEX assistant_jobs_one_active ON assistant_jobs(household_id) WHERE status IN ('queued', 'running');
  CREATE INDEX assistant_jobs_user ON assistant_jobs(user_id);
  `,
  `
  CREATE TABLE key_fingerprints (
    kid TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retired_at TEXT
  ) WITHOUT ROWID;
  `,
  `
  CREATE TABLE audit_outbox (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    household_id TEXT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    at TEXT NOT NULL
  );
  INSERT INTO audit_outbox (id, household_id, actor_user_id, action, target, detail, at)
    SELECT id, household_id, actor_user_id, action, target, detail, at FROM audit_events ORDER BY rowid;
  DROP TABLE audit_events;
  CREATE TABLE audit_anchors (
    day TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    hash TEXT NOT NULL,
    at TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];
