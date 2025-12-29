/**
 * Events command - list and export events
 * Phase 2.1: events ls and export events commands
 */

import { Command } from 'commander';
import { createWriteStream } from 'fs';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import {
  formatTimestamp,
  formatBytes,
  getKindSymbol,
  shortenId,
  type EventLine,
} from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';

/**
 * Format EventLine for terminal display
 */
function formatEventLine(event: EventLine, options: { fulltime?: boolean } = {}): string {
  const ts = formatTimestamp(event.ts_ms, options.fulltime);
  const symbol = getKindSymbol(event.kind);
  const status = event.status === 'OK' ? '✓' : event.status === 'ERR' ? '✗' : ' ';
  const dir = event.direction || ' ';
  const method = event.label.slice(0, 30).padEnd(30);
  const session = event.session_id ? `ses=${shortenId(event.session_id, 6)}` : '';

  const parts = [ts, symbol, dir, status, method, session];

  // Add extra info
  if (event.seq) {
    parts.push(`#${event.seq}`);
  }
  if (event.latency_ms !== undefined) {
    parts.push(`${event.latency_ms}ms`);
  }
  if (event.size_bytes !== undefined) {
    parts.push(formatBytes(event.size_bytes));
  }

  return parts.join(' ');
}

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
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
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

export function createEventsCommand(getConfigPath: () => string): Command {
  const cmd = new Command('events')
    .description('List and export events');

  // events ls
  cmd
    .command('ls')
    .description('List events across sessions')
    .option('--limit <n>', 'Number of events to show', '50')
    .option('--since <time>', 'Show events since (24h, 7d, YYYY-MM-DD)')
    .option('--connector <id>', 'Filter by connector ID')
    .option('--session <id>', 'Filter by session ID (partial match)')
    .option('--method <pattern>', 'Filter by method name')
    .option('--errors', 'Show only errors')
    .option('--fulltime', 'Show full timestamp')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        const events = store.getRecentEvents({
          limit: parseInt(options.limit, 10),
          since: options.since,
          connector: options.connector,
          session: options.session,
          method: options.method,
          errors: options.errors,
        });

        if (events.length === 0) {
          console.log('No events found.');
          return;
        }

        if (getOutputOptions().json) {
          output(events);
          return;
        }

        // Print header
        console.log(`Events (${events.length}):\n`);
        const header = options.fulltime
          ? 'Time                    Sym Dir St Method                         Session      Extra'
          : 'Time         Sym Dir St Method                         Session      Extra';
        console.log(header);
        console.log('-'.repeat(header.length));

        // Print events
        for (const event of events) {
          console.log(formatEventLine(event, { fulltime: options.fulltime }));
        }

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first.');
          return;
        }
        throw error;
      }
    });

  // export events
  cmd
    .command('export')
    .description('Export events to file')
    .requiredOption('-o, --output <file>', 'Output file path')
    .option('--format <format>', 'Output format: jsonl, csv', 'jsonl')
    .option('--limit <n>', 'Maximum number of events', '1000')
    .option('--since <time>', 'Export events since (24h, 7d, YYYY-MM-DD)')
    .option('--connector <id>', 'Filter by connector ID')
    .option('--session <id>', 'Filter by session ID')
    .option('--method <pattern>', 'Filter by method name')
    .option('--errors', 'Export only errors')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        const events = store.getRecentEvents({
          limit: parseInt(options.limit, 10),
          since: options.since,
          connector: options.connector,
          session: options.session,
          method: options.method,
          errors: options.errors,
        });

        if (events.length === 0) {
          console.log('No events to export.');
          return;
        }

        // Create output stream
        const stream = createWriteStream(options.output);

        // Write based on format
        if (options.format === 'csv') {
          stream.write(getCSVHeader() + '\n');
          for (const event of events) {
            stream.write(eventToCSV(event) + '\n');
          }
        } else {
          // Default: JSONL
          for (const event of events) {
            stream.write(eventToJSONL(event) + '\n');
          }
        }

        stream.end();

        console.log(`Exported ${events.length} events to ${options.output} (${options.format})`);

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first.');
          return;
        }
        throw error;
      }
    });

  return cmd;
}
