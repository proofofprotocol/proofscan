/**
 * Filter Context Mappers for psh Shell
 *
 * Convert pipeline rows to FilterContext for evaluation.
 * Reuses the existing Filter DSL types from src/filter/.
 */

import type { FilterContext } from '../filter/types.js';
import type { RpcRow, SessionRow } from './pipeline-types.js';

/**
 * Convert RPC row to FilterContext
 *
 * Field mapping (Option A adopted):
 *   tools.method = rpc.method ("tools/call", "tools/list", etc.)
 *   tools.name   = tool_name (the actual tool being called, e.g., "convert_time")
 *
 * Status normalization: Row status (OK|ERR|pending) → lowercase (ok|err|pending)
 */
export function rpcRowToFilterContext(row: RpcRow): FilterContext {
  return {
    'rpc.id': row.rpc_id,
    'rpc.method': row.method,
    'rpc.status': row.status?.toLowerCase() ?? 'pending', // OK|ERR|pending → ok|err|pending
    'rpc.latency': row.latency_ms,
    'session.id': row.session_id,
    'tools.name': row.tool_name ?? null, // Tool name for tools/call
    'tools.method': row.method, // "tools/call", "tools/list", etc.
  };
}

/**
 * Convert Session row to FilterContext
 */
export function sessionRowToFilterContext(row: SessionRow): FilterContext {
  return {
    'session.id': row.session_id,
    'session.latency': row.total_latency_ms ?? null,
  };
}
