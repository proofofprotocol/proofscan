/**
 * Secret redaction utilities (Phase 3.5)
 *
 * Provides deep redaction of secrets in config output.
 * Used by config show, export, and snapshot commands.
 */

import { isSecretRef, SECRET_REF_PATTERN } from './types.js';
import { isSecretKey } from './detection.js';

/** Redacted placeholder for secrets */
export const REDACTED = '***REDACTED***';

/** Redacted placeholder for secret references */
export const REDACTED_REF = '***SECRET_REF***';

/**
 * Result of redaction
 */
export interface RedactionResult {
  /** Redacted value */
  value: unknown;
  /** Number of values redacted */
  count: number;
}

/**
 * Options for redaction
 */
export interface RedactionOptions {
  /** Redact values for secret keys (default: true) */
  redactSecretKeys?: boolean;
  /** Redact secret references like "dpapi:xxx" (default: true) */
  redactSecretRefs?: boolean;
  /** Custom redaction string for values */
  redactedValue?: string;
  /** Custom redaction string for references */
  redactedRef?: string;
}

const DEFAULT_OPTIONS: Required<RedactionOptions> = {
  redactSecretKeys: true,
  redactSecretRefs: true,
  redactedValue: REDACTED,
  redactedRef: REDACTED_REF,
};

/**
 * Recursively redact secrets in a value
 *
 * Handles:
 * - Secret references (dpapi:xxx, keychain:xxx)
 * - Values for keys that match secret patterns
 *
 * @param value - Any JSON-serializable value
 * @param options - Redaction options
 * @returns Redacted value and count
 */
export function redactDeep(
  value: unknown,
  options: RedactionOptions = {}
): RedactionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let count = 0;

  function processValue(val: unknown, parentKey?: string): unknown {
    // Handle null/undefined
    if (val === null || val === undefined) {
      return val;
    }

    // Handle strings
    if (typeof val === 'string') {
      // Check if it's a secret reference
      if (opts.redactSecretRefs && isSecretRef(val)) {
        count++;
        return opts.redactedRef;
      }

      // Check if parent key indicates a secret
      if (opts.redactSecretKeys && parentKey && isSecretKey(parentKey)) {
        // Don't redact empty strings or already-redacted values
        if (val.length > 0 && val !== opts.redactedValue && val !== opts.redactedRef) {
          count++;
          return opts.redactedValue;
        }
      }

      return val;
    }

    // Handle arrays
    if (Array.isArray(val)) {
      return val.map(item => processValue(item, parentKey));
    }

    // Handle objects
    if (typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(val)) {
        result[key] = processValue(v, key);
      }
      return result;
    }

    // Primitives (number, boolean, etc.)
    return val;
  }

  const redacted = processValue(value);
  return { value: redacted, count };
}

/**
 * Redact a single value based on key and options
 *
 * @param key - The key name
 * @param value - The value to potentially redact
 * @param options - Redaction options
 * @returns Redacted value if applicable, original otherwise
 */
export function redactValue(
  key: string,
  value: string,
  options: RedactionOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check if it's a secret reference
  if (opts.redactSecretRefs && isSecretRef(value)) {
    return opts.redactedRef;
  }

  // Check if key indicates a secret
  if (opts.redactSecretKeys && isSecretKey(key)) {
    if (value.length > 0 && value !== opts.redactedValue && value !== opts.redactedRef) {
      return opts.redactedValue;
    }
  }

  return value;
}

/**
 * Redact env variables object
 *
 * @param env - Environment variables
 * @param options - Redaction options
 * @returns Redacted env and count
 */
export function redactEnv(
  env: Record<string, string>,
  options: RedactionOptions = {}
): { env: Record<string, string>; count: number } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let count = 0;
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const redacted = redactValue(key, value, opts);
    if (redacted !== value) {
      count++;
    }
    result[key] = redacted;
  }

  return { env: result, count };
}

/**
 * Create a summary of redacted values
 *
 * @param count - Number of values redacted
 * @returns Human-readable summary
 */
export function redactionSummary(count: number): string {
  if (count === 0) {
    return '';
  }
  if (count === 1) {
    return '(1 secret redacted)';
  }
  return `(${count} secrets redacted)`;
}

/**
 * Check if a value has been redacted
 */
export function isRedacted(value: string): boolean {
  return value === REDACTED || value === REDACTED_REF;
}
