/**
 * Secret reference resolution (Phase 3.6)
 *
 * Resolves secret references (dpapi:<id>, keychain:<id>, plain:<id>) in env vars
 * to their plaintext values at runtime.
 *
 * Security:
 * - Plaintext is only held in memory during process spawn
 * - Never written to disk, logs, or config files
 * - Original env with refs is not modified
 */

import { SqliteSecretStore } from './store.js';
import { parseSecretRef, type ProviderType } from './types.js';
import { getDefaultConfigDir } from '../utils/config-path.js';

/** Result of resolving env secrets */
export interface ResolveEnvSecretsResult {
  /** Resolved env (with plaintext values) - SENSITIVE, in-memory only */
  envResolved: Record<string, string>;
  /** Secret refs that were successfully resolved */
  resolvedRefs: string[];
  /** Errors encountered during resolution */
  errors: ResolveError[];
  /** Whether resolution was fully successful */
  success: boolean;
}

/** Error during secret resolution */
export interface ResolveError {
  /** Environment key */
  key: string;
  /** Secret reference that failed */
  ref: string;
  /** Error message */
  message: string;
  /** Suggested fix command */
  suggestion?: string;
}

/**
 * Resolve secret references in env vars to plaintext values
 *
 * This function should be called just before spawning a child process.
 * The returned envResolved should be passed to spawn() and then
 * immediately discarded (not stored or logged).
 *
 * @param env - Environment variables potentially containing secret refs
 * @param connectorId - Connector ID for error messages and suggestions
 * @param configDir - Config directory (default: ~/.proofscan)
 * @returns Resolved env and any errors
 */
export async function resolveEnvSecrets(
  env: Record<string, string> | undefined,
  connectorId: string,
  configDir?: string
): Promise<ResolveEnvSecretsResult> {
  if (!env || Object.keys(env).length === 0) {
    return {
      envResolved: {},
      resolvedRefs: [],
      errors: [],
      success: true,
    };
  }

  const dir = configDir || getDefaultConfigDir();
  const store = new SqliteSecretStore(dir);
  const envResolved: Record<string, string> = {};
  const resolvedRefs: string[] = [];
  const errors: ResolveError[] = [];

  try {
    for (const [key, value] of Object.entries(env)) {
      // Check if value is a secret reference
      const parsed = parseSecretRef(value);

      if (parsed) {
        // Resolve the secret
        try {
          const plaintext = await store.retrieve(parsed.id);

          if (plaintext === null) {
            // Secret not found
            errors.push({
              key,
              ref: value,
              message: `Secret not found: ${value}`,
              suggestion: `pfscan secrets set ${connectorId} ${key}`,
            });
            // Keep the reference as-is (will cause spawn failure)
            envResolved[key] = value;
          } else {
            // Successfully resolved
            envResolved[key] = plaintext;
            resolvedRefs.push(value);
            // TODO: Update last_used_at in store
          }
        } catch (err) {
          // Decryption or other error
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({
            key,
            ref: value,
            message: `Failed to resolve secret: ${msg}`,
            suggestion: `pfscan secrets set ${connectorId} ${key}`,
          });
          envResolved[key] = value;
        }
      } else {
        // Not a secret reference - pass through as-is
        envResolved[key] = value;
      }
    }

    return {
      envResolved,
      resolvedRefs,
      errors,
      success: errors.length === 0,
    };
  } finally {
    store.close();
  }
}

/**
 * Format resolution errors for user display
 */
export function formatResolveErrors(errors: ResolveError[], connectorId: string): string[] {
  if (errors.length === 0) {
    return [];
  }

  const lines: string[] = [
    `Failed to resolve ${errors.length} secret(s) for connector '${connectorId}':`,
  ];

  for (const err of errors) {
    lines.push(`  ${err.key}: ${err.message}`);
    if (err.suggestion) {
      lines.push(`    Fix: ${err.suggestion}`);
    }
  }

  return lines;
}
