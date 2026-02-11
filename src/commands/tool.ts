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
import type { Connector } from '../types/index.js';
import { output, getOutputOptions } from '../utils/output.js';

/** Default stdin read timeout in milliseconds */
const STDIN_TIMEOUT_MS = 5000;

/** Minimum allowed timeout in seconds */
const MIN_TIMEOUT_SEC = 1;

/** Maximum allowed timeout in seconds */
const MAX_TIMEOUT_SEC = 300;

/**
 * Validation error interface
 */
interface ValidationError {
  field: string;
  message: string;
  expected?: string;
  got?: string;
}

/**
 * Validate arguments against inputSchema
 */
function validateArgs(
  args: Record<string, unknown>,
  inputSchema: unknown
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!inputSchema || typeof inputSchema !== 'object') return errors;

  const schema = inputSchema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  const properties = schema.properties || {};
  const required = schema.required || [];

  // Check required fields
  for (const field of required) {
    if (!(field in args) || args[field] === undefined || args[field] === null) {
      const prop = properties[field];
      errors.push({
        field,
        message: `Missing required parameter '${field}'`,
        expected: prop?.type ? `{ ${field}: ${prop.type} }` : undefined,
      });
    }
  }

  // Check types for provided fields
  for (const [field, value] of Object.entries(args)) {
    const prop = properties[field];
    if (!prop) continue; // Unknown field, let server handle it

    const expectedType = prop.type;
    if (!expectedType) continue;

    const actualType = getJsonType(value);
    if (expectedType !== actualType && !(expectedType === 'integer' && actualType === 'number')) {
      errors.push({
        field,
        message: `Type mismatch for '${field}'`,
        expected: `{ ${field}: ${expectedType} }`,
        got: `{ ${field}: ${JSON.stringify(value)} } (${actualType})`,
      });
    }
  }

  return errors;
}

/**
 * Get JSON type of a value
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Parse and validate timeout value
 */
function parseTimeout(timeoutStr: string): number {
  const timeout = parseInt(timeoutStr, 10);
  if (isNaN(timeout) || timeout < MIN_TIMEOUT_SEC || timeout > MAX_TIMEOUT_SEC) {
    throw new Error(`Invalid timeout: must be ${MIN_TIMEOUT_SEC}-${MAX_TIMEOUT_SEC} seconds`);
  }
  return timeout;
}

/**
 * Validate and get connector, with proper error messages
 */
async function validateConnector(
  getConfigPath: () => string,
  connectorId: string
): Promise<{ connector: Connector; configDir: string }> {
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

  return { connector, configDir };
}

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
    // Validate file exists and is readable
    if (!fs.existsSync(options.argsFile)) {
      throw new Error(`File not found: ${options.argsFile}`);
    }
    const stat = fs.statSync(options.argsFile);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${options.argsFile}`);
    }
    try {
      const content = fs.readFileSync(options.argsFile, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Invalid JSON in file ${options.argsFile}: ${e.message}`);
      }
      throw new Error(`Failed to read --args-file: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (options.stdin) {
    // Check if stdin is a TTY (no pipe)
    if (process.stdin.isTTY) {
      throw new Error('--stdin requires piped input (e.g., echo \'{"key":"value"}\' | pfscan tool call ...)');
    }

    return new Promise((resolve, reject) => {
      let data = '';
      const timeoutId = setTimeout(() => {
        process.stdin.destroy();
        reject(new Error(`Timeout reading from stdin after ${STDIN_TIMEOUT_MS}ms`));
      }, STDIN_TIMEOUT_MS);

      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => {
        clearTimeout(timeoutId);
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (e) {
          reject(new Error(`Invalid JSON from stdin: ${e instanceof Error ? e.message : e}`));
        }
      });
      process.stdin.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  // Default: empty args
  return {};
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (maxLen < 4) return str.slice(0, maxLen);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Get first non-empty line from description, truncated
 * Returns "(no description)" if empty or missing
 */
function getFirstLine(description: string | undefined, maxLen: number): string {
  if (!description) return '(no description)';

  // Trim and split by newlines
  const lines = description.trim().split('\n');

  // Find first non-empty line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return truncate(trimmed, maxLen);
    }
  }

  return '(no description)';
}

export function createToolCommand(getConfigPath: () => string): Command {
  const cmd = new Command('tool')
    .description('MCP tool operations');

  // ─────────────────────────────────────────────────────────────────
  // tool ls <connector>
  // ─────────────────────────────────────────────────────────────────
  cmd
    .command('ls <connector>')
    .alias('list')
    .description('List tools available on a connector')
    .option('--timeout <sec>', 'Timeout in seconds', '30')
    .action(async (connectorId: string, options: { timeout: string }) => {
      try {
        const timeout = parseTimeout(options.timeout);
        const { connector, configDir } = await validateConnector(getConfigPath, connectorId);

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        const result = await listTools(ctx, connector, {
          timeout,
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
          const desc = getFirstLine(tool.description, 40);

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
        const timeout = parseTimeout(options.timeout);
        const { connector, configDir } = await validateConnector(getConfigPath, connectorId);

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        const result = await getTool(ctx, connector, toolName, {
          timeout,
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
    .option('--batch <json-array>', 'Execute tool with multiple argument sets (JSON array)')
    .option('--timeout <sec>', 'Timeout in seconds', '30')
    .option('--dry-run', 'Show what would be sent without executing')
    .option('--skip-validation', 'Skip argument validation against schema')
    .action(async (
      connectorId: string,
      toolName: string,
      options: {
        args?: string;
        argsFile?: string;
        stdin?: boolean;
        batch?: string;
        timeout: string;
        dryRun?: boolean;
        skipValidation?: boolean;
      }
    ) => {
      try {
        const timeout = parseTimeout(options.timeout);

        // Resolve arguments first (before connector validation for dry-run)
        // Skip in batch mode - args are provided in --batch
        const args = options.batch
          ? {}
          : await resolveArgs({
              args: options.args,
              argsFile: options.argsFile,
              stdin: options.stdin,
            });

        // Dry run - show what would be sent (no connector validation needed)
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

        const { connector, configDir } = await validateConnector(getConfigPath, connectorId);

        const ctx: ToolContext = {
          connectorId,
          configDir,
        };

        // Validate arguments against schema (unless skipped or batch mode)
        // Store toolResult for potential batch mode validation
        let toolResult: Awaited<ReturnType<typeof getTool>> | undefined;
        if (!options.skipValidation && !options.batch) {
          toolResult = await getTool(ctx, connector, toolName, {
            timeout,
          });

          if (toolResult.tool?.inputSchema) {
            const validationErrors = validateArgs(args, toolResult.tool.inputSchema);

            if (validationErrors.length > 0) {
              console.error('Validation failed:');
              for (const err of validationErrors) {
                console.error(`  ${err.message}`);
                if (err.expected) console.error(`    Expected: ${err.expected}`);
                if (err.got) console.error(`    Got: ${err.got}`);
              }
              console.error();
              console.error(`Run: pfscan tool show ${connectorId} ${toolName} for details`);
              console.error('Use --skip-validation to bypass this check');
              process.exit(1);
            }
          }
        }

        // Batch execution mode
        if (options.batch) {
          // Parse batch arguments
          let batchArgs: Record<string, unknown>[];
          try {
            batchArgs = JSON.parse(options.batch);
            if (!Array.isArray(batchArgs)) {
              throw new Error('--batch must be a JSON array');
            }
          } catch (e) {
            console.error(`Invalid JSON in --batch: ${e instanceof Error ? e.message : e}`);
            process.exit(1);
          }

          // Get tool schema for validation if enabled
          if (!options.skipValidation && !toolResult) {
            toolResult = await getTool(ctx, connector, toolName, {
              timeout,
            });
          }

          // Validate each argument set if validation is enabled
          if (!options.skipValidation && toolResult?.tool?.inputSchema) {
            for (let i = 0; i < batchArgs.length; i++) {
              const validationErrors = validateArgs(batchArgs[i], toolResult.tool.inputSchema);
              if (validationErrors.length > 0) {
                console.error(`Validation failed for batch item ${i}:`);
                for (const err of validationErrors) {
                  console.error(`  ${err.message}`);
                  if (err.expected) console.error(`    Expected: ${err.expected}`);
                  if (err.got) console.error(`    Got: ${err.got}`);
                }
                process.exit(1);
              }
            }
          }

          // Execute in parallel
          // TODO: Add --concurrency option to limit parallel executions
          const results = await Promise.all(
            batchArgs.map(async (batchArg) => {
              try {
                const result = await callTool(ctx, connector, toolName, batchArg, {
                  timeout,
                });
                return {
                  args: batchArg,
                  result: result.content,
                  ok: result.success && !result.isError,
                  error: result.error,
                };
              } catch (e) {
                return {
                  args: batchArg,
                  result: null,
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            })
          );

          if (getOutputOptions().json) {
            output({ batch: true, results, sessionId: 'batch' });
            return;
          }

          // Human-readable output
          console.log();
          console.log(`Batch results (${results.length} items):`);
          console.log();
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const status = r.ok ? '✓' : '✗';
            console.log(`[${i}] ${status} ${JSON.stringify(r.args)}`);
            if (r.ok && r.result) {
              // Truncate result for display
              const resultStr = JSON.stringify(r.result);
              console.log(`    ${resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr}`);
            } else if (r.error) {
              console.log(`    Error: ${r.error}`);
            }
          }
          console.log();
          const okCount = results.filter(r => r.ok).length;
          console.log(`${okCount}/${results.length} succeeded`);
          return;
        }

        const result = await callTool(ctx, connector, toolName, args, {
          timeout,
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
