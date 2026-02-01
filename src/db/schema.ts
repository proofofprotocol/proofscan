/**
 * Database schema definitions and migrations
 * Phase 2.1: Schema version 2 with seq, summary, payload_hash
 * Phase 3.4: Schema version 3 with actor columns, secret_ref_count, actors table
 * Phase 4.1: Schema version 4 with user_refs table for named references
 * Phase 6.0: Schema version 5 with popl kind support in user_refs
 * Phase 7.0: Schema version 6 with targets table (unified connector/agent) and agent_cache table
 * Phase 2.4: Schema version 7 with task_events table for Task lifecycle tracking
 */

export const EVENTS_DB_VERSION = 7;
export const PROOFS_DB_VERSION = 2;

// events.db schema (version 3)
export const EVENTS_DB_SCHEMA = `
-- Sessions table (Phase 7.0: added target_id for unified connector/agent)
-- Note: connector_id is legacy, target_id is the unified identifier
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL, -- Legacy: use target_id instead
  target_id TEXT,
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

-- Events table (version 6: added seq, summary, payload_hash, normalized_json)
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
  normalized_json TEXT,
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
-- Note: 'plan' kind stores plan name, 'run' kind stores run_id
CREATE TABLE IF NOT EXISTS user_refs (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl', 'plan', 'run')),
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

-- Targets table (Phase 7.0: unified connector/agent)
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('connector', 'agent')),
  protocol TEXT NOT NULL CHECK(protocol IN ('mcp', 'a2a')),
  name TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  config_json TEXT NOT NULL,
  CHECK (
    (type = 'connector' AND protocol = 'mcp') OR
    (type = 'agent' AND protocol = 'a2a')
  )
);

CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(type, enabled);

-- Agent cache table (Phase 7.0: cache for A2A agent cards)
CREATE TABLE IF NOT EXISTS agent_cache (
  target_id TEXT PRIMARY KEY,
  agent_card_json TEXT,
  agent_card_hash TEXT,
  fetched_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
);

-- Task events table (Phase 2.4: Task lifecycle tracking)
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(
    event_kind IN (
      'a2a:task:created',
      'a2a:task:updated',
      'a2a:task:completed',
      'a2a:task:failed',
      'a2a:task:canceled',
      'a2a:task:wait_timeout',
      'a2a:task:poll_error'
    )
  ),
  ts TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_events_session ON task_events(session_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_kind ON task_events(event_kind);
CREATE INDEX IF NOT EXISTS idx_task_events_ts ON task_events(ts);
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
-- Note: 'plan' kind stores plan name, 'run' kind stores run_id
CREATE TABLE IF NOT EXISTS user_refs (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl', 'plan', 'run')),
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
-- Add 'popl', 'plan', 'run' to user_refs kind constraint
-- SQLite doesn't support ALTER CONSTRAINT, so we recreate the table

-- Create new table with updated constraint
CREATE TABLE user_refs_new (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl', 'plan', 'run')),
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

/**
 * Migration from version 5 to version 6
 * Phase 7.0: Adds targets table (unified connector/agent), agent_cache table,
 *            target_id to sessions, and normalized_json to events
 */
export const EVENTS_DB_MIGRATION_5_TO_6 = `
-- Create targets table (unified connector/agent)
CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('connector', 'agent')),
  protocol TEXT NOT NULL CHECK(protocol IN ('mcp', 'a2a')),
  name TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  config_json TEXT NOT NULL,
  CHECK (
    (type = 'connector' AND protocol = 'mcp') OR
    (type = 'agent' AND protocol = 'a2a')
  )
);

CREATE INDEX idx_targets_type ON targets(type, enabled);

-- Create agent_cache table
CREATE TABLE agent_cache (
  target_id TEXT PRIMARY KEY,
  agent_card_json TEXT,
  agent_card_hash TEXT,
  fetched_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
);

-- Add target_id to sessions (migrate from connector_id later)
ALTER TABLE sessions ADD COLUMN target_id TEXT;

-- Add normalized_json to events
ALTER TABLE events ADD COLUMN normalized_json TEXT;
`;

/**
 * Data migration from version 5 to version 6
 * Migrate existing sessions: set target_id = connector_id
 */
export const EVENTS_DB_MIGRATION_5_TO_6_DATA = `
-- Migrate existing sessions: set target_id = connector_id
UPDATE sessions
SET target_id = connector_id
WHERE target_id IS NULL;
`;

/**
 * Migration from version 6 to version 7
 * Phase 2.4: Adds task_events table for Task lifecycle tracking
 */
export const EVENTS_DB_MIGRATION_6_TO_7 = `
-- Create task_events table
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(
    event_kind IN (
      'a2a:task:created',
      'a2a:task:updated',
      'a2a:task:completed',
      'a2a:task:failed',
      'a2a:task:canceled',
      'a2a:task:wait_timeout',
      'a2a:task:poll_error'
    )
  ),
  ts TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_events_session ON task_events(session_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_kind ON task_events(event_kind);
CREATE INDEX IF NOT EXISTS idx_task_events_ts ON task_events(ts);
`;

// proofs.db schema (version 2: added plans and runs tables)
export const PROOFS_DB_SCHEMA = `
-- Proofs table (immutable, never pruned)
CREATE TABLE IF NOT EXISTS proofs (
  proof_id TEXT PRIMARY KEY,
  target_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_proofs_target ON proofs(target_id);
CREATE INDEX IF NOT EXISTS idx_proofs_connector ON proofs(connector_id);
CREATE INDEX IF NOT EXISTS idx_proofs_session ON proofs(session_id);
CREATE INDEX IF NOT EXISTS idx_proofs_created ON proofs(created_at);

-- Plans table (Phase 5.2: validation plans, never pruned)
CREATE TABLE IF NOT EXISTS plans (
  name TEXT PRIMARY KEY CHECK(length(name) > 0 AND name GLOB '[a-z0-9_-]*'),
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_yaml TEXT NOT NULL,
  content_normalized TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  description TEXT,
  default_connector TEXT,
  source TEXT NOT NULL CHECK(source IN ('manual', 'import', 'builtin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at);
CREATE INDEX IF NOT EXISTS idx_plans_source ON plans(source);

-- Runs table (Phase 5.2: plan execution records, never pruned)
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  plan_name TEXT,
  plan_digest TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'partial', 'crashed')),
  artifact_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_name) REFERENCES plans(name) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_plan ON runs(plan_name);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_digest ON runs(plan_digest);
`;

/**
 * Migration from proofs.db version 1 to version 2
 * Phase 5.2: Adds plans and runs tables for validation scenarios
 */
export const PROOFS_DB_MIGRATION_1_TO_2 = `
-- Plans table (Phase 5.2: validation plans, never pruned)
CREATE TABLE IF NOT EXISTS plans (
  name TEXT PRIMARY KEY CHECK(length(name) > 0 AND name GLOB '[a-z0-9_-]*'),
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_yaml TEXT NOT NULL,
  content_normalized TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  description TEXT,
  default_connector TEXT,
  source TEXT NOT NULL CHECK(source IN ('manual', 'import', 'builtin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at);
CREATE INDEX IF NOT EXISTS idx_plans_source ON plans(source);

-- Runs table (Phase 5.2: plan execution records, never pruned)
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  plan_name TEXT,
  plan_digest TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'partial', 'crashed')),
  artifact_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_name) REFERENCES plans(name) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_plan ON runs(plan_name);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_digest ON runs(plan_digest);
`;
