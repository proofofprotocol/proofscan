/**
 * Connectors commands
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { ConfigManager, parseMcpServers, readStdin } from '../config/index.js';
import type { Connector, StdioTransport } from '../types/index.js';
import { output, outputSuccess, outputError, outputTable, maskSecretsInObject } from '../utils/output.js';

export function createConnectorsCommand(getConfigPath: () => string): Command {
  const cmd = new Command('connectors')
    .description('Manage MCP server connectors');

  cmd
    .command('list')
    .description('List all connectors')
    .action(async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connectors = await manager.getConnectors();

        if (connectors.length === 0) {
          output({ connectors: [] }, 'No connectors configured.');
          return;
        }

        const headers = ['ID', 'Enabled', 'Type', 'Command/URL'];
        const rows = connectors.map(c => {
          let target = '';
          if (c.transport.type === 'stdio') {
            const t = c.transport as StdioTransport;
            target = t.command + (t.args?.length ? ` ${t.args.join(' ')}` : '');
            if (target.length > 50) target = target.slice(0, 47) + '...';
          } else if ('url' in c.transport) {
            target = (c.transport as { url: string }).url;
          }
          return [c.id, c.enabled ? 'yes' : 'no', c.transport.type, target];
        });

        outputTable(headers, rows);
      } catch (error) {
        outputError('Failed to list connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show connector details')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(options.id);

        if (!connector) {
          outputError(`Connector not found: ${options.id}`);
          process.exit(1);
        }

        const masked = maskSecretsInObject(connector);
        output(masked, JSON.stringify(masked, null, 2));
      } catch (error) {
        outputError('Failed to show connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new stdio connector')
    .requiredOption('--id <id>', 'Connector ID')
    .requiredOption('--stdio <cmdline>', 'Command line (command and args as single string)')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());

        // Parse command line
        const parts = options.stdio.trim().split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        const connector: Connector = {
          id: options.id,
          enabled: true,
          transport: {
            type: 'stdio',
            command,
            ...(args.length > 0 && { args }),
          },
        };

        await manager.addConnector(connector);
        outputSuccess(`Connector '${options.id}' added`);
      } catch (error) {
        outputError('Failed to add connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('enable')
    .description('Enable a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        await manager.enableConnector(options.id);
        outputSuccess(`Connector '${options.id}' enabled`);
      } catch (error) {
        outputError('Failed to enable connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('disable')
    .description('Disable a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        await manager.disableConnector(options.id);
        outputSuccess(`Connector '${options.id}' disabled`);
      } catch (error) {
        outputError('Failed to disable connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('remove')
    .description('Remove a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        await manager.removeConnector(options.id);
        outputSuccess(`Connector '${options.id}' removed`);
      } catch (error) {
        outputError('Failed to remove connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('import')
    .description('Import connectors from mcpServers format')
    .requiredOption('--from <format>', 'Import format (mcpServers)')
    .option('--file <path>', 'Read from file')
    .option('--stdin', 'Read from stdin')
    .option('--name <id>', 'Connector ID (required for single server definition)')
    .action(async (options) => {
      try {
        if (options.from !== 'mcpServers') {
          outputError(`Unsupported format: ${options.from}. Only 'mcpServers' is supported.`);
          process.exit(1);
        }

        if (!options.file && !options.stdin) {
          outputError('Either --file or --stdin is required');
          process.exit(1);
        }

        let jsonContent: string;
        if (options.stdin) {
          jsonContent = await readStdin();
        } else {
          jsonContent = await fs.readFile(options.file, 'utf-8');
        }

        const result = parseMcpServers(jsonContent, options.name);

        if (result.errors.length > 0) {
          outputError(`Import errors:\n${result.errors.map(e => `  - ${e}`).join('\n')}`);
          process.exit(1);
        }

        if (result.connectors.length === 0) {
          output({ imported: 0 }, 'No connectors found in input.');
          return;
        }

        const manager = new ConfigManager(getConfigPath());

        // Ensure config exists
        await manager.init(false);

        // Add each connector
        const added: string[] = [];
        const errors: string[] = [];

        for (const connector of result.connectors) {
          try {
            await manager.addConnector(connector);
            added.push(connector.id);
          } catch (error) {
            errors.push(`${connector.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (added.length > 0) {
          outputSuccess(`Imported ${added.length} connector(s): ${added.join(', ')}`);
        }
        if (errors.length > 0) {
          console.error(`Errors:\n${errors.map(e => `  - ${e}`).join('\n')}`);
        }

        // Validate after import
        const validation = await manager.validate();
        if (!validation.valid) {
          console.error('Warning: Config validation failed after import');
          process.exit(1);
        }
      } catch (error) {
        outputError('Failed to import connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
