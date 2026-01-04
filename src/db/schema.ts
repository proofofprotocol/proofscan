/**
 * Database schema definitions and migrations
 * Phase 2.1: Schema version 2 with seq, summary, payload_hash
 * Phase 3.4: Schema version 3 with actor columns, secret_ref_count, actors table
 * Phase 4.1: Schema version 4 with user_refs table for named references
 * Phase 6.0: Schema version 5 with popl kind support in user_refs
 */

export const EVENTS_DB_VERSION = 5;
export const PROOFS_DB_VERSION = 1;

// events.db schema (version 3)
export const EVENTS_DB_SCHEMA = `
-- Sessions table (Phase 3.4: added actor_id, actor_kind, actor_label, secret_ref_count)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_reason TEXT CHECK(exit_reason IN ('normal', 'error', 'killed')),
  protected INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  actor_id TEXT,
  actor_kind TEXT,
  actor_label TEXT,
  secret_ref_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_connector ON sessions(connector_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_protected ON sessions(protected);

-- RPC calls table
CREATE TABLE IF NOT EXISTS rpc_calls (
  rpc_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  method TEXT NOT NULL,
  request_ts TEXT NOT NULL,
  response_ts TEXT,
  success INTEGER,
  error_code INTEGER,
  PRIMARY KEY (rpc_id, session_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rpc_calls_session ON rpc_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_rpc_calls_method ON rpc_calls(method);

-- Events table (version 2: added seq, summary, payload_hash)
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  rpc_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('client_to_server', 'server_to_client')),
  kind TEXT NOT NULL CHECK(kind IN ('request', 'response', 'notification', 'transport_event')),
  ts TEXT NOT NULL,
  seq INTEGER,
  summary TEXT,
  payload_hash TEXT,
  raw_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_rpc ON events(rpc_id);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_payload_hash ON events(payload_hash);

-- Actors table (Phase 3.4: registry of known actors, not required for operation)
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_actors_kind ON actors(kind);
CREATE INDEX IF NOT EXISTS idx_actors_revoked ON actors(revoked_at);

-- User refs table (Phase 4.1: named references)
-- Note: 'popl' kind uses connector column for entry_id and session column for target
CREATE TABLE IF NOT EXISTS user_refs (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
  connector TEXT,
  session TEXT,
  rpc TEXT,
  proto TEXT,
  level TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);
CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
`;

/**
 * Migration from version 1 to version 2
 * Adds: seq, summary, payload_hash columns to events table
 */
export const EVENTS_DB_MIGRATION_1_TO_2 = `
-- Add seq column (sequence number within session)
ALTER TABLE events ADD COLUMN seq INTEGER;

-- Add summary column (human-readable summary)
ALTER TABLE events ADD COLUMN summary TEXT;

-- Add payload_hash column (SHA-256 first 16 chars)
ALTER TABLE events ADD COLUMN payload_hash TEXT;

-- Create index for seq lookups
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(session_id, seq);

-- Create index for payload_hash lookups
CREATE INDEX IF NOT EXISTS idx_events_payload_hash ON events(payload_hash);
`;

/**
 * Migration from version 2 to version 3
 * Phase 3.4: Adds actor columns and secret_ref_count to sessions, creates actors table
 */
export const EVENTS_DB_MIGRATION_2_TO_3 = `
-- Add actor columns to sessions
ALTER TABLE sessions ADD COLUMN actor_id TEXT;

ALTER TABLE sessions ADD COLUMN actor_kind TEXT;

ALTER TABLE sessions ADD COLUMN actor_label TEXT;

ALTER TABLE sessions ADD COLUMN secret_ref_count INTEGER NOT NULL DEFAULT 0;

-- Create actors table
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_actors_kind ON actors(kind);

CREATE INDEX IF NOT EXISTS idx_actors_revoked ON actors(revoked_at);
`;

/**
 * Migration from version 3 to version 4
 * Phase 4.1: Adds user_refs table for named references
 */
export const EVENTS_DB_MIGRATION_3_TO_4 = `
-- Create user_refs table for named references
-- Note: 'popl' kind uses connector column for entry_id and session column for target
CREATE TABLE IF NOT EXISTS user_refs (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
  connector TEXT,
  session TEXT,
  rpc TEXT,
  proto TEXT,
  level TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);

CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
`;

/**
 * Migration from version 4 to version 5
 * Adds 'popl' to user_refs kind CHECK constraint
 */
export const EVENTS_DB_MIGRATION_4_TO_5 = `
-- Add 'popl' to user_refs kind constraint
-- SQLite doesn't support ALTER CONSTRAINT, so we recreate the table

-- Create new table with updated constraint
CREATE TABLE user_refs_new (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
  connector TEXT,
  session TEXT,
  rpc TEXT,
  proto TEXT,
  level TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Copy data from old table
INSERT INTO user_refs_new SELECT * FROM user_refs;

-- Drop old table
DROP TABLE user_refs;

-- Rename new table
ALTER TABLE user_refs_new RENAME TO user_refs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);
CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
`;

// proofs.db schema
export const PROOFS_DB_SCHEMA = `
-- Proofs table (immutable, never pruned)
CREATE TABLE IF NOT EXISTS proofs (
  proof_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  session_id TEXT,
  rpc_id TEXT,
  method TEXT,
  payload_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL,
  inscriber_type TEXT NOT NULL,
  inscriber_ref TEXT NOT NULL,
  artifact_uri TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proofs_connector ON proofs(connector_id);
CREATE INDEX IF NOT EXISTS idx_proofs_session ON proofs(session_id);
CREATE INDEX IF NOT EXISTS idx_proofs_created ON proofs(created_at);
`;
