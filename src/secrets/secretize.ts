/**
 * Secretize utilities (Phase 3.5)
 *
 * Processes env variables to detect secrets, store them securely,
 * and replace with secret references.
 *
 * Security note: On non-Windows platforms, secrets are stored using the
 * 'plain' provider (base64 encoded, not encrypted). For production use
 * on non-Windows systems, consider implementing keychain support.
 */

import { detectSecret } from './detection.js';
import { SqliteSecretStore } from './store.js';
import { dirname } from 'path';

/** Maximum characters to display for secret references in output */
const DISPLAY_REF_MAX_LENGTH = 20;

/**
 * Result of secretizing a single key-value pair
 */
export interface SecretizeKeyResult {
  /** The key name */
  key: string;
  /** Original value */
  originalValue: string;
  /** New value (may be dpapi:xxx or original) */
  newValue: string;
  /** Action taken */
  action: 'stored' | 'placeholder' | 'skipped';
  /** Secret reference if stored */
  secretRef?: string;
}

/**
 * Result of secretizing an env object
 */
export interface SecretizeResult {
  /** Processed env object with secret references */
  env: Record<string, string>;
  /** Individual results for each key */
  results: SecretizeKeyResult[];
  /** Count of secrets stored */
  storedCount: number;
  /** Count of placeholders detected */
  placeholderCount: number;
}

/**
 * Options for secretize
 */
export interface SecretizeOptions {
  /** Config file path (for secrets.db location) */
  configPath: string;
  /** Connector ID (for metadata) */
  connectorId: string;
  /** Optional: reuse existing store instance for batch operations */
  store?: SqliteSecretStore;
}

/**
 * Secretize env variables
 *
 * For each key-value pair:
 * - If key matches secret pattern and value is a real secret: store in DPAPI, replace with dpapi:xxx
 * - If key matches secret pattern and value is placeholder: warn, keep original
 * - Otherwise: keep original
 *
 * @param env - Environment variables to process
 * @param options - Options including configPath for secrets.db location
 * @returns Processed env and detailed results
 */
export async function secretizeEnv(
  env: Record<string, string>,
  options: SecretizeOptions
): Promise<SecretizeResult> {
  const results: SecretizeKeyResult[] = [];
  const processedEnv: Record<string, string> = {};
  let storedCount = 0;
  let placeholderCount = 0;

  // Use provided store or create new one
  // When processing multiple connectors, caller should provide a shared store
  // to avoid opening/closing the database repeatedly
  const configDir = dirname(options.configPath);
  const store = options.store ?? new SqliteSecretStore(configDir);
  const shouldCloseStore = !options.store; // Only close if we created it

  try {
    for (const [key, value] of Object.entries(env)) {
      const detection = detectSecret(key, value);

      if (detection.action === 'store') {
        // Store the secret
        const storeResult = await store.store(value, {
          source: `${options.connectorId}.transport.env.${key}`,
        });

        processedEnv[key] = storeResult.reference;
        results.push({
          key,
          originalValue: value,
          newValue: storeResult.reference,
          action: 'stored',
          secretRef: storeResult.reference,
        });
        storedCount++;
      } else if (detection.action === 'warn') {
        // Placeholder detected - keep original, will warn user
        processedEnv[key] = value;
        results.push({
          key,
          originalValue: value,
          newValue: value,
          action: 'placeholder',
        });
        placeholderCount++;
      } else {
        // Not a secret key - keep original
        processedEnv[key] = value;
        results.push({
          key,
          originalValue: value,
          newValue: value,
          action: 'skipped',
        });
      }
    }
  } finally {
    if (shouldCloseStore) {
      store.close();
    }
  }

  return {
    env: processedEnv,
    results,
    storedCount,
    placeholderCount,
  };
}

/**
 * Format secretize results for output
 *
 * @param results - Individual key results
 * @param connectorId - Connector ID for path display
 * @returns Array of formatted output lines
 */
export function formatSecretizeOutput(
  results: SecretizeKeyResult[],
  connectorId: string
): string[] {
  const lines: string[] = [];

  for (const result of results) {
    if (result.action === 'stored' && result.secretRef) {
      // Shorten the reference for display: dpapi:abc12345-... -> dpapi:abc12345
      const shortRef = result.secretRef.length > DISPLAY_REF_MAX_LENGTH
        ? result.secretRef.slice(0, DISPLAY_REF_MAX_LENGTH) + '...'
        : result.secretRef;
      lines.push(`  ✔ secret stored: ${connectorId}.transport.env.${result.key} -> ${shortRef}`);
    } else if (result.action === 'placeholder') {
      lines.push(`  ⚠ placeholder detected: ${connectorId}.transport.env.${result.key}`);
    }
  }

  return lines;
}

/**
 * Check if secretize is available on this platform
 */
export function isSecretizeAvailable(): boolean {
  // For now, secretize is available on all platforms
  // The provider will fall back to plain provider if DPAPI is not available
  return true;
}
