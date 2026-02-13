/**
 * Serve command - start the Protocol Gateway HTTP server
 * Phase 8.1: HTTP server foundation
 */

import { Command } from 'commander';
import { createGatewayServer } from '../gateway/server.js';
import { createLogger } from '../gateway/logger.js';

export function createServeCommand(): Command {
  const cmd = new Command('serve')
    .description('Start the Protocol Gateway HTTP server')
    .option('-p, --port <port>', 'Server port', '3000')
    .option('-h, --host <host>', 'Server host', '127.0.0.1')
    .action(async (options) => {
      const port = parseInt(options.port, 10);
      const host = options.host as string;

      if (isNaN(port) || port < 0 || port > 65535) {
        console.error(`Error: Invalid port number: ${options.port}`);
        process.exit(1);
      }

      const logger = createLogger();

      const gateway = createGatewayServer({ port, host }, logger);

      try {
        const address = await gateway.start();
        console.log(`Protocol Gateway listening at ${address}`);
        console.log('Press Ctrl+C to stop');

        // Keep process running until server handles shutdown
        // Signal handlers in server.ts will handle graceful shutdown and process.exit()
        await new Promise<void>(() => {
          // Never resolves - server.ts signal handler will call process.exit()
        });
      } catch (error) {
        console.error('Failed to start server:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return cmd;
}
