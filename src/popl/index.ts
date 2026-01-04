/**
 * POPL Module Exports (Phase 6.0)
 *
 * Public Observable Proof Ledger
 */

// Types
export {
  POPL_VERSION,
  TRUST_LABELS,
  type TrustLevel,
  type TargetKind,
  type RedactionPolicy,
  type PoplAuthor,
  type PoplTrust,
  type PoplTargetIds,
  type PoplTarget,
  type PoplCaptureSummary,
  type PoplMcpClient,
  type PoplMcpServer,
  type PoplMcp,
  type PoplCaptureWindow,
  type PoplCapture,
  type PoplArtifact,
  type PoplEvidencePolicy,
  type PoplEvidence,
  type PoplEntry,
  type PoplDocument,
  type CreatePoplOptions,
  type CreatePoplResult,
  type PoplConfig,
} from './types.js';

// Sanitizer
export {
  SANITIZER_RULESET_VERSION,
  sanitize,
  sanitizeRpcPayload,
  sanitizeLogLine,
  sanitizeRpcEvent,
  hashValue,
  hashFileContent,
  type SanitizeResult,
} from './sanitizer.js';

// Artifacts
export {
  generateStatusArtifact,
  generateRpcArtifact,
  generateLogsArtifact,
  generateValidationArtifact,
  generateSessionArtifacts,
  type SessionStatus,
  type StatusJson,
  type ArtifactResult,
  type GeneratedArtifacts,
} from './artifacts.js';

// Service
export {
  hasPoplDir,
  getPoplDir,
  getPoplEntriesDir,
  initPoplDir,
  loadPoplConfig,
  createSessionPoplEntry,
  listPoplEntries,
  readPoplEntry,
} from './service.js';
