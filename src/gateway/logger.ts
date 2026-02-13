/**
 * Structured JSON logger for Gateway
 * Phase 8.1: HTTP server foundation
 *
 * Log format:
 * { timestamp, level, event, request_id, ... }
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  request_id?: string;
  trace_id?: string;
  client_id?: string;
  target_id?: string;
  method?: string;
  decision?: 'allow' | 'deny';
  deny_reason?: string;
  latency_ms?: number;
  queue_wait_ms?: number;
  upstream_latency_ms?: number;
  status?: number;
  error?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(entry: Omit<LogEntry, 'timestamp' | 'level'>): void;
  info(entry: Omit<LogEntry, 'timestamp' | 'level'>): void;
  warn(entry: Omit<LogEntry, 'timestamp' | 'level'>): void;
  error(entry: Omit<LogEntry, 'timestamp' | 'level'>): void;
}

/**
 * Create a structured JSON logger
 * @param output Write function (default: console.log)
 * @param minLevel Minimum log level to output
 */
export function createLogger(
  output: (line: string) => void = console.log,
  minLevel: LogLevel = 'info'
): Logger {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const log = (level: LogLevel, entry: Omit<LogEntry, 'timestamp' | 'level'>) => {
    if (levels[level] < levels[minLevel]) return;

    const fullEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...entry,
    };

    output(JSON.stringify(fullEntry));
  };

  return {
    debug: (entry) => log('debug', entry),
    info: (entry) => log('info', entry),
    warn: (entry) => log('warn', entry),
    error: (entry) => log('error', entry),
  };
}

/** Default logger instance */
export const logger = createLogger();
