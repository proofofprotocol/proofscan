/**
 * Proxy Logger Module (Phase 5.0+)
 *
 * Structured logging to stderr only (stdout reserved for JSON-RPC).
 * Includes ring buffer for CLI log viewing.
 *
 * Log levels:
 * - ERROR: Always output (red)
 * - WARN: Always output (yellow)
 * - INFO: Only when verbose mode enabled (no color)
 */

import { appendFile, readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const COLORS = {
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  RESET: '\x1b[0m',
} as const;

export { COLORS as LOG_COLORS };

/** Global verbose flag - set by proxy command */
let verboseMode = false;

/** Global ring buffer instance */
let ringBuffer: LogRingBuffer | null = null;

/** Log entry structure for ring buffer */
export interface LogEntry {
  /** Timestamp in ISO format */
  ts: string;
  /** Log level */
  level: LogLevel;
  /** Category (optional, e.g., 'router', 'aggregator') */
  category?: string;
  /** Log message */
  message: string;
}

/** Ring buffer configuration */
export interface RingBufferConfig {
  /** Maximum lines to retain (default: 1000) */
  maxLines: number;
  /** Path to log file */
  logPath: string;
  /** Callback when buffer count changes */
  onCountChange?: (count: number) => void;
}

/**
 * Log Ring Buffer
 *
 * Appends logs to JSONL file with automatic rotation.
 * Oldest entries are discarded when maxLines is exceeded.
 */
export class LogRingBuffer {
  private readonly config: RingBufferConfig;
  private lineCount: number = 0;
  private pendingWrites: Promise<void> = Promise.resolve();

  constructor(config: RingBufferConfig) {
    this.config = config;
    // Initialize line count asynchronously
    this.initLineCount().catch(() => {
      // Ignore initialization errors
    });
  }

  /**
   * Initialize line count from existing file
   */
  private async initLineCount(): Promise<void> {
    if (!existsSync(this.config.logPath)) {
      this.lineCount = 0;
      return;
    }

    try {
      const content = await readFile(this.config.logPath, 'utf-8');
      this.lineCount = content.split('\n').filter((line) => line.trim()).length;
    } catch {
      this.lineCount = 0;
    }
  }

  /**
   * Append a log entry
   */
  async append(entry: LogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';

    // Chain writes to avoid race conditions
    this.pendingWrites = this.pendingWrites.then(async () => {
      try {
        await appendFile(this.config.logPath, line, 'utf-8');
        this.lineCount++;

        // Check if rotation needed
        if (this.lineCount > this.config.maxLines) {
          await this.rotate();
        }

        // Notify count change
        if (this.config.onCountChange) {
          this.config.onCountChange(this.lineCount);
        }
      } catch {
        // Silently ignore write errors
      }
    });

    await this.pendingWrites;
  }

  /**
   * Read last N entries
   */
  async tail(
    n: number,
    filter?: { level?: string }
  ): Promise<LogEntry[]> {
    if (!existsSync(this.config.logPath)) {
      return [];
    }

    try {
      const content = await readFile(this.config.logPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      let entries: LogEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;

          // Apply level filter if specified
          if (filter?.level) {
            const filterLevel = filter.level.toUpperCase();
            const levelPriority: Record<string, number> = {
              INFO: 0,
              WARN: 1,
              ERROR: 2,
            };

            const entryPriority = levelPriority[entry.level] ?? 0;
            const filterPriority = levelPriority[filterLevel] ?? 0;

            if (entryPriority < filterPriority) {
              continue;
            }
          }

          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      // Return last N entries
      return entries.slice(-n);
    } catch {
      return [];
    }
  }

  /**
   * Get current line count
   */
  getCount(): number {
    return this.lineCount;
  }

  /**
   * Rotate buffer (remove oldest entries when over limit)
   */
  private async rotate(): Promise<void> {
    try {
      const content = await readFile(this.config.logPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      // Keep only the newest maxLines/2 lines (aggressive rotation)
      const keepCount = Math.floor(this.config.maxLines / 2);
      const newLines = lines.slice(-keepCount);

      await writeFile(
        this.config.logPath,
        newLines.join('\n') + '\n',
        'utf-8'
      );

      this.lineCount = newLines.length;
    } catch {
      // Ignore rotation errors
    }
  }

  /**
   * Clear the log file
   */
  async clear(): Promise<void> {
    try {
      await writeFile(this.config.logPath, '', 'utf-8');
      this.lineCount = 0;
    } catch {
      // Ignore clear errors
    }
  }
}

/**
 * Initialize ring buffer (called on proxy start)
 */
export function initializeRingBuffer(config: RingBufferConfig): void {
  ringBuffer = new LogRingBuffer(config);
}

/**
 * Get the current ring buffer instance
 */
export function getRingBuffer(): LogRingBuffer | null {
  return ringBuffer;
}

/**
 * Get current time in HH:MM:SS.mmm format
 */
function now(): string {
  return new Date().toISOString().slice(11, 23);
}

/**
 * Internal log function
 */
function log(level: LogLevel, msg: string, category?: string): void {
  // INFO is only shown in verbose mode
  if (level === 'INFO' && !verboseMode) {
    // Still write to ring buffer even if not shown on stderr
    writeToRingBuffer(level, msg, category);
    return;
  }

  const timestamp = now();
  const categoryStr = category ? `[${category}] ` : '';
  const prefix = `[${timestamp}] [${level}] ${categoryStr}`;

  if (level === 'INFO') {
    // INFO: no color
    process.stderr.write(prefix + msg + '\n');
  } else {
    // WARN/ERROR: with color
    const color = COLORS[level];
    process.stderr.write(color + prefix + msg + COLORS.RESET + '\n');
  }

  // Write to ring buffer
  writeToRingBuffer(level, msg, category);
}

/**
 * Write to ring buffer if initialized
 */
function writeToRingBuffer(
  level: LogLevel,
  message: string,
  category?: string
): void {
  if (ringBuffer) {
    ringBuffer
      .append({
        ts: new Date().toISOString(),
        level,
        category,
        message,
      })
      .catch(() => {
        // Silently ignore buffer write errors
      });
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
 * Logger instance with optional category support
 */
export const logger = {
  /**
   * Info level - only shown when verbose mode is enabled
   */
  info: (msg: string, category?: string): void => log('INFO', msg, category),

  /**
   * Warning level - always shown (yellow)
   */
  warn: (msg: string, category?: string): void => log('WARN', msg, category),

  /**
   * Error level - always shown (red)
   */
  error: (msg: string, category?: string): void => log('ERROR', msg, category),
};
