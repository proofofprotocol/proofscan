/**
 * View command - the main entry point for viewing events
 *
 * pfscan view (or just pfscan) shows a timeline of recent events
 *
 * Consolidated features:
 * - Basic event viewing (original view)
 * - Follow mode for live streaming (from monitor)
 * - Export to CSV/JSONL (from events export)
 */

import { Command } from 'commander';
import { createWriteStream, existsSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import {
  formatTimestamp,
  formatDuration,
  formatBytes,
  shortenId,
  getKindSymbol,
  type EventLine,
  type EventLinePair,
} from '../eventline/types.js';
import { groupEventsToPairs } from '../eventline/normalizer.js';
import { output, getOutputOptions } from '../utils/output.js';

// ============================================================
// Export helpers (from events.ts)
// ============================================================

/**
 * Convert EventLine to CSV row
 */
function eventToCSV(event: EventLine): string {
  const fields = [
    event.ts_ms,
    event.seq || '',
    event.kind,
    event.direction || '',
    event.label,
    event.status,
    event.connector_id || '',
    event.session_id || '',
    event.rpc_id || '',
    event.latency_ms || '',
    event.size_bytes || '',
    event.payload_hash || '',
    event.summary || '',
    event.error_code || '',
  ];

  return fields.map(f => {
    const str = String(f);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(',');
}

/**
 * Get CSV header
 */
function getCSVHeader(): string {
  return 'ts_ms,seq,kind,direction,label,status,connector_id,session_id,rpc_id,latency_ms,size_bytes,payload_hash,summary,error_code';
}

/**
 * Convert EventLine to JSONL
 */
function eventToJSONL(event: EventLine): string {
  return JSON.stringify(event);
}

/**
 * Determine export format from filename extension
 */
function getExportFormat(filename: string): 'csv' | 'jsonl' {
  if (filename.endsWith('.csv')) {
    return 'csv';
  }
  return 'jsonl';
}

// ============================================================
// Display helpers
// ============================================================

/**
 * Render a single EventLine to terminal string
 */
function renderEventLine(event: EventLine, options: { fulltime?: boolean }): string {
  const ts = formatTimestamp(event.ts_ms, options.fulltime);
  const symbol = getKindSymbol(event.kind);
  const status = event.status === 'OK' ? '✓' : event.status === 'ERR' ? '✗' : ' ';

  // Build the line
  const parts: string[] = [ts, symbol];

  // Direction indicator
  if (event.direction) {
    parts.push(event.direction);
  } else {
    parts.push(' ');
  }

  parts.push(status);
  parts.push(event.label.slice(0, 30).padEnd(30));

  // Connector ID (shortened to 12 chars, padded)
  if (event.connector_id) {
    parts.push(event.connector_id.slice(0, 12).padEnd(12));
  } else {
    parts.push(''.padEnd(12));
  }

  // Session ID (shortened)
  if (event.session_id) {
    parts.push(`ses=${shortenId(event.session_id, 6)}`);
  }

  // For responses, show latency and size
  if (event.kind === 'res' || event.kind === 'error') {
    if (event.latency_ms !== undefined) {
      parts.push(`lat=${event.latency_ms}ms`);
    }
    if (event.size_bytes !== undefined) {
      parts.push(`size=${formatBytes(event.size_bytes)}`);
    }
  }

  // For session end, show duration and counts
  if (event.kind === 'session_end' && event.meta) {
    if (event.meta.duration_ms) {
      parts.push(`dur=${formatDuration(event.meta.duration_ms as number)}`);
    }
    if (event.meta.rpc_count !== undefined) {
      parts.push(`rpcs=${event.meta.rpc_count}`);
    }
    if (event.meta.error_count) {
      parts.push(`err=${event.meta.error_count}`);
    }
  }

  // Error code
  if (event.error_code !== undefined) {
    parts.push(`err=${event.error_code}`);
  }

  return parts.join(' ');
}

/**
 * Render an EventLinePair to terminal string
 */
function renderPairLine(pair: EventLinePair, options: { fulltime?: boolean }): string {
  const ts = formatTimestamp(pair.request.ts_ms, options.fulltime);
  const status = pair.success ? '✓' : pair.response ? '✗' : '?';

  // Build the line
  const parts: string[] = [
    ts,
    '↔',
    status,
    pair.method.slice(0, 30).padEnd(30),
  ];

  // Connector ID (shortened to 12 chars, padded)
  if (pair.request.connector_id) {
    parts.push(pair.request.connector_id.slice(0, 12).padEnd(12));
  } else {
    parts.push(''.padEnd(12));
  }

  // RPC ID (for easy copy-paste to rpc show command)
  parts.push(`rpc=${String(pair.rpc_id).slice(0, 8).padEnd(8)}`);

  // Session ID (shortened)
  if (pair.request.session_id) {
    parts.push(`ses=${shortenId(pair.request.session_id, 6)}`);
  }

  // Latency
  if (pair.latency_ms !== undefined) {
    parts.push(`lat=${pair.latency_ms}ms`);
  } else if (!pair.response) {
    parts.push('(pending)');
  }

  // Response size
  if (pair.response?.size_bytes !== undefined) {
    parts.push(`size=${formatBytes(pair.response.size_bytes)}`);
  }

  // Error code
  if (pair.response?.error_code !== undefined) {
    parts.push(`err=${pair.response.error_code}`);
  }

  return parts.join(' ');
}

/**
 * Print hint line
 */
function printHint(events: EventLine[]): void {
  // Find a connector and session to suggest
  const connector = events.find(e => e.connector_id)?.connector_id;
  const session = events.find(e => e.session_id)?.session_id;

  const hints: string[] = [];
  if (connector) {
    hints.push(`pfscan tree ${connector}`);
  }
  if (session) {
    hints.push(`pfscan summary --session ${shortenId(session, 8)}`);
  }

  if (hints.length > 0) {
    console.log();
    console.log(`hint: ${hints.join(' | ')}`);
  }
}

export function createViewCommand(getConfigPath: () => string): Command {
  const cmd = new Command('view')
    .description('View recent events timeline (default command)')
    .addHelpText('after', `
Examples:
  pfscan view                       # Show recent events
  pfscan view --connector time      # Events for specific connector
  pfscan view --pairs               # Show request/response pairs
  pfscan view -f                    # Follow mode (real-time updates)
  pfscan view --export events.csv   # Export to CSV file
  pfscan view --export events.jsonl # Export to JSONL file
`)
    .option('--limit <n>', 'Number of events to show', '20')
    .option('--since <time>', 'Show events since (24h, 7d, YYYY-MM-DD)')
    .option('--errors', 'Show only errors')
    .option('--method <pattern>', 'Filter by method name (partial match)')
    .option('--connector <id>', 'Filter by connector ID')
    .option('--session <id>', 'Filter by session ID (partial match)')
    .option('--fulltime', 'Show full timestamp (YYYY-MM-DD HH:MM:SS.mmm)')
    .option('--full-time', 'Alias for --fulltime')
    .option('--time-full', 'Alias for --fulltime')
    .option('--with-sessions', 'Include session start/end events')
    .option('--pairs', 'Show request/response pairs instead of individual events')
    .option('--pair', 'Alias for --pairs')
    .option('-f, --follow', 'Follow mode: watch for new events in real-time')
    .option('--interval <ms>', 'Poll interval in milliseconds for follow mode', '1000')
    .option('--export <file>', 'Export events to file (CSV or JSONL based on extension)')
    .action(async (options) => {
      // Compute effective options from aliases (avoid mutating options object)
      // Commander converts kebab-case (--full-time, --time-full) to camelCase (fullTime, timeFull)
      const showFulltime = options.fulltime || options.fullTime || options.timeFull;
      const showPairs = options.pairs || options.pair;
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        // Export mode
        if (options.export) {
          // Validate export file path
          const exportPath = isAbsolute(options.export)
            ? options.export
            : resolve(process.cwd(), options.export);

          // Security: prevent directory traversal attacks
          const resolvedPath = resolve(exportPath);
          const cwd = process.cwd();
          // Allow absolute paths but warn if outside cwd
          if (!resolvedPath.startsWith(cwd) && !isAbsolute(options.export)) {
            console.error('Error: Export path escapes current directory.');
            console.error('Use an absolute path or a path within the current directory.');
            process.exit(1);
          }

          // Check if file exists (warn about overwrite)
          if (existsSync(resolvedPath)) {
            console.log(`Warning: File '${options.export}' already exists. Overwriting...`);
          }

          // Verify parent directory exists
          const parentDir = dirname(resolvedPath);
          if (!existsSync(parentDir)) {
            console.error(`Error: Parent directory does not exist: ${parentDir}`);
            process.exit(1);
          }

          const exportLimit = parseInt(options.limit, 10) || 1000;
          const events = store.getRecentEvents({
            limit: exportLimit,
            since: options.since,
            errors: options.errors,
            method: options.method,
            connector: options.connector,
            session: options.session,
          });

          if (events.length === 0) {
            console.log('No events to export.');
            return;
          }

          const format = getExportFormat(options.export);
          const stream = createWriteStream(resolvedPath);

          if (format === 'csv') {
            stream.write(getCSVHeader() + '\n');
            for (const event of events) {
              stream.write(eventToCSV(event) + '\n');
            }
          } else {
            for (const event of events) {
              stream.write(eventToJSONL(event) + '\n');
            }
          }

          stream.end();
          console.log(`Exported ${events.length} events to ${options.export} (${format})`);
          return;
        }

        // Follow mode
        if (options.follow) {
          const initialEvents = store.getRecentEvents({
            limit: parseInt(options.limit, 10),
            connector: options.connector,
            session: options.session,
            method: options.method,
            errors: options.errors,
          });

          // Print header
          const connectorInfo = options.connector ? ` for '${options.connector}'` : '';
          console.log(`Events${connectorInfo} (following, Ctrl+C to stop):\n`);
          console.log('Time         Sym Dir St Method                         Session');
          console.log('-'.repeat(80));

          // Print initial events
          for (const event of initialEvents) {
            console.log(renderEventLine(event, { fulltime: showFulltime }));
          }

          // Use event seq (or ts_ms + session_id) for deduplication to avoid race condition
          // Track seen events by their unique identifier
          const seenEvents = new Set<string>();
          for (const event of initialEvents) {
            // Use seq if available, otherwise ts_ms + session_id as unique key
            const eventKey = event.seq?.toString() ?? `${event.ts_ms}-${event.session_id ?? ''}`;
            seenEvents.add(eventKey);
          }

          // Start polling - use seq/ts_ms for deduplication instead of just timestamp
          let lastTs = initialEvents.length > 0 ? initialEvents[initialEvents.length - 1].ts_ms : Date.now();
          const interval = parseInt(options.interval, 10);
          let intervalId: ReturnType<typeof setInterval> | undefined;

          // Handle Ctrl+C gracefully with cleanup
          const cleanup = () => {
            if (intervalId) {
              clearInterval(intervalId);
            }
            console.log('\n\nStopped following.');
            process.exit(0);
          };
          process.on('SIGINT', cleanup);
          process.on('SIGTERM', cleanup);

          const poll = async () => {
            try {
              // Get events since slightly before lastTs to catch any missed during race
              const newEvents = store.getRecentEvents({
                limit: 100,
                connector: options.connector,
                session: options.session,
                method: options.method,
                errors: options.errors,
              }).filter(e => {
                // Filter by timestamp first (coarse filter)
                if (e.ts_ms < lastTs - 1000) return false; // Allow 1s overlap for safety
                // Then deduplicate by unique key
                const eventKey = e.seq?.toString() ?? `${e.ts_ms}-${e.session_id ?? ''}`;
                if (seenEvents.has(eventKey)) return false;
                seenEvents.add(eventKey);
                return true;
              });

              if (newEvents.length > 0) {
                for (const event of newEvents) {
                  if (getOutputOptions().json) {
                    console.log(JSON.stringify(event));
                  } else {
                    console.log(renderEventLine(event, { fulltime: showFulltime }));
                  }
                }
                lastTs = newEvents[newEvents.length - 1].ts_ms;

                // Limit seenEvents size to prevent memory leak (keep last 10000)
                if (seenEvents.size > 10000) {
                  const keysToDelete = Array.from(seenEvents).slice(0, 5000);
                  for (const key of keysToDelete) {
                    seenEvents.delete(key);
                  }
                }
              }
            } catch (err) {
              // Log errors in verbose mode, but don't crash
              if (getOutputOptions().verbose) {
                console.error('Poll error:', err instanceof Error ? err.message : String(err));
              }
            }
          };

          intervalId = setInterval(poll, interval);
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          await new Promise(() => {});
          return;
        }

        // Normal mode
        const events = store.getRecentEvents({
          limit: parseInt(options.limit, 10) * (showPairs ? 2 : 1), // Get more events for pairing
          since: options.since,
          errors: options.errors,
          method: options.method,
          connector: options.connector,
          session: options.session,
          includeSessionEvents: options.withSessions && !showPairs,
        });

        if (events.length === 0) {
          console.log('No events found.');
          console.log();
          console.log('hint: Run a scan first: pfscan scan start --id <connector>');
          return;
        }

        // Pair mode
        if (showPairs) {
          const pairs = groupEventsToPairs(events);

          if (pairs.length === 0) {
            console.log('No RPC pairs found.');
            return;
          }

          // Limit pairs
          const limitedPairs = pairs.slice(0, parseInt(options.limit, 10));

          if (getOutputOptions().json) {
            output(limitedPairs);
            return;
          }

          // Print header for pairs
          const header = showFulltime
            ? 'Time                    ↔ St Method                         Connector    RPC      Session      Latency    Size'
            : 'Time         ↔ St Method                         Connector    RPC      Session      Latency    Size';
          console.log(header);
          console.log('-'.repeat(header.length));

          // Print hint about rpc show command
          console.log('(use: pfscan rpc show --session <ses> --id <rpc> for details)');

          // Print pairs
          for (const pair of limitedPairs) {
            console.log(renderPairLine(pair, { fulltime: showFulltime }));
          }

          // Print summary
          console.log();
          const successCount = limitedPairs.filter(p => p.success).length;
          const errorCount = limitedPairs.filter(p => p.response && !p.success).length;
          const pendingCount = limitedPairs.filter(p => !p.response).length;
          console.log(`${limitedPairs.length} pairs: ${successCount} OK, ${errorCount} ERR, ${pendingCount} pending`);

          return;
        }

        if (getOutputOptions().json) {
          output(events);
          return;
        }

        // Print header
        const header = showFulltime
          ? 'Time                    Sym Dir St Method                         Connector    Session      Extra'
          : 'Time         Sym Dir St Method                         Connector    Session      Extra';
        console.log(header);
        console.log('-'.repeat(header.length));

        // Print events
        for (const event of events) {
          console.log(renderEventLine(event, { fulltime: showFulltime }));
        }

        // Print hint
        printHint(events);

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
    });

  return cmd;
}

// Aliases
export { createViewCommand as createVCommand };
