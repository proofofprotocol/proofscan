/**
 * ProofComm - Agent Communication Gateway
 *
 * ProofComm extends Proofscan into an Agent Communication Platform,
 * enabling autonomous agent-to-agent communication, skill discovery,
 * and observable agent collaboration.
 *
 * Phase 0: Foundation
 * - G1: metadata_json contract (events.ts)
 * - G2: Reserved Namespace (routing.ts)
 *
 * Phase 1: Resident Documents
 * - Document agent system (document/*.ts)
 * - DB store for documents (db/documents-store.ts)
 *
 * Future Phases:
 * - Phase 2: Skill Routing
 * - Phase 3: Autonomous Spaces
 */

// ==================== Events (G1) ====================
export {
  // Types
  type ProofCommEventKind,
  type AllEventKind,
  type ProofCommAction,
  type ProofCommMetadata,
  type ProofCommEventBaseOptions,
  // Core function
  emitProofCommEvent,
  // Convenience emitters
  emitSpaceEvent,
  emitSkillEvent,
  emitDocumentEvent,
  emitRouteEvent,
  // Utilities
  truncatePreview,
  extractMessageText,
  createMessagePreview,
  isProofCommEventKind,
  isValidAction,
} from './events.js';

// ==================== Routing (G2) ====================
export {
  // Constants
  RESERVED_PREFIXES,
  VALID_ID_PATTERN,
  FUTURE_NAMESPACE_PREFIX,
  // Types
  type ReservedPrefix,
  type RoutingTargetType,
  type RoutingTarget,
  type ValidationResult,
  type RoutingErrorCode,
  // Classes
  RoutingError,
  // Core functions
  parseAgentField,
  // Validation
  hasReservedPrefix,
  validateTargetId,
  validateIdFormat,
  validateTargetIdForRegistration,
  // Route building
  buildDocumentRoute,
  buildSpaceRoute,
  // Future migration
  usesFutureNamespace,
  parseFutureNamespace,
  // Type guards
  isDocumentTarget,
  isSpaceTarget,
  isAgentTarget,
} from './routing.js';

// ==================== Documents (Phase 1) ====================
export {
  // Types
  type DocumentContent,
  type DocumentContext,
  type DocumentMemoryState,
  type TextPart,
  type DataPart,
  type MessagePart,
  type DocumentMessage,
  type DocumentResponse,
  type RegisterDocumentRequest,
  type RegisterDocumentResult,
  type DocumentRegistrationConfig,
  type DocumentInfo,
  type ReadDocumentOptions,
  type ResponderOptions,
  // Type guards
  isTextPart,
  isDataPart,
  // Utilities
  extractText,
  a2aToDocumentMessage,
  documentResponseToA2AParts,
  // Store functions
  DocumentStoreError,
  computeHash,
  detectMimeType,
  fileExists,
  readDocument,
  hasDocumentChanged,
  getDocumentName,
  validateDocumentPath,
  // Classes
  DocumentMemoryManager,
  DocumentResponder,
} from './document/index.js';
