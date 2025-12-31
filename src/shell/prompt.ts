/**
 * Shell prompt generation with color support
 */

import type { ShellContext } from './types.js';

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};

/**
 * Check if color output is supported
 */
export function supportsColor(): boolean {
  // Respect NO_COLOR environment variable
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  // Check if stdout is a TTY
  return process.stdout.isTTY === true;
}

/**
 * Apply color if supported
 */
function color(text: string, colorCode: string): string {
  if (!supportsColor()) {
    return text;
  }
  return `${colorCode}${text}${COLORS.reset}`;
}

/**
 * Shorten session ID to prefix
 */
export function shortenSessionId(sessionId: string, length: number = 8): string {
  return sessionId.slice(0, length);
}

/**
 * Get color for proto type
 */
function getProtoColor(proto: string): string {
  switch (proto) {
    case 'mcp':
      return COLORS.green;
    case 'a2a':
      return COLORS.cyan;
    default:
      return COLORS.dim;
  }
}

/**
 * Generate the shell prompt string
 * Format: proofscan|<proto>|<connector>|<sessionPrefix>>
 */
export function generatePrompt(context: ShellContext): string {
  const parts: string[] = [];

  // proofscan (dim)
  parts.push(color('proofscan', COLORS.dim));

  // proto (colored by type) or * if not set
  const proto = context.proto || '*';
  parts.push(color(proto, getProtoColor(proto)));

  // connector (cyan) or * if not set
  const connector = context.connector || '*';
  parts.push(color(connector, COLORS.cyan));

  // session prefix (yellow) or * if connector is set but no session
  if (context.session) {
    parts.push(color(shortenSessionId(context.session), COLORS.yellow));
  } else if (context.connector) {
    parts.push(color('*', COLORS.dim));
  }

  return parts.join('|') + '> ';
}

/**
 * Generate a plain prompt (no colors)
 */
export function generatePlainPrompt(context: ShellContext): string {
  const parts: string[] = ['proofscan'];

  parts.push(context.proto || '*');
  parts.push(context.connector || '*');

  if (context.session) {
    parts.push(shortenSessionId(context.session));
  } else if (context.connector) {
    parts.push('*');
  }

  return parts.join('|') + '> ';
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(color('✓ ' + message, COLORS.green));
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.error(color('✗ ' + message, COLORS.red));
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(color(message, COLORS.dim));
}
