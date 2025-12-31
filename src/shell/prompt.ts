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
 * Format: proofscan:/path (proto) >
 *
 * Examples:
 *   proofscan:/ >           (root)
 *   proofscan:/time >       (connector)
 *   proofscan:/time (mcp) > (connector with detected proto)
 *   proofscan:/time/47676704 (mcp) > (session)
 */
export function generatePrompt(context: ShellContext): string {
  const parts: string[] = [];

  // proofscan prefix (dim)
  parts.push(color('proofscan', COLORS.dim));

  // Build path
  let path = '/';
  if (context.connector) {
    path = `/${context.connector}`;
    if (context.session) {
      path += `/${shortenSessionId(context.session)}`;
    }
  }

  // Path (cyan for connector, yellow for session)
  if (context.session) {
    const connectorPart = color(`/${context.connector}`, COLORS.cyan);
    const sessionPart = color(`/${shortenSessionId(context.session)}`, COLORS.yellow);
    parts.push(connectorPart + sessionPart);
  } else if (context.connector) {
    parts.push(color(`/${context.connector}`, COLORS.cyan));
  } else {
    parts.push(color('/', COLORS.dim));
  }

  // Proto suffix (only if detected and not '?')
  if (context.proto && context.proto !== '?') {
    parts.push(' ' + color(`(${context.proto})`, getProtoColor(context.proto)));
  }

  return parts.join(':') + ' > ';
}

/**
 * Generate a plain prompt (no colors)
 * Format: proofscan:/path (proto) >
 */
export function generatePlainPrompt(context: ShellContext): string {
  let path = '/';
  if (context.connector) {
    path = `/${context.connector}`;
    if (context.session) {
      path += `/${shortenSessionId(context.session)}`;
    }
  }

  let prompt = `proofscan:${path}`;

  // Proto suffix (only if detected and not '?')
  if (context.proto && context.proto !== '?') {
    prompt += ` (${context.proto})`;
  }

  return prompt + ' > ';
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

/**
 * Get dim text for TTY output (used for table headers)
 *
 * @param text - The text to dim
 * @param isTTY - Whether the output is a TTY (enables ANSI colors)
 * @returns Dim ANSI-styled string if TTY, plain string otherwise
 */
export function dimText(text: string, isTTY?: boolean): string {
  if (!isTTY) return text;
  return `${COLORS.dim}${text}${COLORS.reset}`;
}
