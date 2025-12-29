/**
 * Database types for Phase2
 */

// Session exit reasons
export type ExitReason = 'normal' | 'error' | 'killed';

// Event directions and kinds (same as Phase1)
export type EventDirection = 'client_to_server' | 'server_to_client';
export type EventKind = 'request' | 'response' | 'notification' | 'transport_event';

// Sessions table
export interface Session {
  session_id: string;
  connector_id: string;
  started_at: string; // ISO8601
  ended_at: string | null;
  exit_reason: ExitReason | null;
  protected: number; // 0 or 1 (SQLite doesn't have boolean)
  created_at: string;
}

// RPC calls table
export interface RpcCall {
  rpc_id: string;
  session_id: string;
  method: string;
  request_ts: string;
  response_ts: string | null;
  success: number | null; // 0, 1, or null
  error_code: number | null;
}

// Events table (schema version 2)
export interface Event {
  event_id: string;
  session_id: string;
  rpc_id: string | null;
  direction: EventDirection;
  kind: EventKind;
  ts: string;
  seq: number | null;         // Phase 2.1: sequence number within session
  summary: string | null;     // Phase 2.1: human-readable summary
  payload_hash: string | null; // Phase 2.1: SHA-256 first 16 chars
  raw_json: string | null;
}

// Proofs table (proofs.db)
export interface Proof {
  proof_id: string;
  connector_id: string;
  session_id: string | null;
  rpc_id: string | null;
  method: string | null;
  payload_hash: string;
  hash_algo: string;
  inscriber_type: string;
  inscriber_ref: string;
  artifact_uri: string | null;
  created_at: string;
}

// Query result types
export interface SessionWithStats extends Session {
  event_count?: number;
  rpc_count?: number;
}

export interface PruneCandidate {
  session_id: string;
  connector_id: string;
  started_at: string;
  event_count: number;
  protected: number;
  reason: string;
}

export interface ArchivePlan {
  sessions_to_delete: PruneCandidate[];
  raw_json_to_clear: number;
  estimated_savings_mb: number;
}
