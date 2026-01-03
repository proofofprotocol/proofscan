/**
 * Proxy Logger Module (Phase 5.0)
 *
 * Structured logging to stderr only (stdout reserved for JSON-RPC).
 *
 * Log levels:
 * - ERROR: Always output (red)
 * - WARN: Always output (yellow)
 * - INFO: Only when verbose mode enabled (no color)
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const COLORS = {
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  RESET: '\x1b[0m',
} as const;

/** Global verbose flag - set by proxy command */
let verboseMode = false;

/**
 * Get current time in HH:MM:SS format
 */
function now(): string {
  return new Date().toISOString().slice(11, 19);
}

/**
 * Internal log function
 */
function log(level: LogLevel, msg: string): void {
  // INFO is only shown in verbose mode
  if (level === 'INFO' && !verboseMode) {
    return;
  }

  const prefix = `[${now()}] [${level}] `;

  if (level === 'INFO') {
    // INFO: no color
    process.stderr.write(prefix + msg + '\n');
  } else {
    // WARN/ERROR: with color
    const color = COLORS[level];
    process.stderr.write(color + prefix + msg + COLORS.RESET + '\n');
  }
}

/**
 * Set verbose mode (enables INFO logs)
 */
export function setVerbose(enabled: boolean): void {
  verboseMode = enabled;
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return verboseMode;
}

/**
 * Logger instance
 */
export const logger = {
  /**
   * Info level - only shown when verbose mode is enabled
   */
  info: (msg: string): void => log('INFO', msg),

  /**
   * Warning level - always shown (yellow)
   */
  warn: (msg: string): void => log('WARN', msg),

  /**
   * Error level - always shown (red)
   */
  error: (msg: string): void => log('ERROR', msg),
};
