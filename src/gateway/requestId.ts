/**
 * Request ID generation using ULID
 * Phase 8.1: HTTP server foundation
 *
 * ULID is used for request_id because:
 * - Time-sortable (useful for log analysis)
 * - Lexicographically sortable
 * - Case-insensitive
 * - No special characters
 */

import { ulid } from 'ulid';

/**
 * Generate a new request ID
 * @returns ULID string (26 characters)
 */
export function generateRequestId(): string {
  return ulid();
}

/**
 * Generate a trace ID
 * For distributed tracing, clients may provide their own trace_id.
 * If not provided, generate one.
 * @returns ULID string
 */
export function generateTraceId(): string {
  return ulid();
}

/** ULID length is always 26 characters */
const ULID_LENGTH = 26;

/**
 * Extract timestamp from request ID
 * @param requestId ULID request ID
 * @returns Date object or null if invalid
 */
export function getRequestTimestamp(requestId: string): Date | null {
  try {
    // Validate ULID length
    if (!requestId || requestId.length !== ULID_LENGTH) {
      return null;
    }

    // ULID timestamp is first 10 characters (48 bits Crockford Base32)
    const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const normalized = requestId.toUpperCase();

    let timestamp = 0;
    for (let i = 0; i < 10; i++) {
      const char = normalized[i];
      const value = ENCODING.indexOf(char);
      if (value === -1) return null;
      timestamp = timestamp * 32 + value;
    }

    return new Date(timestamp);
  } catch {
    return null;
  }
}
