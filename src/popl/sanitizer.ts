/**
 * POPL Sanitizer (Phase 6.0)
 *
 * Sanitization ruleset v1 for public disclosure safety.
 *
 * Rules:
 * 1. Path removal - Windows and POSIX absolute paths
 * 2. Secret token removal - Authorization, Bearer, api_key, token, secret
 * 3. RPC payload handling - Replace values with hashes, keep key structure
 */

import { createHash } from 'crypto';

/** Current sanitization ruleset version */
export const SANITIZER_RULESET_VERSION = 1;

/** Redacted placeholder for paths */
const REDACTED_PATH = '<redacted:path>';

/** Redacted placeholder for secrets */
const REDACTED_SECRET = '<redacted:secret>';

/** Redacted placeholder for values (RPC payloads) */
const REDACTED_VALUE = '<redacted:value>';

/**
 * Patterns for detecting absolute paths
 */
const PATH_PATTERNS = [
  // Windows: C:\Users\... or D:\...
  /^[A-Za-z]:\\[^\s"']+/,
  // Windows: \\server\share
  /^\\\\[^\s"']+/,
  // POSIX: /home/... /Users/... /var/... etc.
  /^\/(?:home|Users|var|tmp|etc|opt|usr|root|mnt|media|srv|private)[^\s"']*/,
  // Generic POSIX paths starting with / followed by word chars
  /^\/[a-zA-Z0-9_-]+(?:\/[^\s"']*)?/,
];

/**
 * Patterns for detecting secret-like keys
 */
const SECRET_KEY_PATTERNS = [
  /^api[_-]?key$/i,
  /^auth(?:orization)?$/i,
  /^bearer$/i,
  /^token$/i,
  /^secret$/i,
  /^password$/i,
  /^passwd$/i,
  /^credential/i,
  /^private[_-]?key$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^session[_-]?(?:id|token)$/i,
  /^cookie$/i,
  /^x-api-key$/i,
  /^x-auth/i,
];

/**
 * Patterns for detecting secret-like values
 */
const SECRET_VALUE_PATTERNS = [
  // Bearer tokens
  /^Bearer\s+[A-Za-z0-9._-]+/i,
  // Authorization header
  /^Basic\s+[A-Za-z0-9+/=]+/i,
  // JWT-like tokens (three base64 sections)
  /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  // API keys (long alphanumeric strings)
  /^[a-zA-Z0-9_-]{32,}$/,
  // Hedera keys
  /^302[a-fA-F0-9]{64,}/,
  // secret:// references (not already masked)
  /^secret:\/\/(?!\*\*\*$)/,
  // dpapi: references
  /^dpapi:[a-zA-Z0-9_-]+$/,
];

/**
 * Result of sanitization
 */
export interface SanitizeResult {
  /** Sanitized value */
  value: unknown;
  /** Number of items redacted */
  redactedCount: number;
  /** Categories of redactions made */
  redactedCategories: Set<'path' | 'secret' | 'value'>;
}

/**
 * Check if a string looks like an absolute path
 */
function isAbsolutePath(value: string): boolean {
  return PATH_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Check if a key name suggests it contains a secret
 */
function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Check if a value looks like a secret
 */
function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Compute SHA-256 hash of a value (first 16 chars)
 */
export function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const hash = createHash('sha256').update(str, 'utf8').digest('hex');
  return hash.slice(0, 16);
}

/**
 * Sanitize a JSON-like value for public disclosure.
 *
 * @param value - Any JSON-serializable value
 * @param options - Sanitization options
 * @returns Sanitized value and statistics
 */
export function sanitize(
  value: unknown,
  options: { deep?: boolean; context?: { key?: string } } = {}
): SanitizeResult {
  let redactedCount = 0;
  const redactedCategories = new Set<'path' | 'secret' | 'value'>();

  function process(val: unknown, key?: string): unknown {
    // Null/undefined pass through
    if (val === null || val === undefined) {
      return val;
    }

    // String processing
    if (typeof val === 'string') {
      // Check for paths
      if (isAbsolutePath(val)) {
        redactedCount++;
        redactedCategories.add('path');
        return REDACTED_PATH;
      }

      // Check for secret values
      if (isSecretValue(val)) {
        redactedCount++;
        redactedCategories.add('secret');
        return REDACTED_SECRET;
      }

      // Check if key suggests secret
      if (key && isSecretKey(key) && val.length > 0) {
        redactedCount++;
        redactedCategories.add('secret');
        return REDACTED_SECRET;
      }

      return val;
    }

    // Array processing
    if (Array.isArray(val)) {
      return val.map((item, i) => process(item, String(i)));
    }

    // Object processing
    if (typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        result[k] = process(v, k);
      }
      return result;
    }

    // Primitives (number, boolean) pass through
    return val;
  }

  const sanitized = process(value, options.context?.key);
  return { value: sanitized, redactedCount, redactedCategories };
}

/**
 * Sanitize RPC payload for public disclosure.
 *
 * This is more aggressive than general sanitization:
 * - Replaces all argument values with hashes
 * - Keeps key structure for auditability
 * - Stores original hash for verification
 *
 * @param payload - RPC arguments or result
 * @returns Sanitized structure with hashes
 */
export function sanitizeRpcPayload(
  payload: Record<string, unknown> | null | undefined
): {
  sanitized: Record<string, unknown> | null;
  payload_sha256: string;
  keys: string[];
} {
  if (payload === null || payload === undefined) {
    return {
      sanitized: null,
      payload_sha256: hashValue(null),
      keys: [],
    };
  }

  // Get original hash before any processing
  const payload_sha256 = hashValue(payload);

  // Extract keys
  const keys = Object.keys(payload);

  // Create sanitized version with value hashes
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = {
      _type: typeof value,
      _hash: hashValue(value),
    };
  }

  return { sanitized, payload_sha256, keys };
}

/**
 * Sanitize a log line for public disclosure.
 *
 * @param line - Log line object
 * @returns Sanitized log line
 */
export function sanitizeLogLine(
  line: Record<string, unknown>
): Record<string, unknown> {
  const result = sanitize(line);
  return result.value as Record<string, unknown>;
}

/**
 * Sanitize RPC event for public disclosure.
 *
 * @param event - RPC event object from events.db
 * @returns Sanitized event
 */
export function sanitizeRpcEvent(event: {
  event_id: string;
  session_id: string;
  rpc_id: string | null;
  direction: string;
  kind: string;
  ts: string;
  seq: number | null;
  summary: string | null;
  payload_hash: string | null;
  raw_json: string | null;
}): Record<string, unknown> {
  // Basic fields (safe to include)
  const sanitized: Record<string, unknown> = {
    event_id: event.event_id,
    session_id: event.session_id,
    rpc_id: event.rpc_id,
    direction: event.direction,
    kind: event.kind,
    ts: event.ts,
    seq: event.seq,
    summary: event.summary ? sanitize(event.summary).value : null,
    payload_hash: event.payload_hash,
  };

  // Process raw_json if present
  if (event.raw_json) {
    try {
      const parsed = JSON.parse(event.raw_json);

      // For request/response, sanitize params/result
      if (parsed.params) {
        const { sanitized: sanParams, payload_sha256, keys } = sanitizeRpcPayload(
          parsed.params as Record<string, unknown>
        );
        sanitized.params_keys = keys;
        sanitized.params_sha256 = payload_sha256;
        // Don't include sanitized params - just keys and hash
      }

      if (parsed.result !== undefined) {
        const resultHash = hashValue(parsed.result);
        sanitized.result_sha256 = resultHash;
        sanitized.result_type = typeof parsed.result;
      }

      if (parsed.error) {
        // Error codes/messages are generally safe
        sanitized.error_code = parsed.error.code;
        sanitized.error_message = sanitize(parsed.error.message).value;
      }

      // Method name is safe
      if (parsed.method) {
        sanitized.method = parsed.method;
      }
    } catch {
      // If parsing fails, just note that
      sanitized.raw_json_parse_error = true;
    }
  }

  return sanitized;
}

/**
 * Compute SHA-256 hash of file contents
 */
export function hashFileContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
