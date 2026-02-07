/**
 * Bridge Envelope Utilities (Phase 6.2)
 *
 * Handles UI tool call sanitization and correlation ID generation
 * for audit logging and request tracking.
 */

import { randomUUID } from 'crypto';
import type {
  BridgeEnvelope,
  CleanToolCallParams,
  CorrelationIds,
  SanitizeToolCallResult,
  ToolsCallParamsWithBridge,
} from './types.js';

/**
 * Sanitize tool call params by removing _bridge envelope
 *
 * The bridge token is extracted for audit logging but never forwarded
 * to the server. This ensures token isolation.
 *
 * @param params - Tool call params (may include _bridge)
 * @returns Clean params and extracted bridge token
 */
export function sanitizeToolCall(
  params: ToolsCallParamsWithBridge
): SanitizeToolCallResult {
  const { _bridge, ...clean } = params;

  return {
    clean: clean as CleanToolCallParams,
    bridgeToken: _bridge?.sessionToken,
  };
}

/**
 * Generate correlation IDs for UI tool request tracking
 *
 * @param bridgeToken - Optional bridge token (sessionToken)
 * @param rpcId - JSON-RPC request ID
 * @returns Correlation IDs
 */
export function generateCorrelationIds(
  bridgeToken: string | undefined,
  rpcId: number
): CorrelationIds {
  return {
    ui_session_id: bridgeToken
      ? `ui_${bridgeToken.slice(0, 8)}`
      : 'ui_unknown',
    ui_rpc_id: `rpc_${rpcId}`,
    correlation_id: randomUUID(),
    tool_call_fingerprint: `fp_${Date.now()}_${rpcId}`,
  };
}

/**
 * Create a UI session ID from a bridge token
 *
 * @param token - Session token
 * @returns UI session ID
 */
export function uiSessionIdFromToken(token: string): string {
  return `ui_${token.slice(0, 8)}`;
}

/**
 * Check if correlation IDs match
 *
 * @param ids1 - First correlation IDs
 * @param ids2 - Second correlation IDs
 * @returns true if correlation_id matches
 */
export function correlationIdsMatch(
  ids1: CorrelationIds,
  ids2: CorrelationIds
): boolean {
  return ids1.correlation_id === ids2.correlation_id;
}
