/**
 * Secret detection utilities (Phase 3.5)
 *
 * Detects sensitive keys and placeholder values in configuration.
 * Used during config import/paste/set to auto-detect secrets.
 */

/**
 * Patterns that indicate a key is for sensitive data
 * Case-insensitive matching
 */
const SECRET_KEY_PATTERNS = [
  /api[-_]?key/i,
  /apikey/i,
  /api[-_]?token/i,
  /access[-_]?key/i,
  /access[-_]?token/i,
  /secret[-_]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /bearer/i,
  /authorization/i,
  /auth[-_]?token/i,
  /private[-_]?key/i,
  /credentials?/i,
  /client[-_]?secret/i,
];

/**
 * Placeholder patterns that indicate a value should be replaced
 * Case-insensitive matching
 */
const PLACEHOLDER_PATTERNS = [
  /^your[-_\s]?api[-_\s]?key$/i,
  /^your[-_\s]?token$/i,
  /^your[-_\s]?secret$/i,
  /^your[-_\s]?password$/i,
  /^your[-_\s]?.*[-_\s]?here$/i,
  /^<.*>$/,  // <YOUR_API_KEY>
  /^\[.*\]$/,  // [YOUR_API_KEY]
  /^{.*}$/,  // {YOUR_API_KEY}
  /^changeme$/i,
  /^change[-_\s]?me$/i,
  /^xxx+$/i,
  /^placeholder$/i,
  /^replace[-_\s]?me$/i,
  /^todo$/i,
  /^fixme$/i,
  /^insert[-_\s]?here$/i,
  /^sk[-_]xxx/i,  // sk-xxxxxxxx
  /^pk[-_]xxx/i,  // pk-xxxxxxxx
];

/**
 * Values that look like real secrets (for validation)
 * These patterns help identify actual API keys vs. placeholders
 */
const REAL_SECRET_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,  // OpenAI API key
  /^pk-[a-zA-Z0-9]{20,}$/,  // Some provider public key
  /^ghp_[a-zA-Z0-9]{36,}$/,  // GitHub PAT
  /^gho_[a-zA-Z0-9]{36,}$/,  // GitHub OAuth token
  /^github_pat_[a-zA-Z0-9_]{22,}$/,  // GitHub fine-grained PAT
  /^[A-Za-z0-9+/=]{20,}$/,  // Generic base64-ish token
];

/**
 * Check if a key name indicates a secret/sensitive value
 *
 * @param key - The key name to check (e.g., "OPENAI_API_KEY")
 * @returns true if the key likely holds a secret
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Check if a value is a placeholder that needs to be replaced
 *
 * @param value - The value to check
 * @returns true if the value is a placeholder
 */
export function isPlaceholder(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  // Empty or very short values are not placeholders
  if (trimmed.length < 3) {
    return false;
  }

  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Check if a value looks like a real secret (not a placeholder)
 *
 * @param value - The value to check
 * @returns true if the value appears to be a real secret
 */
export function looksLikeRealSecret(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  // Check for known secret formats
  if (REAL_SECRET_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return true;
  }

  // Heuristic: long alphanumeric strings are likely secrets
  // Minimum 20 chars, mostly alphanumeric with some special chars
  if (trimmed.length >= 20 && /^[a-zA-Z0-9_\-+=/.]{20,}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Detection result for a key-value pair
 */
export interface SecretDetectionResult {
  /** The key name */
  key: string;
  /** The original value */
  value: string;
  /** Whether the key indicates a secret */
  isSecretKey: boolean;
  /** Whether the value is a placeholder */
  isPlaceholder: boolean;
  /** Whether the value looks like a real secret */
  looksLikeSecret: boolean;
  /** Recommended action */
  action: 'store' | 'warn' | 'skip';
}

/**
 * Detect if a key-value pair is a secret and determine action
 *
 * @param key - The key name
 * @param value - The value
 * @returns Detection result with recommended action
 */
export function detectSecret(key: string, value: string): SecretDetectionResult {
  const secretKey = isSecretKey(key);
  const placeholder = isPlaceholder(value);
  const looksReal = looksLikeRealSecret(value);

  let action: 'store' | 'warn' | 'skip';

  if (secretKey && placeholder) {
    // Secret key with placeholder value - warn user
    action = 'warn';
  } else if (secretKey && looksReal) {
    // Secret key with real-looking value - store securely
    action = 'store';
  } else if (secretKey) {
    // Secret key with unknown value format - store to be safe
    action = 'store';
  } else {
    // Not a secret key - skip
    action = 'skip';
  }

  return {
    key,
    value,
    isSecretKey: secretKey,
    isPlaceholder: placeholder,
    looksLikeSecret: looksReal,
    action,
  };
}

/**
 * Scan an env object for secrets
 *
 * @param env - Environment variables object
 * @returns Array of detection results for secret keys
 */
export function scanEnvForSecrets(env: Record<string, string>): SecretDetectionResult[] {
  const results: SecretDetectionResult[] = [];

  for (const [key, value] of Object.entries(env)) {
    const result = detectSecret(key, value);
    if (result.isSecretKey) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Count secrets in an env object
 *
 * @param env - Environment variables object
 * @returns Object with counts by action type
 */
export function countSecrets(env: Record<string, string>): {
  toStore: number;
  warnings: number;
  total: number;
} {
  const results = scanEnvForSecrets(env);

  return {
    toStore: results.filter(r => r.action === 'store').length,
    warnings: results.filter(r => r.action === 'warn').length,
    total: results.length,
  };
}
