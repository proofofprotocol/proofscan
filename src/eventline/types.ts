/**
 * EventLine - Normalized event model for Phase 2.1
 *
 * This is the canonical internal representation used by view/tree/explore.
 * Direction uses → / ← (MCP Client → MCP Server / MCP Server → MCP Client).
 */

/**
 * Direction: always from perspective of MCP protocol flow
 * "→" = MCP Client → MCP Server
 * "←" = MCP Server → MCP Client
 */
export type EventLineDirection = '→' | '←';

/**
 * Kind of event - fixed 6 types
 */
export type EventLineKind =
  | 'session_start'
  | 'session_end'
  | 'req'
  | 'res'
  | 'notify'
  | 'error';

/**
 * Status of the event
 */
export type EventLineStatus = 'OK' | 'ERR' | '-';

/**
 * Normalized EventLine - the universal internal event format
 * Phase 2.1: Added seq, summary, payload_hash for enhanced observation
 */
export interface EventLine {
  /** Timestamp in epoch milliseconds */
  ts_ms: number;

  /** Sequence number within session (monotonic, 1-based) */
  seq?: number;

  /** Event kind */
  kind: EventLineKind;

  /** Direction: → (client→server) or ← (server→client) */
  direction?: EventLineDirection;

  /** Label (method name or "session start"/"session end") */
  label: string;

  /** Human-readable summary (e.g., "tools/list → 5 tools") */
  summary?: string;

  /** Connector ID */
  connector_id?: string;

  /** Connector label (human-readable name) */
  connector_label?: string;

  /** Session ID */
  session_id?: string;

  /** RPC ID (JSON-RPC id field) */
  rpc_id?: string | number;

  /** Status */
  status: EventLineStatus;

  /** Error code if status is ERR */
  error_code?: number | string;

  /** Latency in milliseconds (for responses) */
  latency_ms?: number;

  /** Size in bytes */
  size_bytes?: number;

  /** SHA-256 hash of payload (first 16 chars) for deduplication */
  payload_hash?: string;

  /** Raw JSON string */
  raw_json?: string;

  /** Additional metadata (for unknown columns, etc.) */
  meta?: Record<string, unknown>;
}

/**
 * EventLinePair - Request/Response correlation for --pairs option
 */
export interface EventLinePair {
  /** RPC ID that links request and response */
  rpc_id: string | number;

  /** Method name */
  method: string;

  /** Request event */
  request: EventLine;

  /** Response event (may be missing if pending) */
  response?: EventLine;

  /** Total latency (response.ts_ms - request.ts_ms) */
  latency_ms?: number;

  /** Success status */
  success: boolean;
}

/**
 * TreeNode for hierarchical display
 */
export interface TreeNode {
  type: 'connector' | 'session' | 'rpc' | 'proof' | 'event';
  id: string;
  label: string;
  meta?: Record<string, unknown>;
  children?: TreeNode[];
}

/**
 * Kind symbol mapping for display
 */
export const KIND_SYMBOLS: Record<EventLineKind, string> = {
  session_start: '▶',
  session_end: '■',
  req: '→',
  res: '←',
  notify: '•',
  error: '✖',
};

/**
 * Get display symbol for kind
 */
export function getKindSymbol(kind: EventLineKind): string {
  return KIND_SYMBOLS[kind] || '?';
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(ts_ms: number, fulltime: boolean = false): string {
  const date = new Date(ts_ms);
  const time = date.toTimeString().slice(0, 8); // HH:MM:SS
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  if (fulltime) {
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return `${dateStr} ${time}.${ms}`;
  }

  return `${time}.${ms}`;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format bytes in human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Shorten UUID for display (first 8 chars + ...)
 */
export function shortenId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return id.slice(0, length) + '...';
}
