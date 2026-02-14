/**
 * Database types for Phase2 + Phase 3.4 + Phase 7.0 + Phase 8.5
 */

// Session exit reasons
export type ExitReason = 'normal' | 'error' | 'killed';

// Actor kinds (Phase 3.4)
export type ActorKind = 'human' | 'agent' | 'system';

// Event directions and kinds (same as Phase1)
export type EventDirection = 'client_to_server' | 'server_to_client';
export type EventKind = 'request' | 'response' | 'notification' | 'transport_event';

// Task status states (A2A Protocol) - Phase 2.4
export type TaskStatus = 'pending' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'rejected';

// Task event kinds - Phase 2.4
export type TaskEventKind =
  | 'a2a:task:created'     // Task作成時
  | 'a2a:task:updated'     // 状態遷移時のみ (pending→working, working→completed等)
  | 'a2a:task:completed'   // 完了時（成功）
  | 'a2a:task:failed'      // タスク自体がfailedを返した時
  | 'a2a:task:canceled'    // キャンセル成功時
  | 'a2a:task:wait_timeout' // wait/followがタイムアウト
  | 'a2a:task:poll_error'; // ポーリング中エラー

// Task event payload - Phase 2.4
export interface TaskEventPayload {
  taskId: string;
  rawStatus: string;            // レスポンスそのまま
  status: TaskStatus;           // 正規化済み
  previousStatus?: TaskStatus;   // 遷移前（updated時）
  messages?: A2AMessage[];      // 完了時のみ
  artifacts?: TaskArtifact[];    // あれば
  error?: string;                // エラー時
}

// A2A message types (re-export for use in TaskEventPayload)
export interface A2AMessage {
  role: 'user' | 'assistant';
  parts: Array<{ text: string } | { data: string; mimeType: string }>;
  messageId?: string;
  metadata?: Record<string, unknown>;
  contextId?: string;
  referenceTaskIds?: string[];
}

// Task artifact types
export interface TaskArtifact {
  name?: string;
  description?: string;
  parts: Array<{ text: string } | { data: string; mimeType: string }>;
}

// Task event record - Phase 2.4
export interface TaskEvent {
  event_id: string;
  session_id: string;
  task_id: string;
  event_kind: TaskEventKind;
  ts: string;                  // ISO8601
  payload_json: string;         // JSON string of TaskEventPayload
}

// ==================== UI Events (Phase 6.2) ====================

/** UI event types for audit logging */
export type UiEventType =
  | 'ui_tool_request'
  | 'ui_tool_result'
  | 'ui_tool_delivered';

/** UI event record */
export interface UiEvent {
  event_id: string;
  ui_session_id: string;       // Derived from sessionToken
  ui_rpc_id: string;           // Individual RPC call ID
  correlation_id: string;       // Request → response tracking
  tool_call_fingerprint: string; // Tool call fingerprint
  event_type: UiEventType;
  tool_name: string | null;    // Tool name
  ts: number;                  // Unix timestamp (ms)
  payload_json: string | null;  // JSON string of event payload
}

// ==================== Gateway Audit Events (Phase 8.5) ====================

/** Gateway event kinds for audit logging */
export type GatewayEventKind =
  | 'gateway_auth_success'    // Authentication successful
  | 'gateway_auth_failure'    // Authentication failed
  | 'gateway_mcp_request'     // MCP proxy request
  | 'gateway_mcp_response'    // MCP proxy response
  | 'gateway_a2a_request'     // A2A proxy request
  | 'gateway_a2a_response'    // A2A proxy response
  | 'gateway_error';          // Gateway error

/** Gateway audit event record */
export interface GatewayEvent {
  event_id: string;
  request_id: string;          // Gateway-assigned ULID
  trace_id: string | null;     // Distributed tracing ID
  client_id: string;           // Authenticated client ID
  event_kind: GatewayEventKind;
  target_id: string | null;    // Connector or agent ID
  method: string | null;       // MCP/A2A method
  ts: string;                  // ISO8601 timestamp
  latency_ms: number | null;   // Total processing time
  upstream_latency_ms: number | null; // Upstream connector/agent time
  decision: string | null;     // 'allow' | 'deny'
  deny_reason: string | null;  // Reason for denial
  error: string | null;        // Error message if any
  status_code: number | null;  // HTTP status code
  metadata_json: string | null; // Additional metadata as JSON
}

// Target ID (unified connector/agent identifier)
export type TargetId = string;

/** @deprecated Use TargetId instead */
export type ConnectorId = string;

// Sessions table (Phase 3.4: added actor_*, secret_ref_count; Phase 6: added target_id; Phase 7: connector_id deprecated)
export interface Session {
  session_id: string;
  /** @deprecated Use target_id instead */
  connector_id: string;
  target_id: string | null; // Phase 6: Unified connector/agent target ID
  started_at: string; // ISO8601
  ended_at: string | null;
  exit_reason: ExitReason | null;
  protected: number; // 0 or 1 (SQLite doesn't have boolean)
  created_at: string;
  // Phase 3.4: Actor info
  actor_id: string | null;
  actor_kind: string | null; // ActorKind when present
  actor_label: string | null;
  // Phase 3.4: Secret reference count
  secret_ref_count: number;
}

// Actors table (Phase 3.4)
export interface Actor {
  id: string;
  kind: ActorKind;
  label: string;
  created_at: string;
  revoked_at: string | null;
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

// Events table (schema version 2; Phase 6: added normalized_json)
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
  normalized_json: string | null; // Phase 6: Protocol-agnostic normalized format
}

// Proofs table (proofs.db)
export interface Proof {
  proof_id: string;
  /** Target ID (connector or agent) */
  target_id: string;
  /** @deprecated Use target_id instead */
  connector_id?: string;
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

// User-defined references (Phase 4.1 + Phase 5.2)
// Note: 'popl' kind stores target as 'popl/<entry_id>' (no local paths for public ledger safety)
// Note: 'plan' kind stores plan_name, 'run' kind stores run_id
export type RefKind = 'connector' | 'session' | 'rpc' | 'tool_call' | 'context' | 'popl' | 'plan' | 'run';

export interface UserRef {
  name: string;
  kind: RefKind;
  connector: string | null;
  session: string | null;
  rpc: string | null;
  proto: string | null;
  level: string | null;
  captured_at: string;
  created_at: string;
  /** For popl kind: target path (e.g., 'popl/<entry_id>') */
  target: string | null;
  /** For popl kind: POPL entry ID */
  entry_id: string | null;
}

// Targets table (Phase 7.0: unified connector/agent)
export type TargetType = 'connector' | 'agent';
export type TargetProtocol = 'mcp' | 'a2a';

export interface Target {
  id: string;
  type: TargetType;
  protocol: TargetProtocol;
  name: string | null;
  enabled: number; // 0 or 1 (SQLite doesn't have boolean)
  created_at: string; // ISO8601
  updated_at: string | null;
  config_json: string; // JSON string, parsed to object in store
}

// Agent cache table (Phase 7.0)
export interface AgentCache {
  target_id: string;
  agent_card_json: string | null; // JSON string, parsed to object in store
  agent_card_hash: string | null;
  fetched_at: string | null;
  expires_at: string | null;
}
