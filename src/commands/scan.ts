/**
 * Scan commands
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { Scanner } from '../scanner/index.js';
import { output, outputError, getOutputOptions } from '../utils/output.js';
import { setCurrentSession } from '../utils/state.js';

export function createScanCommand(getConfigPath: () => string): Command {
  const cmd = new Command('scan')
    .description('Scan MCP servers (use: scan start --id <connector>)')
    .allowUnknownOption(true)
    .action((_options, command) => {
      // Detect common mistake: `pfscan scan --id xxx` instead of `pfscan scan start --id xxx`
      const args = command.args || [];
      const rawArgs = process.argv.slice(2);

      // Check if --id was passed directly to scan (not to a subcommand)
      if (rawArgs.includes('--id') && !args.includes('start')) {
        console.error('Error: --id is an option for `scan start`, not `scan` directly.\n');
        console.error('Try: pfscan scan start --id <connector-id>');
        console.error('     pfscan s start --id <connector-id>\n');
        console.error('Run `pfscan scan --help` for available subcommands.');
        process.exit(2);
      }

      // If no subcommand provided, show help
      cmd.help();
    });

  cmd
    .command('start')
    .description('Start scanning a connector')
    .argument('[connectorId]', 'Connector ID (alternative to --id)')
    .option('--id <id>', 'Connector ID')
    .option('--timeout <seconds>', 'Timeout in seconds', '30')
    .option('--dry-run', 'Run scan without saving to database')
    .action(async (connectorIdArg, options) => {
      // Support both positional argument and --id option
      const connectorId = options.id || connectorIdArg;

      if (!connectorId) {
        console.error('Error: Connector ID is required.\n');
        console.error('Usage:');
        console.error('  pfscan scan start <connectorId>');
        console.error('  pfscan scan start --id <connectorId>\n');
        console.error('To list available connectors:');
        console.error('  pfscan connectors list');
        process.exit(1);
      }

      // Use connectorId instead of options.id from here
      options.id = connectorId;
      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(options.id);

        if (!connector) {
          outputError(`Connector not found: ${options.id}`);
          process.exit(1);
        }

        if (!connector.enabled) {
          outputError(`Connector '${options.id}' is disabled. Enable it first.`);
          process.exit(1);
        }

        const opts = getOutputOptions();
        const dryRun = options.dryRun || false;

        if (!opts.json) {
          console.log(`${dryRun ? '[DRY RUN] ' : ''}Scanning connector: ${options.id}...`);
        }

        const scanner = new Scanner(manager.getConfigDir());
        const result = await scanner.scan(connector, {
          timeout: parseInt(options.timeout, 10),
          dryRun,
        });

        if (result.success) {
          // Save as current session for future commands
          if (!dryRun) {
            setCurrentSession(result.sessionId, result.connectorId);
          }

          const toolCount = result.tools?.length || 0;
          const toolNames = result.tools?.map((t: unknown) => {
            if (typeof t === 'object' && t !== null && 'name' in t) {
              return (t as { name: string }).name;
            }
            return '?';
          }) || [];

          output(
            {
              success: true,
              dry_run: dryRun,
              connector_id: result.connectorId,
              session_id: result.sessionId,
              tools_count: toolCount,
              tools: toolNames,
              event_count: result.eventCount,
            },
            `✓ Scan successful!${dryRun ? ' (dry run - not saved)' : ''}\n` +
            `  Connector: ${result.connectorId}\n` +
            (dryRun ? '' : `  Session: ${result.sessionId}\n`) +
            `  Tools found: ${toolCount}\n` +
            (toolNames.length > 0 ? `  Tool names: ${toolNames.join(', ')}\n` : '') +
            `  Events: ${result.eventCount}${dryRun ? ' (not recorded)' : ' recorded'}`
          );
        } else {
          output(
            {
              success: false,
              dry_run: dryRun,
              connector_id: result.connectorId,
              session_id: result.sessionId,
              error: result.error,
              event_count: result.eventCount,
            },
            `✗ Scan failed!${dryRun ? ' (dry run)' : ''}\n` +
            `  Connector: ${result.connectorId}\n` +
            (dryRun ? '' : `  Session: ${result.sessionId}\n`) +
            `  Error: ${result.error}\n` +
            `  Events: ${result.eventCount}${dryRun ? ' (not recorded)' : ' recorded'}`
          );
          process.exit(1);
        }
      } catch (error) {
        const opts = getOutputOptions();
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (opts.json) {
          output({
            success: false,
            error: errorMessage,
            stack: opts.verbose && error instanceof Error ? error.stack : undefined,
          });
        } else {
          // Always show short error summary
          console.error(`\n✗ Scan failed: ${errorMessage}\n`);

          // Show stack trace only in verbose mode
          if (opts.verbose && error instanceof Error && error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
            console.error();
          }

          // Always show next steps guidance
          console.error('Next steps:');
          console.error('  pfscan doctor              Check database health');
          console.error('  pfscan status              Show system status');
          console.error('  pfscan connectors list     Verify connector exists');
          console.error('  pfscan view --errors       Check recent errors');
        }
        process.exit(1);
      }
    });

  return cmd;
}
