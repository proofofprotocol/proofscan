/**
 * ProofComm Event System
 * Phase 0: G1 - metadata_json contract
 *
 * Rules:
 * - GatewayEvent.metadata_json is ALWAYS a JSON string
 * - Empty case: null or '{}'
 * - NEVER pass raw object directly
 */

import type { AuditLogger } from '../gateway/audit.js';
import type { GatewayEventKind } from '../db/types.js';

// ==================== ProofComm Event Kinds ====================

/**
 * ProofComm-specific event kinds (4 types only)
 * Details are expressed via action field in metadata
 */
export type ProofCommEventKind =
  | 'proofcomm_space'      // action: created/joined/left/message/delivery_failed
  | 'proofcomm_skill'      // action: search/match
  | 'proofcomm_document'   // action: activated/context_updated
  | 'proofcomm_route';     // action: resolved/dispatched

/**
 * All valid event kinds (Gateway + ProofComm)
 */
export type AllEventKind = GatewayEventKind | ProofCommEventKind;

// ==================== Action Vocabulary ====================

/**
 * Fixed action vocabulary (B4 compliance)
 * Do not add new actions without updating this type
 */
export type ProofCommAction =
  // space
  | 'created'
  | 'joined'
  | 'left'
  | 'message'
  | 'delivery_failed'
  // skill
  | 'search'
  | 'match'
  // document
  | 'activated'
  | 'context_updated'
  // route
  | 'resolved'
  | 'dispatched';

// ==================== Metadata Schema ====================

/**
 * ProofComm metadata schema
 * All events must include 'action' field
 */
export interface ProofCommMetadata {
  /** Required: action type from fixed vocabulary */
  action: ProofCommAction;

  // Space-related
  space_id?: string;
  space_name?: string;
  recipient_count?: number;  // For broadcast
  failed_count?: number;     // For delivery failures

  // Agent-related
  agent_id?: string;
  agent_name?: string;

  // Document-related
  doc_target_id?: string;
  doc_path?: string;

  // Skill-related
  skill_id?: string;
  skill_name?: string;
  match_score?: number;

  // Message-related
  message_id?: string;
  message_preview?: string;  // First 100 chars

  // Task-related
  task_id?: string;

  // Allow additional fields for extensibility
  [key: string]: unknown;
}

// ==================== Base Options ====================

/**
 * Base options for ProofComm event emission
 * Excludes 'metadata' as it's handled separately
 */
export interface ProofCommEventBaseOptions {
  /** Gateway-assigned request ID (ULID) */
  requestId: string;
  /** Distributed tracing ID */
  traceId?: string;
  /** Authenticated client ID (token name) */
  clientId: string;
  /** Target connector, agent, space, or document ID */
  target?: string;
  /** Method name if applicable */
  method?: string;
  /** Processing latency in milliseconds */
  latencyMs?: number;
  /** Upstream latency in milliseconds */
  upstreamLatencyMs?: number;
  /** Authorization decision */
  decision?: 'allow' | 'deny';
  /** Denial reason */
  denyReason?: string;
  /** Error message */
  error?: string;
  /** HTTP status code */
  statusCode?: number;
}

// ==================== G1: Emit Function ====================

/**
 * Emit a ProofComm event with proper metadata stringification
 *
 * G1 Contract:
 * - metadata is ALWAYS JSON.stringify()'d before passing to auditLogger
 * - This ensures metadata_json in DB is always a valid JSON string
 *
 * @param auditLogger - AuditLogger instance
 * @param kind - ProofComm event kind
 * @param metadata - ProofComm metadata (will be stringified)
 * @param baseOptions - Base event options (without metadata)
 * @returns Event ID
 */
export function emitProofCommEvent(
  auditLogger: AuditLogger,
  kind: ProofCommEventKind,
  metadata: ProofCommMetadata,
  baseOptions: ProofCommEventBaseOptions
): string {
  // G1: Always stringify metadata before passing
  // This ensures consistency across all ProofComm events
  const metadataStringified = JSON.stringify(metadata);

  // Parse back to object for audit logger (which expects object)
  // The audit logger will stringify again, but this ensures we validate JSON format
  const metadataObject = JSON.parse(metadataStringified) as Record<string, unknown>;

  return auditLogger.logEvent({
    requestId: baseOptions.requestId,
    traceId: baseOptions.traceId,
    clientId: baseOptions.clientId,
    event: kind as unknown as GatewayEventKind, // Cast for compatibility
    target: baseOptions.target,
    method: baseOptions.method,
    latencyMs: baseOptions.latencyMs,
    upstreamLatencyMs: baseOptions.upstreamLatencyMs,
    decision: baseOptions.decision,
    denyReason: baseOptions.denyReason,
    error: baseOptions.error,
    statusCode: baseOptions.statusCode,
    metadata: metadataObject,
  });
}

// ==================== Convenience Emitters ====================

/**
 * Emit a space event
 */
export function emitSpaceEvent(
  auditLogger: AuditLogger,
  action: 'created' | 'joined' | 'left' | 'message' | 'delivery_failed',
  metadata: Omit<ProofCommMetadata, 'action'> & { space_id: string },
  baseOptions: ProofCommEventBaseOptions
): string {
  return emitProofCommEvent(
    auditLogger,
    'proofcomm_space',
    { ...metadata, action },
    { ...baseOptions, target: baseOptions.target ?? metadata.space_id }
  );
}

/**
 * Emit a skill event
 */
export function emitSkillEvent(
  auditLogger: AuditLogger,
  action: 'search' | 'match',
  metadata: Omit<ProofCommMetadata, 'action'>,
  baseOptions: ProofCommEventBaseOptions
): string {
  return emitProofCommEvent(
    auditLogger,
    'proofcomm_skill',
    { ...metadata, action },
    baseOptions
  );
}

/**
 * Emit a document event
 */
export function emitDocumentEvent(
  auditLogger: AuditLogger,
  action: 'activated' | 'context_updated',
  metadata: Omit<ProofCommMetadata, 'action'> & { doc_target_id: string },
  baseOptions: ProofCommEventBaseOptions
): string {
  return emitProofCommEvent(
    auditLogger,
    'proofcomm_document',
    { ...metadata, action },
    { ...baseOptions, target: baseOptions.target ?? metadata.doc_target_id }
  );
}

/**
 * Emit a route event
 */
export function emitRouteEvent(
  auditLogger: AuditLogger,
  action: 'resolved' | 'dispatched',
  metadata: Omit<ProofCommMetadata, 'action'>,
  baseOptions: ProofCommEventBaseOptions
): string {
  return emitProofCommEvent(
    auditLogger,
    'proofcomm_route',
    { ...metadata, action },
    baseOptions
  );
}

// ==================== Utility Functions ====================

/**
 * Truncate text to specified length with ellipsis
 */
export function truncatePreview(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Extract text content from A2A message parts
 */
export function extractMessageText(
  parts: Array<{ text?: string; data?: string; mimeType?: string }>
): string {
  return parts
    .filter((p): p is { text: string } => 'text' in p && typeof p.text === 'string')
    .map(p => p.text)
    .join(' ');
}

/**
 * Create a message preview from A2A message parts
 */
export function createMessagePreview(
  parts: Array<{ text?: string; data?: string; mimeType?: string }>,
  maxLength: number = 100
): string {
  const text = extractMessageText(parts);
  return truncatePreview(text, maxLength);
}

/**
 * Validate that a ProofComm event kind is valid
 */
export function isProofCommEventKind(kind: string): kind is ProofCommEventKind {
  return [
    'proofcomm_space',
    'proofcomm_skill',
    'proofcomm_document',
    'proofcomm_route',
  ].includes(kind);
}

/**
 * Validate that an action is valid for a given event kind
 */
export function isValidAction(kind: ProofCommEventKind, action: string): boolean {
  const validActions: Record<ProofCommEventKind, string[]> = {
    proofcomm_space: ['created', 'joined', 'left', 'message', 'delivery_failed'],
    proofcomm_skill: ['search', 'match'],
    proofcomm_document: ['activated', 'context_updated'],
    proofcomm_route: ['resolved', 'dispatched'],
  };
  return validActions[kind]?.includes(action) ?? false;
}
