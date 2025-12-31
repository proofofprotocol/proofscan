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

/**
 * Secret reference patterns:
 * - "secret://..." - External/user-provided secret references (Phase 3.4)
 * - "dpapi:xxx" - Windows DPAPI-encrypted secrets (Phase 3.5)
 * - "keychain:xxx" - macOS Keychain secrets (Phase 3.5, future)
 *
 * Note: "secret://***" is already masked, so we exclude it
 */
const SECRET_REF_PATTERNS = [
  /^secret:\/\/(?!\*\*\*$)/,  // secret://... (but not secret://*** which is already masked)
  /^dpapi:[a-zA-Z0-9_-]+$/,   // dpapi:xxx (Phase 3.5 internal format)
  /^keychain:[a-zA-Z0-9_-]+$/, // keychain:xxx (Phase 3.5 future format)
];

/** Masked secret reference */
const SECRET_MASKED = 'secret://***';

/**
 * Check if a value matches any secret reference pattern
 */
function isSecretReference(value: string): boolean {
  return SECRET_REF_PATTERNS.some(pattern => pattern.test(value));
}

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
      if (isSecretReference(val)) {
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
