/**
 * Event types for proofscan
 * Legacy - Phase2 uses db/types.ts
 */

export const MAX_RAW_SIZE = 10000; // Truncate raw data if larger than 10KB

export function truncateRaw(raw: string): string {
  if (raw.length <= MAX_RAW_SIZE) return raw;
  return raw.slice(0, MAX_RAW_SIZE) + '... [truncated]';
}
