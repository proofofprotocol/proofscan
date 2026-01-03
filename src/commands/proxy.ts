/**
 * Proxy Command (Phase 5.0)
 *
 * pfscan proxy start [options]
 *
 * Starts an MCP proxy server that aggregates tools from multiple
 * backend connectors.
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import type { Connector } from '../types/index.js';
import { McpProxyServer, setVerbose, logger } from '../proxy/index.js';
import { getOutputOptions } from '../utils/output.js';

export function createProxyCommand(getConfigPath: () => string): Command {
  const cmd = new Command('proxy')
    .description('MCP proxy server operations');

  cmd
    .command('start')
    .description('Start MCP proxy server (stdio)')
    .option('--connectors <ids>', 'Connector IDs to expose (comma-separated)')
    .option('--all', 'Expose all enabled connectors')
    .option('--timeout <seconds>', 'Timeout for backend calls in seconds (default: 30)', '30')
    .action(async (options: {
      connectors?: string;
      all?: boolean;
      timeout: string;
    }) => {
      // Set up logging - use global verbose option from CLI
      const globalOpts = getOutputOptions();
      if (globalOpts.verbose) {
        setVerbose(true);
      }

      // Validate mutually exclusive options
      if (options.connectors && options.all) {
        logger.error('Cannot use --connectors and --all together');
        process.exit(1);
      }

      if (!options.connectors && !options.all) {
        logger.error('Must specify --connectors <ids> or --all');
        process.exit(1);
      }

      // Load config
      const configPath = getConfigPath();
      const manager = new ConfigManager(configPath);
      const configDir = manager.getConfigDir();
      let config;

      try {
        config = await manager.load();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to load config: ${msg}`);
        process.exit(1);
      }

      // Resolve connectors
      let connectors: Connector[];

      if (options.all) {
        // All enabled connectors
        connectors = config.connectors.filter((c: Connector) => c.enabled);

        if (connectors.length === 0) {
          logger.error('No enabled connectors found');
          process.exit(1);
        }

        logger.info(`Using ${connectors.length} enabled connector(s)`);
      } else {
        // Specific connectors
        const ids = options.connectors!.split(',').map((id) => id.trim());
        connectors = [];

        for (const id of ids) {
          const connector = config.connectors.find((c: Connector) => c.id === id);

          if (!connector) {
            logger.error(`Connector not found: ${id}`);
            process.exit(1);
          }

          if (!connector.enabled) {
            logger.warn(`Connector disabled, skipping: ${id}`);
            continue;
          }

          connectors.push(connector);
        }

        if (connectors.length === 0) {
          logger.error('No valid connectors to expose');
          process.exit(1);
        }

        logger.info(`Using ${connectors.length} connector(s): ${connectors.map(c => c.id).join(', ')}`);
      }

      // Parse timeout
      const timeout = parseInt(options.timeout, 10);
      if (isNaN(timeout) || timeout < 1 || timeout > 300) {
        logger.error('Invalid timeout: must be 1-300 seconds');
        process.exit(1);
      }

      // Create and start server
      const server = new McpProxyServer({
        connectors,
        configDir,
        verbose: globalOpts.verbose,
        timeout,
      });

      // Handle signals for graceful shutdown
      const shutdown = () => {
        logger.info('Received shutdown signal');
        server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Handle server stop
      server.on('stopped', () => {
        process.exit(0);
      });

      try {
        await server.start();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start server: ${msg}`);
        process.exit(1);
      }
    });

  return cmd;
}
