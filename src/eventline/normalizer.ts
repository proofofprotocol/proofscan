/**
 * EventLine Normalizer - converts raw DB events to normalized EventLine format
 *
 * This layer absorbs schema differences and provides a consistent interface
 * for view/tree/explore commands.
 *
 * Phase 2.1: Added support for seq, summary, payload_hash
 */

import type { Event, Session, RpcCall, SessionWithStats } from '../db/types.js';
import type {
  EventLine,
  EventLineDirection,
  EventLineKind,
  EventLineStatus,
  EventLinePair,
} from './types.js';
import { createHash } from 'crypto';

/**
 * Parse ISO8601 timestamp to epoch milliseconds
 */
export function parseTimestamp(ts: string | number | null | undefined): number {
  if (ts === null || ts === undefined) return 0;

  // Already milliseconds
  if (typeof ts === 'number') {
    // If it looks like seconds (< year 2100 as ms would be ~4e12)
    if (ts < 4e12 && ts > 1e9) {
      return ts * 1000;
    }
    return ts;
  }

  // ISO8601 string
  const date = new Date(ts);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * Map old direction format to new → / ← format
 */
export function normalizeDirection(
  direction: string | null | undefined,
  kind: string | null | undefined
): EventLineDirection | undefined {
  if (!direction) {
    // Infer from kind if possible
    if (kind === 'request') return '→';
    if (kind === 'response') return '←';
    return undefined;
  }

  // Map known formats
  const dir = direction.toLowerCase();
  if (dir === 'client_to_server' || dir === 'outbound' || dir === 'out' || dir === 'send') {
    return '→';
  }
  if (dir === 'server_to_client' || dir === 'inbound' || dir === 'in' || dir === 'receive') {
    return '←';
  }
  if (dir === '→' || dir === '->') return '→';
  if (dir === '←' || dir === '<-') return '←';

  return undefined;
}

/**
 * Map old kind format to new 6-type format
 */
export function normalizeKind(kind: string | null | undefined): EventLineKind {
  if (!kind) return 'notify';

  const k = kind.toLowerCase();

  if (k === 'request' || k === 'req') return 'req';
  if (k === 'response' || k === 'res') return 'res';
  if (k === 'notification' || k === 'notify') return 'notify';
  if (k === 'error' || k === 'err') return 'error';
  if (k === 'session_start' || k === 'transport_event' && k.includes('connect')) return 'session_start';
  if (k === 'session_end') return 'session_end';

  // transport_event → treat as notify
  if (k === 'transport_event') return 'notify';

  return 'notify';
}

/**
 * Extract method/label from raw JSON or columns
 */
export function extractLabel(
  rawJson: string | null | undefined,
  method: string | null | undefined,
  kind: EventLineKind,
  dbKind?: string | null
): string {
  // Use explicit method if available
  if (method) return method;

  // Try to extract from raw JSON
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.method) return parsed.method;
      // For responses, label as "response" if no method
      if (parsed.result !== undefined || parsed.error !== undefined) {
        return 'response';
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fallback labels
  if (kind === 'session_start') return 'session start';
  if (kind === 'session_end') return 'session end';

  // Transport events
  if (dbKind === 'transport_event') {
    return '[transport]';
  }

  // For notify without method, show kind
  if (kind === 'notify') return '[notification]';
  if (kind === 'req') return '[request]';
  if (kind === 'res') return '[response]';
  if (kind === 'error') return '[error]';

  return '(unknown)';
}

/**
 * Extract RPC ID from raw JSON or column
 */
export function extractRpcId(
  rawJson: string | null | undefined,
  rpcId: string | number | null | undefined
): string | number | undefined {
  // Use explicit rpc_id if available
  if (rpcId !== null && rpcId !== undefined) return rpcId;

  // Try to extract from raw JSON
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.id !== undefined) return parsed.id;
    } catch {
      // Ignore parse errors
    }
  }

  return undefined;
}

/**
 * Determine status from various sources
 */
export function determineStatus(
  rawJson: string | null | undefined,
  success: number | null | undefined,
  kind: EventLineKind
): EventLineStatus {
  // Explicit success column
  if (success === 1) return 'OK';
  if (success === 0) return 'ERR';

  // Check raw JSON for error
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.error) return 'ERR';
      if (parsed.result !== undefined) return 'OK';
    } catch {
      // Ignore parse errors
    }
  }

  // Default based on kind
  if (kind === 'error') return 'ERR';
  if (kind === 'res') return 'OK';
  if (kind === 'req') return 'OK';

  return '-';
}

/**
 * Extract error code from raw JSON or column
 */
export function extractErrorCode(
  rawJson: string | null | undefined,
  errorCode: number | null | undefined
): number | string | undefined {
  // Use explicit error_code if available
  if (errorCode !== null && errorCode !== undefined) return errorCode;

  // Try to extract from raw JSON
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.error?.code) return parsed.error.code;
    } catch {
      // Ignore parse errors
    }
  }

  return undefined;
}

/**
 * Calculate size in bytes
 */
export function calculateSize(rawJson: string | null | undefined): number | undefined {
  if (!rawJson) return undefined;
  return new TextEncoder().encode(rawJson).length;
}

/**
 * Normalize a single raw Event to EventLine
 */
export function normalizeEvent(
  event: Event,
  session?: Session | SessionWithStats,
  rpcCall?: RpcCall
): EventLine {
  const kind = normalizeKind(event.kind);
  const direction = normalizeDirection(event.direction, event.kind);
  const label = extractLabel(event.raw_json, rpcCall?.method, kind, event.kind);
  const rpcId = extractRpcId(event.raw_json, event.rpc_id);
  const status = determineStatus(event.raw_json, rpcCall?.success, kind);
  const errorCode = extractErrorCode(event.raw_json, rpcCall?.error_code);
  const sizeBytes = calculateSize(event.raw_json);

  // Calculate latency from RPC call if available
  let latencyMs: number | undefined;
  if (rpcCall && rpcCall.request_ts && rpcCall.response_ts && kind === 'res') {
    const reqTs = parseTimestamp(rpcCall.request_ts);
    const resTs = parseTimestamp(rpcCall.response_ts);
    if (reqTs && resTs) {
      latencyMs = resTs - reqTs;
    }
  }

  const eventLine: EventLine = {
    ts_ms: parseTimestamp(event.ts),
    kind,
    direction,
    label,
    connector_id: session?.connector_id,
    session_id: event.session_id,
    rpc_id: rpcId,
    status,
    error_code: errorCode,
    latency_ms: latencyMs,
    size_bytes: sizeBytes,
    raw_json: event.raw_json || undefined,
  };

  return eventLine;
}

/**
 * Create session_start EventLine from Session
 */
export function createSessionStartEvent(session: Session | SessionWithStats): EventLine {
  return {
    ts_ms: parseTimestamp(session.started_at),
    kind: 'session_start',
    direction: undefined,
    label: 'session start',
    connector_id: session.connector_id,
    session_id: session.session_id,
    status: '-',
    meta: {
      connector: session.connector_id,
    },
  };
}

/**
 * Create session_end EventLine from Session
 */
export function createSessionEndEvent(
  session: Session | SessionWithStats,
  stats?: { rpc_count?: number; event_count?: number; error_count?: number }
): EventLine {
  if (!session.ended_at) {
    // Session still running
    return {
      ts_ms: Date.now(),
      kind: 'session_end',
      direction: undefined,
      label: 'session running',
      connector_id: session.connector_id,
      session_id: session.session_id,
      status: '-',
      meta: { running: true },
    };
  }

  const startMs = parseTimestamp(session.started_at);
  const endMs = parseTimestamp(session.ended_at);
  const durationMs = endMs - startMs;

  const status: EventLineStatus = session.exit_reason === 'normal' ? 'OK' : 'ERR';

  return {
    ts_ms: endMs,
    kind: 'session_end',
    direction: undefined,
    label: 'session end',
    connector_id: session.connector_id,
    session_id: session.session_id,
    status,
    latency_ms: durationMs, // Reuse latency_ms for session duration
    meta: {
      exit_reason: session.exit_reason,
      rpc_count: stats?.rpc_count || (session as SessionWithStats).rpc_count,
      event_count: stats?.event_count || (session as SessionWithStats).event_count,
      error_count: stats?.error_count,
      duration_ms: durationMs,
    },
  };
}

/**
 * Normalize a batch of events with related data
 */
export function normalizeEvents(
  events: Event[],
  sessions: Map<string, Session | SessionWithStats>,
  rpcCalls: Map<string, RpcCall>
): EventLine[] {
  return events.map(event => {
    const session = sessions.get(event.session_id);
    const rpcCall = event.rpc_id ? rpcCalls.get(`${event.session_id}:${event.rpc_id}`) : undefined;
    return normalizeEvent(event, session, rpcCall);
  });
}

/**
 * Compute SHA-256 payload hash (first 16 chars)
 */
export function computePayloadHash(rawJson: string | null | undefined): string | undefined {
  if (!rawJson) return undefined;
  const hash = createHash('sha256').update(rawJson).digest('hex');
  return hash.slice(0, 16);
}

/**
 * Generate human-readable summary for an event
 */
export function generateSummary(
  rawJson: string | null | undefined,
  kind: EventLineKind,
  label: string
): string | undefined {
  if (!rawJson) return undefined;

  try {
    const parsed = JSON.parse(rawJson);

    // Request summaries
    if (kind === 'req') {
      const params = parsed.params;
      if (label === 'tools/call' && params?.name) {
        return `call ${params.name}`;
      }
      if (label === 'resources/read' && params?.uri) {
        const uri = params.uri as string;
        return `read ${uri.length > 30 ? uri.slice(0, 15) + '...' + uri.slice(-12) : uri}`;
      }
      if (label === 'prompts/get' && params?.name) {
        return `get ${params.name}`;
      }
      return label;
    }

    // Response summaries
    if (kind === 'res') {
      const result = parsed.result;
      if (result) {
        // tools/list response
        if (result.tools && Array.isArray(result.tools)) {
          return `${result.tools.length} tools`;
        }
        // resources/list response
        if (result.resources && Array.isArray(result.resources)) {
          return `${result.resources.length} resources`;
        }
        // prompts/list response
        if (result.prompts && Array.isArray(result.prompts)) {
          return `${result.prompts.length} prompts`;
        }
        // initialize response
        if (result.serverInfo?.name) {
          return `${result.serverInfo.name} v${result.serverInfo.version || '?'}`;
        }
        // tools/call response
        if (result.content && Array.isArray(result.content)) {
          return `${result.content.length} content`;
        }
      }

      // Error response
      if (parsed.error) {
        return `error: ${parsed.error.message || parsed.error.code}`;
      }

      return 'OK';
    }

    // Notification summary
    if (kind === 'notify') {
      return label.replace('notifications/', '');
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create EventLinePair from request and response events
 */
export function createEventLinePair(
  request: EventLine,
  response?: EventLine
): EventLinePair {
  const latencyMs = response ? response.ts_ms - request.ts_ms : undefined;

  return {
    rpc_id: request.rpc_id!,
    method: request.label,
    request,
    response,
    latency_ms: latencyMs,
    success: response ? response.status === 'OK' : false,
  };
}

/**
 * Group events by RPC ID to create pairs
 */
export function groupEventsToPairs(events: EventLine[]): EventLinePair[] {
  const pairs: Map<string, { request?: EventLine; response?: EventLine }> = new Map();

  // Group by rpc_id
  for (const event of events) {
    if (!event.rpc_id) continue;

    const key = `${event.session_id}:${event.rpc_id}`;
    const existing = pairs.get(key) || {};

    if (event.kind === 'req') {
      existing.request = event;
    } else if (event.kind === 'res') {
      existing.response = event;
    }

    pairs.set(key, existing);
  }

  // Convert to pairs (only include if request exists)
  const result: EventLinePair[] = [];
  for (const [, pair] of pairs) {
    if (pair.request) {
      result.push(createEventLinePair(pair.request, pair.response));
    }
  }

  // Sort by request timestamp
  result.sort((a, b) => a.request.ts_ms - b.request.ts_ms);

  return result;
}
