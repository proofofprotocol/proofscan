/**
 * Connectors commands
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { ConfigManager, parseMcpServers, parseMcpServerById, readStdin } from '../config/index.js';
import type { Connector, StdioTransport } from '../types/index.js';
import { output, outputSuccess, outputError, outputTable, redactSecrets } from '../utils/output.js';
import { redactionSummary } from '../secrets/redaction.js';

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
    .description('Show connector details (secrets redacted)')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(options.id);

        if (!connector) {
          outputError(`Connector not found: ${options.id}`);
          process.exit(1);
        }

        const redacted = redactSecrets(connector);
        if (redacted.count > 0) {
          console.log(redactionSummary(redacted.count));
          console.log();
        }
        output(redacted.value, JSON.stringify(redacted.value, null, 2));
      } catch (error) {
        outputError('Failed to show connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new connector')
    .argument('[id]', 'Connector ID')
    .option('--id <id>', 'Connector ID (alternative to positional argument)')
    .option('--stdio <cmdline>', 'Command line (command and args as single string)')
    .option('--from-mcp-json <json>', 'MCP server JSON (use "-" for stdin)')
    .option('--from-mcp-file <path>', 'Path to MCP config file (e.g., claude_desktop_config.json)')
    .option('--clip', 'Read MCP server JSON from clipboard')
    .action(async (idArg, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());

        // Validate conflicting ID options
        if (idArg && options.id && idArg !== options.id) {
          outputError('Cannot specify ID both as argument and --id option');
          process.exit(1);
        }
        const id = idArg || options.id;

        // Validate mutual exclusivity
        const inputModes = [options.fromMcpJson, options.fromMcpFile, options.clip].filter(Boolean);
        if (inputModes.length > 1) {
          outputError('Cannot use multiple input options (--from-mcp-json, --from-mcp-file, --clip)');
          process.exit(1);
        }

        // --clip mode: read from clipboard with secretize processing
        if (options.clip) {
          if (!id) {
            outputError('Connector ID required with --clip. Usage: connectors add <id> --clip');
            process.exit(1);
          }

          const { readClipboard } = await import('../utils/clipboard.js');
          let clipContent: string;
          try {
            clipContent = readClipboard();
            if (!clipContent?.trim()) {
              outputError('Clipboard is empty');
              process.exit(1);
            }
          } catch (e) {
            outputError(`Failed to read clipboard: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
          }

          const result = parseMcpServerById(clipContent, id);

          if (result.errors.length > 0) {
            outputError(`Invalid JSON: ${result.errors.join(', ')}`);
            process.exit(1);
          }

          if (result.connectors.length === 0) {
            outputError('No connector definition found in clipboard');
            process.exit(1);
          }

          if (result.connectors.length > 1) {
            outputError(`Multiple connectors found (${result.connectors.length}). Use 'connectors import --clip' instead.`);
            process.exit(1);
          }

          // Use toConnector for secretize/sanitize processing
          const { toConnector } = await import('../config/add.js');
          const transport = result.connectors[0].transport as StdioTransport;
          const parsed = {
            id,
            command: transport.command,
            args: transport.args,
            env: transport.env,
          };

          const { connector, secretizeOutput } = await toConnector(parsed, {
            configPath: getConfigPath(),
          });

          await manager.addConnector(connector);

          // Show secretize results if any
          for (const line of secretizeOutput) {
            console.log(`  ${line}`);
          }

          outputSuccess(`Connector '${id}' added from clipboard`);
          return;
        }

        // --from-mcp-json or --from-mcp-file mode
        if (options.fromMcpJson || options.fromMcpFile) {
          if (!id) {
            outputError('Connector ID is required. Usage: connectors add <id> --from-mcp-json \'...\'');
            process.exit(1);
          }

          let jsonContent: string;
          if (options.fromMcpFile) {
            try {
              jsonContent = await fs.readFile(options.fromMcpFile, 'utf-8');
            } catch (e) {
              outputError(`Failed to read file: ${options.fromMcpFile}`, e instanceof Error ? e : undefined);
              process.exit(1);
            }
          } else if (options.fromMcpJson === '-') {
            jsonContent = await readStdin();
          } else {
            jsonContent = options.fromMcpJson;
          }

          const result = parseMcpServerById(jsonContent, id);

          if (result.errors.length > 0) {
            outputError(result.errors.join('\n'));
            process.exit(1);
          }

          if (result.connectors.length === 0) {
            outputError('No connector found in input');
            process.exit(1);
          }

          await manager.addConnector(result.connectors[0]);
          outputSuccess(`Connector '${id}' added`);
          return;
        }

        // --stdio mode (legacy)
        if (options.stdio) {
          if (!id) {
            outputError('Connector ID is required. Usage: connectors add <id> --stdio \'...\'');
            process.exit(1);
          }

          const parts = options.stdio.trim().split(/\s+/);
          const command = parts[0];
          const args = parts.slice(1);

          const connector: Connector = {
            id,
            enabled: true,
            transport: {
              type: 'stdio',
              command,
              ...(args.length > 0 && { args }),
            },
          };

          await manager.addConnector(connector);
          outputSuccess(`Connector '${id}' added`);
          return;
        }

        // No mode specified
        outputError('One of --stdio, --from-mcp-json, --from-mcp-file, or --clip is required');
        console.error('\nExamples:');
        console.error('  # From clipboard (copy JSON from mcp.so, then run)');
        console.error('  pfscan connectors add inscribe --clip');
        console.error('');
        console.error('  # From command line');
        console.error('  pfscan connectors add inscribe --stdio \'npx -y inscribe-mcp\'');
        console.error('');
        console.error('  # From MCP JSON (README format)');
        console.error('  pfscan connectors add inscribe --from-mcp-json \'{"command":"npx","args":["-y","inscribe-mcp"]}\'');
        console.error('');
        console.error('  # From Claude Desktop config file');
        console.error('  pfscan connectors add inscribe --from-mcp-file ~/.config/Claude/claude_desktop_config.json');
        console.error('');
        console.error('  # From stdin');
        console.error('  cat config.json | pfscan connectors add inscribe --from-mcp-json -');
        process.exit(1);
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
    .command('delete')
    .description('Delete a connector')
    .argument('[id]', 'Connector ID')
    .option('--id <id>', 'Connector ID (alternative to positional argument)')
    .action(async (idArg, options) => {
      try {
        const id = idArg || options.id;
        if (!id) {
          outputError('Connector ID required. Usage: connectors delete <id>');
          process.exit(1);
        }
        const manager = new ConfigManager(getConfigPath());
        await manager.removeConnector(id);
        outputSuccess(`Connector '${id}' deleted`);
      } catch (error) {
        outputError('Failed to delete connector', error instanceof Error ? error : undefined);
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
