/**
 * Proxy Command (Phase 5.0+)
 *
 * pfscan proxy start [options]
 * pfscan proxy status [--json]
 *
 * Starts an MCP proxy server that aggregates tools from multiple
 * backend connectors, and provides status display.
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import type { Connector } from '../types/index.js';
import {
  McpProxyServer,
  setVerbose,
  logger,
  RuntimeStateManager,
} from '../proxy/index.js';
import { IpcClient } from '../proxy/ipc-client.js';
import { getSocketPath } from '../proxy/ipc-types.js';
import { output, getOutputOptions } from '../utils/output.js';
import { formatRelativeTime } from '../utils/time.js';

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
      }, configPath);

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

  // Status subcommand
  cmd
    .command('status')
    .description('Show proxy runtime status')
    .action(async () => {
      const configPath = getConfigPath();
      const manager = new ConfigManager(configPath);
      const configDir = manager.getConfigDir();

      const state = await RuntimeStateManager.read(configDir);

      if (!state) {
        if (getOutputOptions().json) {
          output({ running: false, message: 'No proxy state found' });
        } else {
          console.log('Proxy Status: No state found (proxy may never have run)');
        }
        return;
      }

      const isAlive = RuntimeStateManager.isProxyAlive(state);

      if (getOutputOptions().json) {
        output({
          running: isAlive,
          ...state,
        });
        return;
      }

      // Human-readable output
      console.log('Proxy Status');
      console.log('═══════════════════════════════════════════════════\n');

      // Proxy info
      const proxyState = isAlive ? 'RUNNING' : (state.proxy.state === 'RUNNING' ? 'STALE' : 'STOPPED');
      console.log(`State:        ${proxyState}`);
      console.log(`Mode:         ${state.proxy.mode}`);
      console.log(`PID:          ${state.proxy.pid}`);

      if (state.proxy.startedAt) {
        console.log(`Started:      ${state.proxy.startedAt}`);
        const uptime = formatUptime(state.proxy.startedAt);
        console.log(`Uptime:       ${uptime}`);
      }

      if (state.proxy.heartbeat) {
        console.log(`Heartbeat:    ${formatRelativeTime(state.proxy.heartbeat)}`);
      }

      // Connectors
      console.log('\nConnectors:');
      if (state.connectors.length === 0) {
        console.log('  (none)');
      } else {
        for (const conn of state.connectors) {
          const status = conn.healthy ? '●' : '○';
          const tools = conn.toolCount > 0 ? `${conn.toolCount} tools` : 'pending';
          const error = conn.error ? ` (${conn.error})` : '';
          console.log(`  ${status} ${conn.id}: ${tools}${error}`);
        }
      }

      // Clients
      console.log('\nClients:');
      const clientEntries = Object.values(state.clients);
      if (clientEntries.length === 0) {
        console.log('  (none)');
      } else {
        for (const client of clientEntries) {
          const effectiveState = RuntimeStateManager.determineClientState(client);
          const stateIcon = effectiveState === 'active' ? '●' : effectiveState === 'idle' ? '○' : '✕';
          console.log(`  ${stateIcon} ${client.name} (${effectiveState})`);
          console.log(`      Last seen: ${formatRelativeTime(client.lastSeen)}`);
          console.log(`      Sessions: ${client.sessions}, Tool calls: ${client.toolCalls}`);
        }
      }

      // Logging
      console.log('\nLogging:');
      console.log(`  Level:      ${state.logging.level}`);
      console.log(`  Buffered:   ${state.logging.bufferedLines}/${state.logging.maxLines} lines`);
    });

  // Reload subcommand
  cmd
    .command('reload')
    .description('Reload proxy configuration')
    .action(async () => {
      const configPath = getConfigPath();
      const manager = new ConfigManager(configPath);
      const configDir = manager.getConfigDir();

      const socketPath = getSocketPath(configDir);
      const client = new IpcClient(socketPath);

      // Check if proxy is running
      const isRunning = await client.isRunning();
      if (!isRunning) {
        if (getOutputOptions().json) {
          output({ success: false, error: 'Proxy is not running' });
        } else {
          console.error('Error: Proxy is not running');
          console.log('Start the proxy with: pfscan proxy start --all');
        }
        process.exit(1);
      }

      // Send reload command
      const result = await client.reload();

      if (getOutputOptions().json) {
        output(result);
        process.exit(result.success ? 0 : 1);
      }

      if (result.success) {
        console.log('Proxy reloaded successfully');
        if (result.data) {
          if (result.data.reloadedConnectors.length > 0) {
            console.log(`Reloaded connectors: ${result.data.reloadedConnectors.join(', ')}`);
          }
          if (result.data.failedConnectors.length > 0) {
            console.log(`Failed connectors: ${result.data.failedConnectors.join(', ')}`);
          }
          if (result.data.message) {
            console.log(result.data.message);
          }
        }
      } else {
        console.error(`Reload failed: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    });

  // Stop subcommand
  cmd
    .command('stop')
    .description('Stop the running proxy')
    .action(async () => {
      const configPath = getConfigPath();
      const manager = new ConfigManager(configPath);
      const configDir = manager.getConfigDir();

      const socketPath = getSocketPath(configDir);
      const client = new IpcClient(socketPath);

      // Check if proxy is running
      const isRunning = await client.isRunning();
      if (!isRunning) {
        if (getOutputOptions().json) {
          output({ success: false, error: 'Proxy is not running' });
        } else {
          console.log('Proxy is not running');
        }
        return;
      }

      // Send stop command
      const result = await client.stop();

      if (getOutputOptions().json) {
        output(result);
        process.exit(result.success ? 0 : 1);
      }

      if (result.success) {
        console.log('Proxy stopped');
      } else {
        console.error(`Failed to stop proxy: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Format uptime from startedAt timestamp
 */
function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;

  if (diffMs < 0) return '0s';

  const seconds = Math.floor(diffMs / 1000) % 60;
  const minutes = Math.floor(diffMs / 60000) % 60;
  const hours = Math.floor(diffMs / 3600000) % 24;
  const days = Math.floor(diffMs / 86400000);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}
