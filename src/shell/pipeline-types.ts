/**
 * Pipeline Types for psh Shell
 *
 * Defines the types for pipeline values that flow between commands.
 * Used by the `where` command to filter structured data.
 */

/** Row type identifier for type-safe filtering */
export type RowType = 'rpc' | 'session' | 'connector' | 'a2a-message';

/** Pipeline value - either structured rows or plain text */
export type PipelineValue =
  | { kind: 'rows'; rows: PipelineRow[]; rowType: RowType }
  | { kind: 'text'; text: string };

/** RPC row (from ls in session context) */
export interface RpcRow {
  rpc_id: string;
  session_id: string;
  target_id?: string; // Available in find results (cross-session search)
  method: string;
  status: 'OK' | 'ERR' | 'pending';
  latency_ms: number | null;
  request_ts: string;
  response_ts: string | null;
  error_code: number | null;
  tool_name?: string; // Tool name when method is tools/call
}

/** Session row (from ls in connector context) */
export interface SessionRow {
  session_id: string;
  target_id: string;
  started_at: string;
  ended_at: string | null;
  event_count: number;
  rpc_count: number;
  /** Total latency across all RPCs (not yet implemented - reserved for future use) */
  total_latency_ms?: number;
}

/** Connector row (from ls in root context) */
export interface ConnectorRow {
  connector_id: string;
  name: string;
  session_count: number;
  created_at: string;
}

/** A2A message row (from history command) */
export interface A2AMessageRow {
  id: number;
  session_id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** Union of all row types */
export type PipelineRow = RpcRow | SessionRow | ConnectorRow | A2AMessageRow;
