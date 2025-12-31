/**
 * Shell tool commands: tool ls, tool show, send (Phase 4.0)
 *
 * These commands enable direct interaction with MCP server tools from the shell.
 *
 * Commands:
 * - tool ls         : List tools available on current connector
 * - tool show <name>: Show tool details (description, input schema)
 * - send <name>     : Interactive tool call with argument builder
 */

import type { ShellContext } from './types.js';
import { printSuccess, printError, printInfo, dimText } from './prompt.js';
import { ConfigManager } from '../config/index.js';
import {
  getConnector,
  listTools,
  getTool,
  callTool,
  formatInputSchema,
  type ToolInfo,
  type ToolContext,
  type PropertySchema,
} from '../tools/adapter.js';
import * as readline from 'readline';

/**
 * Handle 'tool' command
 */
export async function handleTool(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  if (args.length === 0) {
    printInfo('Usage: tool <subcommand>');
    printInfo('  tool ls              List tools on current connector');
    printInfo('  tool show <name>     Show tool details');
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'ls':
    case 'list':
      await handleToolLs(subArgs, context, configPath);
      break;
    case 'show':
      await handleToolShow(subArgs, context, configPath);
      break;
    default:
      printError(`Unknown subcommand: ${subcommand}`);
      printInfo('Available: ls, show');
  }
}

/**
 * Handle 'tool ls' - list tools on current connector
 */
async function handleToolLs(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  const isJson = args.includes('--json');

  // Require connector context
  if (!context.connector) {
    printError('No connector selected');
    printInfo('Use: cd <connector> to select a connector first');
    return;
  }

  const manager = new ConfigManager(configPath);
  const connector = await getConnector(configPath, context.connector);

  if (!connector) {
    printError(`Connector not found: ${context.connector}`);
    return;
  }

  if (!connector.enabled) {
    printError(`Connector is disabled: ${context.connector}`);
    printInfo('Enable it with: pfscan connectors enable --id ' + context.connector);
    return;
  }

  const ctx: ToolContext = {
    connectorId: context.connector,
    configDir: manager.getConfigDir(),
  };

  printInfo('Fetching tools...');

  const result = await listTools(ctx, connector);

  if (result.error) {
    printError(`Failed to list tools: ${result.error}`);
    return;
  }

  if (result.tools.length === 0) {
    printInfo('No tools available on this connector');
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(result.tools, null, 2));
    return;
  }

  // Table format
  const isTTY = process.stdout.isTTY;
  console.log();

  // Calculate column widths
  const maxName = Math.max(12, ...result.tools.map(t => t.name.length));

  // Header
  console.log(
    dimText('Tool', isTTY).padEnd(isTTY ? maxName + 9 : maxName) + '  ' +
    dimText('Required', isTTY).padEnd(isTTY ? 17 : 8) + '  ' +
    dimText('Description', isTTY)
  );
  console.log(dimText('-'.repeat(maxName + 50), isTTY));

  // Rows
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
  printInfo(`Found ${result.tools.length} tool(s). Use: tool show <name> for details`);
}

/**
 * Handle 'tool show' - show tool details
 */
async function handleToolShow(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  const isJson = args.includes('--json');
  const toolName = args.find(a => !a.startsWith('-'));

  if (!toolName) {
    printError('Usage: tool show <name>');
    return;
  }

  // Require connector context
  if (!context.connector) {
    printError('No connector selected');
    printInfo('Use: cd <connector> to select a connector first');
    return;
  }

  const manager = new ConfigManager(configPath);
  const connector = await getConnector(configPath, context.connector);

  if (!connector) {
    printError(`Connector not found: ${context.connector}`);
    return;
  }

  const ctx: ToolContext = {
    connectorId: context.connector,
    configDir: manager.getConfigDir(),
  };

  printInfo('Fetching tool info...');

  const result = await getTool(ctx, connector, toolName);

  if (result.error) {
    printError(result.error);
    return;
  }

  if (!result.tool) {
    printError(`Tool not found: ${toolName}`);
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(result.tool, null, 2));
    return;
  }

  // Formatted output
  const tool = result.tool;
  const isTTY = process.stdout.isTTY;

  console.log();
  console.log(dimText('Tool:', isTTY), tool.name);
  console.log();

  if (tool.description) {
    console.log(dimText('Description:', isTTY));
    // Print description with indentation
    for (const line of tool.description.split('\n')) {
      console.log('  ' + line);
    }
    console.log();
  }

  const schema = formatInputSchema(tool.inputSchema);

  if (schema.required.length > 0) {
    console.log(dimText('Required arguments:', isTTY));
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
    console.log(dimText('Optional arguments:', isTTY));
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

  printInfo(`Run with: send ${toolName}`);
}

/**
 * Handle 'send' command - interactive tool call
 */
export async function handleSend(
  args: string[],
  context: ShellContext,
  configPath: string,
  rl: readline.Interface
): Promise<void> {
  const isJson = args.includes('--json');
  const isDryRun = args.includes('--dry-run');
  const toolName = args.find(a => !a.startsWith('-'));

  if (!toolName) {
    printError('Usage: send <tool-name>');
    printInfo('Example: send get_stock_info');
    return;
  }

  // Require connector context
  if (!context.connector) {
    printError('No connector selected');
    printInfo('Use: cd <connector> to select a connector first');
    return;
  }

  const manager = new ConfigManager(configPath);
  const connector = await getConnector(configPath, context.connector);

  if (!connector) {
    printError(`Connector not found: ${context.connector}`);
    return;
  }

  const ctx: ToolContext = {
    connectorId: context.connector,
    configDir: manager.getConfigDir(),
  };

  // First, get tool info to build arguments
  printInfo('Fetching tool schema...');
  const toolResult = await getTool(ctx, connector, toolName);

  if (toolResult.error) {
    printError(toolResult.error);
    return;
  }

  if (!toolResult.tool) {
    printError(`Tool not found: ${toolName}`);
    return;
  }

  const tool = toolResult.tool;
  const schema = formatInputSchema(tool.inputSchema);

  // Build arguments interactively
  const builtArgs: Record<string, unknown> = {};

  console.log();
  console.log(`Calling: ${toolName}`);

  // Collect required arguments
  if (schema.required.length > 0) {
    console.log();
    printInfo('Required arguments:');

    for (const arg of schema.required) {
      const value = await promptForValue(rl, arg.name, arg.type, arg.description, true);
      if (value === null) {
        printError('Cancelled');
        return;
      }
      builtArgs[arg.name] = parseValue(value, arg.type);
    }
  }

  // Collect optional arguments
  if (schema.optional.length > 0) {
    console.log();
    printInfo('Optional arguments (press Enter to skip):');

    for (const arg of schema.optional) {
      const defaultHint = arg.default !== undefined ? ` [${JSON.stringify(arg.default)}]` : '';
      const value = await promptForValue(rl, arg.name + defaultHint, arg.type, arg.description, false);

      if (value === null) {
        printError('Cancelled');
        return;
      }

      if (value !== '') {
        builtArgs[arg.name] = parseValue(value, arg.type);
      } else if (arg.default !== undefined) {
        builtArgs[arg.name] = arg.default;
      }
    }
  }

  console.log();

  // Show what will be sent
  if (isDryRun) {
    printInfo('Dry run - would send:');
    console.log(JSON.stringify({ tool: toolName, arguments: builtArgs }, null, 2));
    return;
  }

  // Execute the call
  printInfo('Sending...');
  const callResult = await callTool(ctx, connector, toolName, builtArgs);

  if (!callResult.success) {
    printError(`Call failed: ${callResult.error}`);
    if (callResult.sessionId) {
      printInfo(`Session: ${callResult.sessionId.slice(0, 8)}`);
    }
    return;
  }

  // Show result
  console.log();
  if (callResult.isError) {
    printError('Tool returned error:');
  } else {
    printSuccess('Tool call succeeded:');
  }

  if (isJson) {
    console.log(JSON.stringify(callResult.content, null, 2));
  } else {
    // Format content for display
    if (callResult.content && Array.isArray(callResult.content)) {
      for (const item of callResult.content) {
        if (typeof item === 'object' && item !== null) {
          const content = item as { type?: string; text?: string; data?: unknown };
          if (content.type === 'text' && content.text) {
            console.log(content.text);
          } else {
            console.log(JSON.stringify(item, null, 2));
          }
        } else {
          console.log(String(item));
        }
      }
    } else {
      console.log(JSON.stringify(callResult.content, null, 2));
    }
  }

  console.log();
  printInfo(`Session: ${callResult.sessionId.slice(0, 8)}`);
  printInfo('View details: pfscan rpc list --session ' + callResult.sessionId.slice(0, 8));
}

/**
 * Prompt for a value from the user
 * Returns null if user presses Ctrl+C
 */
async function promptForValue(
  rl: readline.Interface,
  name: string,
  type?: string,
  description?: string,
  required?: boolean
): Promise<string | null> {
  return new Promise((resolve) => {
    const typeHint = type ? ` (${type})` : '';
    const reqHint = required ? ' *' : '';
    const prompt = `  ${name}${typeHint}${reqHint}: `;

    if (description) {
      console.log(`    ${dimText(description, process.stdout.isTTY)}`);
    }

    // Temporarily remove listeners to take control
    const lineListeners = rl.listeners('line');
    const closeListeners = rl.listeners('close');
    rl.removeAllListeners('line');
    rl.removeAllListeners('close');

    rl.question(prompt, (answer) => {
      // Restore listeners
      for (const listener of lineListeners) {
        rl.on('line', listener as (...args: unknown[]) => void);
      }
      for (const listener of closeListeners) {
        rl.on('close', listener as (...args: unknown[]) => void);
      }

      resolve(answer);
    });

    // Handle Ctrl+C during input
    const sigintHandler = () => {
      resolve(null);
    };
    rl.once('SIGINT', sigintHandler);
  });
}

/**
 * Parse a string value to the appropriate type
 */
function parseValue(value: string, type?: string): unknown {
  if (!type) return value;

  switch (type) {
    case 'number':
    case 'integer':
      return Number(value);
    case 'boolean':
      return value.toLowerCase() === 'true' || value === '1';
    case 'array':
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',').map(s => s.trim());
      }
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/**
 * Truncate a string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Get tool names for completion
 * Uses caching via the data provider
 */
export async function getToolNamesForCompletion(
  context: ShellContext,
  configPath: string
): Promise<string[]> {
  if (!context.connector) {
    return [];
  }

  try {
    const manager = new ConfigManager(configPath);
    const connector = await getConnector(configPath, context.connector);

    if (!connector || !connector.enabled) {
      return [];
    }

    const ctx: ToolContext = {
      connectorId: context.connector,
      configDir: manager.getConfigDir(),
    };

    // Note: This is called on TAB, so we use a shorter timeout
    const result = await listTools(ctx, connector, { timeout: 10 });

    if (result.error) {
      return [];
    }

    return result.tools.map(t => t.name);
  } catch {
    return [];
  }
}
