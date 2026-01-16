/**
 * ProofScan Web Monitor CLI command
 */

import { Command } from 'commander';
import { startMonitorServer } from '../monitor/index.js';
import { openInBrowser } from '../html/index.js';

export function createMonitorCommand(getConfigPath: () => string): Command {
  const cmd = new Command('monitor').description(
    'Start web monitor dashboard (read-only, offline)'
  );

  cmd
    .command('start')
    .description('Start the monitor server')
    .option('-p, --port <port>', 'Server port', '3456')
    .option('--host <host>', 'Server host', 'localhost')
    .option('--open', 'Open browser after starting')
    .action(async (options) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: Invalid port number');
        process.exit(1);
      }

      const configPath = getConfigPath();
      console.log('Starting ProofScan Monitor...');
      console.log(`  Config: ${configPath}`);

      try {
        await startMonitorServer({
          configPath,
          port,
          host: options.host,
        });

        if (options.open) {
          const url = `http://${options.host}:${port}`;
          await openInBrowser(url);
        }

        // Keep server running until interrupted
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            console.log('\nShutting down monitor...');
            resolve();
          });
          process.on('SIGTERM', () => {
            console.log('\nShutting down monitor...');
            resolve();
          });
        });
      } catch (error) {
        console.error('Failed to start monitor:', error);
        process.exit(1);
      }
    });

  // Default action (no subcommand) - start with defaults
  cmd.action(async () => {
    // If no subcommand, show help
    cmd.outputHelp();
  });

  return cmd;
}
