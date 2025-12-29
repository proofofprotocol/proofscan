/**
 * View command - the main entry point for viewing events
 *
 * pfscan view (or just pfscan) shows a timeline of recent events
 */

import { Command } from 'commander';
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

  // For session start, show connector
  if (event.kind === 'session_start' && event.connector_id) {
    parts.push(`[${event.connector_id}]`);
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
    hints.push(`pfscan explore --session ${shortenId(session, 8)}`);
  }

  if (hints.length > 0) {
    console.log();
    console.log(`hint: ${hints.join(' | ')}`);
  }
}

export function createViewCommand(getConfigPath: () => string): Command {
  const cmd = new Command('view')
    .description('View recent events timeline (default command)')
    .option('--limit <n>', 'Number of events to show', '20')
    .option('--since <time>', 'Show events since (24h, 7d, YYYY-MM-DD)')
    .option('--errors', 'Show only errors')
    .option('--method <pattern>', 'Filter by method name (partial match)')
    .option('--connector <id>', 'Filter by connector ID')
    .option('--session <id>', 'Filter by session ID (partial match)')
    .option('--fulltime', 'Show full timestamp (YYYY-MM-DD HH:MM:SS.mmm)')
    .option('--with-sessions', 'Include session start/end events')
    .option('--pairs', 'Show request/response pairs instead of individual events')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        const events = store.getRecentEvents({
          limit: parseInt(options.limit, 10) * (options.pairs ? 2 : 1), // Get more events for pairing
          since: options.since,
          errors: options.errors,
          method: options.method,
          connector: options.connector,
          session: options.session,
          includeSessionEvents: options.withSessions && !options.pairs,
        });

        if (events.length === 0) {
          console.log('No events found.');
          console.log();
          console.log('hint: Run a scan first: pfscan scan start --id <connector>');
          return;
        }

        // Pair mode
        if (options.pairs) {
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
          const header = options.fulltime
            ? 'Time                    ↔ St Method                         Session      Latency    Size'
            : 'Time         ↔ St Method                         Session      Latency    Size';
          console.log(header);
          console.log('-'.repeat(header.length));

          // Print pairs
          for (const pair of limitedPairs) {
            console.log(renderPairLine(pair, { fulltime: options.fulltime }));
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
        const header = options.fulltime
          ? 'Time                    Sym Dir St Method                         Session      Extra'
          : 'Time         Sym Dir St Method                         Session      Extra';
        console.log(header);
        console.log('-'.repeat(header.length));

        // Print events
        for (const event of events) {
          console.log(renderEventLine(event, { fulltime: options.fulltime }));
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
