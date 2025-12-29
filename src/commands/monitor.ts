/**
 * Monitor commands - reads from SQLite
 * Phase 2.1: Added --follow mode for live event streaming
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { output, outputError, getOutputOptions } from '../utils/output.js';
import {
  formatTimestamp,
  getKindSymbol,
  shortenId,
  type EventLine,
} from '../eventline/types.js';

export function createMonitorCommand(getConfigPath: () => string): Command {
  const cmd = new Command('monitor')
    .description('Monitor scan events');

  cmd
    .command('tail')
    .description('Show recent events for a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .option('--last <n>', 'Number of events to show', '20')
    .option('-f, --follow', 'Follow mode: watch for new events')
    .option('--interval <ms>', 'Poll interval in milliseconds for follow mode', '1000')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(options.id);

        if (!connector) {
          outputError(`Connector not found: ${options.id}`);
          process.exit(1);
        }

        const store = new EventLineStore(manager.getConfigDir());
        const count = parseInt(options.last, 10);

        // Get initial events
        const events = store.getRecentEvents({
          limit: count,
          connector: options.id,
        });

        if (events.length === 0 && !options.follow) {
          output({ events: [] }, `No events found for connector: ${options.id}`);
          return;
        }

        if (getOutputOptions().json && !options.follow) {
          output(events);
          return;
        }

        // Print header
        console.log(`Events for '${options.id}'${options.follow ? ' (following, Ctrl+C to stop)' : ` (last ${events.length})`}:\n`);
        console.log('Time         Sym Dir St Method                         Session');
        console.log('-'.repeat(80));

        // Print initial events
        for (const event of events) {
          console.log(formatEventLine(event));
        }

        // Follow mode
        if (options.follow) {
          let lastTs = events.length > 0 ? events[events.length - 1].ts_ms : Date.now();
          const interval = parseInt(options.interval, 10);

          // Handle Ctrl+C gracefully
          process.on('SIGINT', () => {
            console.log('\n\nStopped following.');
            process.exit(0);
          });

          // Poll for new events
          const poll = async () => {
            try {
              const newEvents = store.getRecentEvents({
                limit: 50,
                connector: options.id,
              }).filter(e => e.ts_ms > lastTs);

              if (newEvents.length > 0) {
                for (const event of newEvents) {
                  if (getOutputOptions().json) {
                    console.log(JSON.stringify(event));
                  } else {
                    console.log(formatEventLine(event));
                  }
                }
                lastTs = newEvents[newEvents.length - 1].ts_ms;
              }
            } catch {
              // Ignore errors during polling
            }
          };

          // Start polling
          setInterval(poll, interval);

          // Keep process alive
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          await new Promise(() => {});
        }
      } catch (error) {
        outputError('Failed to get events', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Format EventLine for terminal display
 */
function formatEventLine(event: EventLine): string {
  const ts = formatTimestamp(event.ts_ms);
  const symbol = getKindSymbol(event.kind);
  const status = event.status === 'OK' ? '✓' : event.status === 'ERR' ? '✗' : ' ';
  const dir = event.direction || ' ';
  const method = event.label.slice(0, 30).padEnd(30);
  const session = event.session_id ? `ses=${shortenId(event.session_id, 6)}` : '';

  return `${ts} ${symbol} ${dir} ${status} ${method} ${session}`;
}
