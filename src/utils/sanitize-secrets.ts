/**
 * Secret reference sanitization utilities (Phase 3.4)
 *
 * ProofScan does NOT store actual secret values.
 * This module detects and sanitizes secret references (e.g., "secret://...")
 * so that only the fact that a reference was used is recorded.
 */

/** Result of sanitization */
export interface SanitizeResult {
  /** Sanitized value (same structure, secrets replaced) */
  value: unknown;
  /** Number of secret references found and replaced */
  count: number;
}

/** Secret reference pattern: "secret://..." */
const SECRET_REF_PATTERN = /^secret:\/\//;

/** Masked secret reference */
const SECRET_MASKED = 'secret://***';

/**
 * Recursively sanitize secret references in a JSON-like value.
 *
 * - Replaces string values starting with "secret://" with "secret://***"
 * - Traverses objects and arrays recursively
 * - Returns the sanitized value and count of replacements
 *
 * @param value - Any JSON-serializable value
 * @returns Sanitized value and count of secret references found
 *
 * @example
 * const result = sanitizeSecrets({ env: { API_KEY: "secret://local/foo/API_KEY" } });
 * // result.value = { env: { API_KEY: "secret://***" } }
 * // result.count = 1
 */
export function sanitizeSecrets(value: unknown): SanitizeResult {
  let count = 0;

  function process(val: unknown): unknown {
    // Handle null/undefined
    if (val === null || val === undefined) {
      return val;
    }

    // Handle strings - check for secret reference
    if (typeof val === 'string') {
      if (SECRET_REF_PATTERN.test(val)) {
        count++;
        return SECRET_MASKED;
      }
      return val;
    }

    // Handle arrays
    if (Array.isArray(val)) {
      return val.map(item => process(item));
    }

    // Handle objects
    if (typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(val)) {
        result[key] = process(v);
      }
      return result;
    }

    // Primitives (number, boolean, etc.) - return as-is
    return val;
  }

  const sanitized = process(value);
  return { value: sanitized, count };
}

/**
 * Check if a value contains any secret references
 *
 * @param value - Any JSON-serializable value
 * @returns true if at least one secret reference is found
 */
export function hasSecretRefs(value: unknown): boolean {
  return sanitizeSecrets(value).count > 0;
}

/**
 * Count secret references without sanitizing
 *
 * @param value - Any JSON-serializable value
 * @returns Number of secret references found
 */
export function countSecretRefs(value: unknown): number {
  return sanitizeSecrets(value).count;
}
