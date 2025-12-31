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
import type { ProviderType } from './types.js';
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
  /** Provider type used for storage (dpapi, keychain, or plain) */
  providerType?: ProviderType;
}

/**
 * Options for secretize
 */
export interface SecretizeOptions {
  /** Config file path (for secrets.db location) */
  configPath: string;
  /** Connector ID (for metadata) */
  connectorId: string;
  /**
   * Optional: reuse existing store instance for batch operations.
   *
   * Lifecycle contract:
   * - If provided: Caller is responsible for closing the store after all operations.
   *   The secretizeEnv function will NOT close the store.
   * - If not provided: A new store will be created and automatically closed
   *   when secretizeEnv completes (even if an error occurs).
   *
   * Example usage for batch operations:
   * ```typescript
   * const store = new SqliteSecretStore(configDir);
   * try {
   *   for (const connector of connectors) {
   *     await secretizeEnv(connector.env, { configPath, connectorId, store });
   *   }
   * } finally {
   *   store.close();
   * }
   * ```
   */
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
  const providerType = store.getProviderType();

  try {
    for (const [key, value] of Object.entries(env)) {
      const detection = detectSecret(key, value);

      if (detection.action === 'store') {
        // Store the secret - wrap in try/catch to handle individual failures gracefully
        try {
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
        } catch (error) {
          // If storing fails, keep original value and treat as placeholder (warn)
          // This prevents partial failures from breaking the entire operation
          console.error(`Warning: Failed to store secret for ${key}: ${error instanceof Error ? error.message : String(error)}`);
          processedEnv[key] = value;
          results.push({
            key,
            originalValue: value,
            newValue: value,
            action: 'placeholder',
          });
          placeholderCount++;
        }
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
    providerType,
  };
}

/**
 * Options for formatting secretize output
 */
export interface FormatSecretizeOptions {
  /** Provider type used (to show warning if plain) */
  providerType?: ProviderType;
}

/**
 * Format secretize results for output
 *
 * @param results - Individual key results
 * @param connectorId - Connector ID for path display
 * @param options - Optional formatting options
 * @returns Array of formatted output lines
 */
export function formatSecretizeOutput(
  results: SecretizeKeyResult[],
  connectorId: string,
  options: FormatSecretizeOptions = {}
): string[] {
  const lines: string[] = [];

  // Add warning if using plain provider (unencrypted storage)
  const hasStoredSecrets = results.some(r => r.action === 'stored');
  if (options.providerType === 'plain' && hasStoredSecrets) {
    lines.push(`  ⚠ WARNING: Secrets stored with 'plain' provider (base64 only, NOT encrypted)`);
    lines.push(`    On Windows, secrets are encrypted with DPAPI. On other platforms,`);
    lines.push(`    consider using environment variables or a dedicated secrets manager.`);
  }

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
