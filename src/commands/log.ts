/**
 * Log Command (Phase 5.0+)
 *
 * pfscan log [options]
 *
 * View proxy logs from the ring buffer.
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../config/index.js';
import { output, getOutputOptions } from '../utils/output.js';
import type { LogEntry } from '../proxy/index.js';
import { LOG_COLORS } from '../proxy/logger.js';

export function createLogCommand(getConfigPath: () => string): Command {
  const cmd = new Command('log')
    .description('View proxy logs')
    .option('--tail <n>', 'Number of lines to show', '50')
    .option('--level <level>', 'Filter by minimum level (INFO, WARN, ERROR)')
    .option('--no-color', 'Disable colored output')
    .action(async (options: {
      tail: string;
      level?: string;
      color: boolean;
    }) => {
      const configPath = getConfigPath();
      const manager = new ConfigManager(configPath);
      const configDir = manager.getConfigDir();
      const logPath = join(configDir, 'proxy-logs.jsonl');

      if (!existsSync(logPath)) {
        if (getOutputOptions().json) {
          output({ logs: [], message: 'No log file found' });
        } else {
          console.log('No proxy logs found. The proxy may not have run yet.');
        }
        return;
      }

      // Parse tail count
      const tailCount = parseInt(options.tail, 10);
      if (isNaN(tailCount) || tailCount < 1) {
        console.error('Invalid --tail value: must be a positive integer');
        process.exit(1);
      }

      // Parse level filter
      const levelPriority: Record<string, number> = {
        INFO: 0,
        WARN: 1,
        ERROR: 2,
      };
      let filterPriority = 0;
      if (options.level) {
        const level = options.level.toUpperCase();
        if (!(level in levelPriority)) {
          console.error('Invalid --level: must be INFO, WARN, or ERROR');
          process.exit(1);
        }
        filterPriority = levelPriority[level];
      }

      // Read and parse log file
      let content: string;
      try {
        content = await readFile(logPath, 'utf-8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to read log file: ${msg}`);
        process.exit(1);
      }

      const lines = content.split('\n').filter((line) => line.trim());
      const entries: LogEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;

          // Apply level filter
          const entryPriority = levelPriority[entry.level] ?? 0;
          if (entryPriority < filterPriority) {
            continue;
          }

          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      // Get last N entries
      const tailEntries = entries.slice(-tailCount);

      if (getOutputOptions().json) {
        output(tailEntries);
        return;
      }

      if (tailEntries.length === 0) {
        console.log('No log entries found matching criteria.');
        return;
      }

      // Format and print entries
      for (const entry of tailEntries) {
        const time = formatLogTime(entry.ts);
        const level = entry.level.padEnd(5);
        const category = entry.category ? `[${entry.category}] ` : '';
        const message = entry.message;

        let line = `[${time}] ${level} ${category}${message}`;

        // Apply color if enabled
        if (options.color && entry.level !== 'INFO') {
          const color = entry.level === 'ERROR' ? LOG_COLORS.ERROR : LOG_COLORS.WARN;
          line = `${color}${line}${LOG_COLORS.RESET}`;
        }

        console.log(line);
      }

      console.log(`\n--- Showing last ${tailEntries.length} of ${entries.length} entries ---`);
    });

  return cmd;
}

/**
 * Format ISO timestamp to HH:MM:SS.mmm
 */
function formatLogTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  } catch {
    return isoTimestamp.slice(11, 23);
  }
}
