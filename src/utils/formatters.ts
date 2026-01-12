/**
 * Common formatters for proofscan output
 * 
 * Provides consistent formatting utilities for:
 * - Table formatting
 * - Color output
 * - Status indicators
 * - Size formatting
 */

import { isInteractiveTTY } from './platform.js';

/**
 * Terminal width for formatting (fallback to 80)
 */
export const TERM_WIDTH = process.stdout.columns || 80;

/**
 * Check if output is a TTY (for color support)
 * Uses unified isInteractiveTTY for consistency
 */
export function isTTY(): boolean {
  return isInteractiveTTY();
}

/**
 * ANSI color codes (only used if TTY)
 */
export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

/**
 * Apply color to text (only if TTY)
 */
export function color(text: string, colorCode: keyof typeof COLORS): string {
  if (!isTTY()) {
    return text;
  }
  return `${COLORS[colorCode]}${text}${COLORS.reset}`;
}

/**
 * Dim text (for headers, hints)
 */
export function dim(text: string): string {
  return color(text, 'dim');
}

/**
 * Success indicator (green checkmark or OK)
 */
export function success(text: string): string {
  if (!isTTY()) {
    return `✓ ${text}`;
  }
  return `${COLORS.green}✓${COLORS.reset} ${text}`;
}

/**
 * Error indicator (red X or ERROR)
 */
export function error(text: string): string {
  if (!isTTY()) {
    return `✗ ${text}`;
  }
  return `${COLORS.red}✗${COLORS.reset} ${text}`;
}

/**
 * Warning indicator (yellow exclamation)
 */
export function warning(text: string): string {
  if (!isTTY()) {
    return `⚠ ${text}`;
  }
  return `${COLORS.yellow}⚠${COLORS.reset} ${text}`;
}

/**
 * Info indicator (blue i)
 */
export function info(text: string): string {
  if (!isTTY()) {
    return `ℹ ${text}`;
  }
  return `${COLORS.blue}ℹ${COLORS.reset} ${text}`;
}

/**
 * Status badge (colored box)
 */
export function badge(text: string, colorCode: keyof typeof COLORS): string {
  if (!isTTY()) {
    return `[${text}]`;
  }
  return `${COLORS[colorCode]}[${text}]${COLORS.reset}`;
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration in milliseconds to human-readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / (60 * 1000))}m ${Math.floor((ms % (60 * 1000)) / 1000)}s`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}

/**
 * Pad string to specified width
 */
export function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (align === 'left') {
    return text.padEnd(width);
  }
  return text.padStart(width);
}

/**
 * Truncate string to specified width with ellipsis
 */
export function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  return text.slice(0, width - 3) + '...';
}

/**
 * Create a horizontal rule
 */
export function hr(width: number = TERM_WIDTH): string {
  return dim('─'.repeat(width));
}

/**
 * Create a table row with aligned columns
 */
export function tableRow(columns: string[], widths: number[]): string {
  return columns.map((col, i) => pad(col, widths[i])).join('  ');
}

/**
 * Create a table header (dimmed)
 */
export function tableHeader(columns: string[], widths: number[]): string {
  return dim(tableRow(columns, widths));
}

/**
 * Calculate column widths for table data
 * 
 * @param headers - Table headers
 * @param rows - Table rows (each row is an array of strings)
 * @param minWidths - Minimum widths for each column (optional)
 * @returns Array of column widths
 */
export function calculateColumnWidths(
  headers: string[],
  rows: string[][],
  minWidths?: number[]
): number[] {
  const widths = headers.map((h, i) => {
    const contentWidth = Math.max(
      h.length,
      ...rows.map(r => (r[i] || '').length)
    );
    return Math.max(contentWidth, minWidths?.[i] || 0);
  });
  return widths;
}

/**
 * Format a simple table
 * 
 * @param headers - Column headers
 * @param rows - Table rows
 * @param minWidths - Minimum column widths (optional)
 * @returns Formatted table as string
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  minWidths?: number[]
): string {
  const widths = calculateColumnWidths(headers, rows, minWidths);
  const lines: string[] = [];

  // Header
  lines.push(tableHeader(headers, widths));
  lines.push(hr(widths.reduce((sum, w) => sum + w + 2, -2)));

  // Rows
  for (const row of rows) {
    lines.push(tableRow(row, widths));
  }

  return lines.join('\n');
}
