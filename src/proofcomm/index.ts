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
 * Phase 2: Skill Routing
 * - @skill: routing prefix (routing.ts)
 * - Skill cache (db/skills-store.ts)
 * - Skill registry with Pull-type caching (skill-registry.ts)
 *
 * Phase 3: Autonomous Spaces
 * - space/ prefix routing (routing.ts)
 * - Space store (db/spaces-store.ts)
 * - Space manager with G3 broadcast (spaces/space-manager.ts)
 *
 * Future Phases:
 * - Phase 4: ProofPortal MVP
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
  buildSkillRoute,
  // Skill routing constants
  SKILL_ROUTE_PREFIX,
  // Future migration
  usesFutureNamespace,
  parseFutureNamespace,
  // Type guards
  isDocumentTarget,
  isSpaceTarget,
  isAgentTarget,
  isSkillTarget,
} from './routing.js';

// ==================== Skills (Phase 2) ====================
export {
  // Types
  type SkillResolutionResult,
  // Classes
  SkillRegistry,
} from './skill-registry.js';

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

// ==================== Spaces (Phase 3) ====================
export {
  // Types
  type SpaceError,
  type SpaceErrorCode,
  type SpaceResult,
  type BroadcastResult,
  type SpaceBroadcastRequest,
  type DispatchToAgentFn,
  type MessagePart as SpaceMessagePart,  // Alias to avoid conflict with document MessagePart
  // Classes
  SpaceManager,
} from './spaces/index.js';
