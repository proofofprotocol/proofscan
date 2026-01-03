/**
 * Tool command - MCP tool operations (Phase 4.4)
 *
 * pfscan tool ls <connector>                    # List tools
 * pfscan tool show <connector> <tool-name>      # Show tool details
 * pfscan tool call <connector> <tool-name>      # Call a tool
 *
 * Stateless design: Each command spawns a fresh MCP connection.
 * 1 command = 1 session (initialize → execute → disconnect)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { ConfigManager } from '../config/index.js';
import {
  getConnector,
  listTools,
  getTool,
  callTool,
  formatInputSchema,
  type ToolContext,
} from '../tools/adapter.js';
import { output, getOutputOptions } from '../utils/output.js';

/**
 * Read arguments from various sources
 */
async function resolveArgs(options: {
  args?: string;
  argsFile?: string;
  stdin?: boolean;
}): Promise<Record<string, unknown>> {
  // Priority: --args > --args-file > --stdin
  if (options.args) {
    try {
      return JSON.parse(options.args);
    } catch (e) {
      throw new Error(`Invalid JSON in --args: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (options.argsFile) {
    try {
      const content = fs.readFileSync(options.argsFile, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      throw new Error(`Failed to read --args-file: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (options.stdin) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (e) {
          reject(new Error(`Invalid JSON from stdin: ${e instanceof Error ? e.message : e}`));
        }
      });
      process.stdin.on('error', reject);
    });
  }

  // Default: empty args
  return {};
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function createToolCommand(getConfigPath: () => string): Command {
  const cmd = new Command('tool')
    .description('MCP tool operations');

  // ─────────────────────────────────────────────────────────────────
  // tool ls <connector>
  // ─────────────────────────────────────────────────────────────────
  cmd
    .command('ls <connector>')
    .description('List tools available on a connector')
    .option('--timeout <sec>', 'Timeout in seconds', '30')
    .action(async (connectorId: string, options: { timeout: string }) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();
        const connector = await getConnector(getConfigPath(), connectorId);

        if (!connector) {
          console.error(`Connector not found: ${connectorId}`);
          process.exit(1);
        }

        if (!connector.enabled) {
          console.error(`Connector is disabled: ${connectorId}`);
          console.error(`Enable it with: pfscan connectors enable --id ${connectorId}`);
          process.exit(1);
        }

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        const result = await listTools(ctx, connector, {
          timeout: parseInt(options.timeout, 10),
        });

        if (result.error) {
          console.error(`Failed to list tools: ${result.error}`);
          if (result.sessionId) {
            console.error(`Session: ${result.sessionId.slice(0, 8)} (recorded as failure)`);
          }
          process.exit(1);
        }

        if (getOutputOptions().json) {
          output({
            tools: result.tools,
            sessionId: result.sessionId,
          });
          return;
        }

        if (result.tools.length === 0) {
          console.log('No tools available on this connector');
          console.log(`Session: ${result.sessionId.slice(0, 8)}`);
          return;
        }

        // Table format
        const maxName = Math.max(12, ...result.tools.map(t => t.name.length));

        console.log();
        console.log(
          'Tool'.padEnd(maxName) + '  ' +
          'Required'.padEnd(8) + '  ' +
          'Description'
        );
        console.log('-'.repeat(maxName + 50));

        for (const tool of result.tools) {
          const schema = formatInputSchema(tool.inputSchema);
          const requiredCount = schema.required.length;
          const desc = tool.description
            ? truncate(tool.description.split('\n')[0], 40)
            : '-';

          console.log(
            tool.name.padEnd(maxName) + '  ' +
            String(requiredCount).padEnd(8) + '  ' +
            desc
          );
        }

        console.log();
        console.log(`Found ${result.tools.length} tool(s)`);
        console.log(`Session: ${result.sessionId.slice(0, 8)}`);

      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────
  // tool show <connector> <tool-name>
  // ─────────────────────────────────────────────────────────────────
  cmd
    .command('show <connector> <tool-name>')
    .description('Show tool details including input schema')
    .option('--timeout <sec>', 'Timeout in seconds', '30')
    .action(async (connectorId: string, toolName: string, options: { timeout: string }) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();
        const connector = await getConnector(getConfigPath(), connectorId);

        if (!connector) {
          console.error(`Connector not found: ${connectorId}`);
          process.exit(1);
        }

        if (!connector.enabled) {
          console.error(`Connector is disabled: ${connectorId}`);
          process.exit(1);
        }

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        const result = await getTool(ctx, connector, toolName, {
          timeout: parseInt(options.timeout, 10),
        });

        if (result.error) {
          console.error(`Error: ${result.error}`);
          if (result.sessionId) {
            console.error(`Session: ${result.sessionId.slice(0, 8)}`);
          }
          process.exit(1);
        }

        if (!result.tool) {
          console.error(`Tool not found: ${toolName}`);
          process.exit(1);
        }

        if (getOutputOptions().json) {
          output({
            tool: result.tool,
            sessionId: result.sessionId,
          });
          return;
        }

        const tool = result.tool;
        const schema = formatInputSchema(tool.inputSchema);

        console.log();
        console.log(`Tool: ${tool.name}`);
        console.log();

        if (tool.description) {
          console.log('Description:');
          for (const line of tool.description.split('\n')) {
            console.log('  ' + line);
          }
          console.log();
        }

        if (schema.required.length > 0) {
          console.log('Required arguments:');
          for (const arg of schema.required) {
            const typeStr = arg.type ? ` (${arg.type})` : '';
            console.log(`  ${arg.name}${typeStr}`);
            if (arg.description) {
              console.log(`    ${arg.description}`);
            }
          }
          console.log();
        }

        if (schema.optional.length > 0) {
          console.log('Optional arguments:');
          for (const arg of schema.optional) {
            const typeStr = arg.type ? ` (${arg.type})` : '';
            const defaultStr = arg.default !== undefined ? ` [default: ${JSON.stringify(arg.default)}]` : '';
            console.log(`  ${arg.name}${typeStr}${defaultStr}`);
            if (arg.description) {
              console.log(`    ${arg.description}`);
            }
          }
          console.log();
        }

        console.log(`Session: ${result.sessionId.slice(0, 8)}`);
        console.log(`Run with: pfscan tool call ${connectorId} ${toolName} --args '{...}'`);

      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────
  // tool call <connector> <tool-name>
  // ─────────────────────────────────────────────────────────────────
  cmd
    .command('call <connector> <tool-name>')
    .description('Call an MCP tool')
    .option('--args <json>', 'Arguments as JSON string')
    .option('--args-file <path>', 'Read arguments from JSON file')
    .option('--stdin', 'Read arguments from stdin (JSON)')
    .option('--timeout <sec>', 'Timeout in seconds', '30')
    .option('--dry-run', 'Show what would be sent without executing')
    .action(async (
      connectorId: string,
      toolName: string,
      options: {
        args?: string;
        argsFile?: string;
        stdin?: boolean;
        timeout: string;
        dryRun?: boolean;
      }
    ) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();
        const connector = await getConnector(getConfigPath(), connectorId);

        if (!connector) {
          console.error(`Connector not found: ${connectorId}`);
          process.exit(1);
        }

        if (!connector.enabled) {
          console.error(`Connector is disabled: ${connectorId}`);
          process.exit(1);
        }

        // Resolve arguments
        const args = await resolveArgs({
          args: options.args,
          argsFile: options.argsFile,
          stdin: options.stdin,
        });

        // Dry run - show what would be sent
        if (options.dryRun) {
          if (getOutputOptions().json) {
            output({
              dryRun: true,
              connector: connectorId,
              tool: toolName,
              arguments: args,
            });
          } else {
            console.log('Dry run - would send:');
            console.log(JSON.stringify({
              connector: connectorId,
              tool: toolName,
              arguments: args,
            }, null, 2));
          }
          return;
        }

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        const result = await callTool(ctx, connector, toolName, args, {
          timeout: parseInt(options.timeout, 10),
        });

        if (getOutputOptions().json) {
          output({
            success: result.success,
            sessionId: result.sessionId,
            content: result.content,
            isError: result.isError,
            error: result.error,
          });
          if (!result.success) {
            process.exit(1);
          }
          return;
        }

        // Human-readable output
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          if (result.sessionId) {
            console.error(`Session: ${result.sessionId.slice(0, 8)} (recorded as failure)`);
          }
          process.exit(1);
        }

        console.log();
        if (result.isError) {
          console.log('Tool returned error:');
        } else {
          console.log('Result:');
        }

        // Format content for display
        if (result.content && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (typeof item === 'object' && item !== null) {
              const content = item as { type?: string; text?: string; data?: unknown };
              if (content.type === 'text' && content.text) {
                console.log('  ' + content.text);
              } else {
                console.log(JSON.stringify(item, null, 2));
              }
            } else {
              console.log('  ' + String(item));
            }
          }
        } else if (result.content) {
          console.log(JSON.stringify(result.content, null, 2));
        }

        console.log();
        console.log(`Session: ${result.sessionId.slice(0, 8)}`);
        console.log(`View details: pfscan rpc list --session ${result.sessionId.slice(0, 8)}`);

      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  return cmd;
}
