/**
 * ProofComm Routing System
 * Phase 0: G2 - Reserved Namespace
 *
 * Rules:
 * - doc/ and space/ are reserved prefixes (ProofComm namespace)
 * - IDs must match ^[a-zA-Z0-9_-]+$
 * - Reserved prefixes cannot be used in target registration
 * - Future migration path: pc:doc:xxx, pc:space:xxx
 */

// ==================== Reserved Namespace ====================

/**
 * Reserved prefixes for ProofComm routing
 * These cannot be used as regular agent/connector IDs
 */
export const RESERVED_PREFIXES = ['doc/', 'space/'] as const;

/**
 * Reserved prefix type
 */
export type ReservedPrefix = typeof RESERVED_PREFIXES[number];

/**
 * Valid ID pattern for doc/space IDs
 * Alphanumeric, underscore, and hyphen only
 */
export const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ==================== Routing Target ====================

/**
 * Type of routing target
 */
export type RoutingTargetType = 'agent' | 'document' | 'space';

/**
 * Parsed routing target
 */
export interface RoutingTarget {
  /** Type of target */
  type: RoutingTargetType;
  /** Target ID (without prefix) */
  id: string;
  /** Original agent field value */
  original: string;
}

// ==================== Parsing Functions ====================

/**
 * Parse an agent field value to determine routing target
 *
 * G2 Contract:
 * - doc/<id> routes to document
 * - space/<id> routes to space
 * - Other values route to regular agent
 *
 * @param agent - Agent field value from A2A request
 * @returns Parsed routing target
 * @throws Error if ID format is invalid
 */
export function parseAgentField(agent: string): RoutingTarget {
  // Check for doc/ prefix
  if (agent.startsWith('doc/')) {
    const id = agent.slice(4);
    if (!id) {
      throw new RoutingError('Empty document ID after doc/ prefix', 'INVALID_DOC_ID');
    }
    if (!VALID_ID_PATTERN.test(id)) {
      throw new RoutingError(
        `Invalid document ID format: ${id}. Must match ${VALID_ID_PATTERN}`,
        'INVALID_DOC_ID'
      );
    }
    return { type: 'document', id, original: agent };
  }

  // Check for space/ prefix
  if (agent.startsWith('space/')) {
    const id = agent.slice(6);
    if (!id) {
      throw new RoutingError('Empty space ID after space/ prefix', 'INVALID_SPACE_ID');
    }
    if (!VALID_ID_PATTERN.test(id)) {
      throw new RoutingError(
        `Invalid space ID format: ${id}. Must match ${VALID_ID_PATTERN}`,
        'INVALID_SPACE_ID'
      );
    }
    return { type: 'space', id, original: agent };
  }

  // Regular agent (URL or ID)
  return { type: 'agent', id: agent, original: agent };
}

// ==================== Validation Functions ====================

/**
 * Check if a string starts with a reserved prefix
 */
export function hasReservedPrefix(value: string): boolean {
  return RESERVED_PREFIXES.some(prefix => value.startsWith(prefix));
}

/**
 * Validate that a target ID does not use reserved prefixes
 *
 * G2 Contract:
 * - targets.id, resident_documents.doc_id, spaces.space_id
 * - Must NOT start with doc/ or space/
 *
 * @param id - ID to validate
 * @returns true if valid (no reserved prefix)
 */
export function validateTargetId(id: string): boolean {
  return !hasReservedPrefix(id);
}

/**
 * Validate that an ID matches the required format
 */
export function validateIdFormat(id: string): boolean {
  return VALID_ID_PATTERN.test(id);
}

/**
 * Validate a target ID for registration
 * Combines reserved prefix check and format validation
 *
 * @param id - ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateTargetIdForRegistration(id: string): ValidationResult {
  if (!id) {
    return { valid: false, error: 'ID cannot be empty' };
  }

  if (hasReservedPrefix(id)) {
    return {
      valid: false,
      error: `ID cannot start with reserved prefix: ${RESERVED_PREFIXES.join(', ')}`,
    };
  }

  if (!validateIdFormat(id)) {
    return {
      valid: false,
      error: `ID must match pattern: ${VALID_ID_PATTERN}`,
    };
  }

  return { valid: true };
}

// ==================== Types ====================

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Routing error with code
 */
export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly code: RoutingErrorCode
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

/**
 * Routing error codes
 */
export type RoutingErrorCode =
  | 'INVALID_DOC_ID'
  | 'INVALID_SPACE_ID'
  | 'RESERVED_PREFIX'
  | 'UNKNOWN_TARGET';

// ==================== Route Building ====================

/**
 * Build an agent field value for a document
 */
export function buildDocumentRoute(docId: string): string {
  if (!validateIdFormat(docId)) {
    throw new RoutingError(
      `Invalid document ID format: ${docId}`,
      'INVALID_DOC_ID'
    );
  }
  return `doc/${docId}`;
}

/**
 * Build an agent field value for a space
 */
export function buildSpaceRoute(spaceId: string): string {
  if (!validateIdFormat(spaceId)) {
    throw new RoutingError(
      `Invalid space ID format: ${spaceId}`,
      'INVALID_SPACE_ID'
    );
  }
  return `space/${spaceId}`;
}

// ==================== Future Migration Path ====================

/**
 * Future namespace format (not used yet, reserved for migration)
 *
 * Current: doc/xxx, space/xxx
 * Future:  pc:doc:xxx, pc:space:xxx
 *
 * This provides an escape hatch if current prefixes conflict
 * with regular agent IDs in the future.
 */
export const FUTURE_NAMESPACE_PREFIX = 'pc:';

/**
 * Check if a value uses the future namespace format
 * (Reserved for future use)
 */
export function usesFutureNamespace(value: string): boolean {
  return value.startsWith(FUTURE_NAMESPACE_PREFIX);
}

/**
 * Parse future namespace format (reserved for future use)
 *
 * Format: pc:<type>:<id>
 * Example: pc:doc:abc123, pc:space:xyz789
 */
export function parseFutureNamespace(value: string): RoutingTarget | null {
  if (!usesFutureNamespace(value)) {
    return null;
  }

  const parts = value.slice(FUTURE_NAMESPACE_PREFIX.length).split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [type, id] = parts;

  if (type === 'doc') {
    return { type: 'document', id, original: value };
  }

  if (type === 'space') {
    return { type: 'space', id, original: value };
  }

  return null;
}

// ==================== Type Guards ====================

/**
 * Check if a routing target is a document
 */
export function isDocumentTarget(target: RoutingTarget): boolean {
  return target.type === 'document';
}

/**
 * Check if a routing target is a space
 */
export function isSpaceTarget(target: RoutingTarget): boolean {
  return target.type === 'space';
}

/**
 * Check if a routing target is a regular agent
 */
export function isAgentTarget(target: RoutingTarget): boolean {
  return target.type === 'agent';
}
