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
} from './secretize.js';
