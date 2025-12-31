/**
 * Secrets module (Phase 3.5)
 *
 * Provides secure storage and handling of API keys and sensitive configuration.
 */

// Types and interfaces
export * from './types.js';

// Detection utilities
export {
  isSecretKey,
  isPlaceholder,
  looksLikeRealSecret,
  detectSecret,
  scanEnvForSecrets,
  countSecrets,
  type SecretDetectionResult,
} from './detection.js';

// Redaction utilities
export {
  redactDeep,
  redactValue,
  redactEnv,
  redactionSummary,
  isRedacted,
  REDACTED,
  REDACTED_REF,
  type RedactionResult,
  type RedactionOptions,
} from './redaction.js';

// Store
export {
  SqliteSecretStore,
  getSecretStore,
  closeSecretStore,
} from './store.js';

// Providers
export {
  PlainProvider,
  DpapiProvider,
  getBestProvider,
  getProvider,
} from './providers/index.js';

// Secretize
export {
  secretizeEnv,
  formatSecretizeOutput,
  isSecretizeAvailable,
  type SecretizeKeyResult,
  type SecretizeResult,
  type SecretizeOptions,
  type FormatSecretizeOptions,
} from './secretize.js';

// Management (Phase 3.6)
export {
  listSecretBindings,
  setSecret,
  pruneOrphanSecrets,
  exportSecrets,
  importSecrets,
  type SecretBindingInfo,
  type SetSecretOptions,
  type SetSecretResult,
  type PruneOptions,
  type PruneResult,
  type ExportOptions,
  type ExportResult,
  type ImportOptions,
  type ImportResult,
  type ImportError,
} from './management.js';

// Resolution (Phase 3.6)
export {
  resolveEnvSecrets,
  formatResolveErrors,
  type ResolveEnvSecretsResult,
  type ResolveError,
} from './resolve.js';
