/**
 * Time formatting utilities
 */

/**
 * Format a timestamp as relative time (e.g., "2h ago", "3d ago")
 *
 * @param timestamp - ISO timestamp string or Date object
 * @returns Human-readable relative time string
 *
 * @example
 * formatRelativeTime('2025-12-31T10:00:00Z') // "2h ago" (if now is 12:00)
 * formatRelativeTime(new Date()) // "just now"
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
