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
        const server = await startMonitorServer({
          configPath,
          port,
          host: options.host,
        });

        if (options.open) {
          const url = `http://${options.host}:${port}`;
          await openInBrowser(url);
        }

        // Keep server running until interrupted
        let shutdownRequested = false;
        const shutdown = () => {
          if (shutdownRequested) {
            // Force exit on second Ctrl+C
            console.log('\nForce exit.');
            process.exit(0);
          }
          shutdownRequested = true;
          console.log('\nShutting down monitor...');
          server.close(() => {
            console.log('Monitor stopped.');
            process.exit(0);
          });
          // Force exit after timeout if close doesn't complete
          setTimeout(() => {
            console.log('Force exit after timeout.');
            process.exit(0);
          }, 3000);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep process alive
        await new Promise<void>(() => {
          // This promise never resolves - we exit via the signal handlers
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
