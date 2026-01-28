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
    .description('[DEPRECATED] Use "plans run" instead. Scan MCP servers.');

  cmd
    .command('start')
    .description('[DEPRECATED] Use "plans run <plan> --connector <id>" instead')
    .argument('[connectorId]', 'Connector ID (alternative to --id)')
    .option('--id <id>', 'Connector ID')
    .option('--timeout <seconds>', 'Timeout in seconds', '30')
    .option('--dry-run', 'Run scan without saving to database')
    .action(async (connectorIdArg, options) => {
      // Support both positional argument and --id option
      const targetId = options.id || connectorIdArg; // CLI option name preserved, internal uses targetId
      // Show deprecation warning
      console.warn('\x1b[33m[DEPRECATED]\x1b[0m "scan start" is deprecated.');
      console.warn('  Use: pfscan plans run basic-mcp --connector <id>');
      console.warn('  Or:  pfscan plans run minimal-mcp --connector <id>');
      console.warn();

      if (!targetId) {
        console.error('Error: Connector ID is required.\n');
        console.error('Usage:');
        console.error('  pfscan scan start <connectorId>');
        console.error('  pfscan scan start --id <connectorId>\n');
        console.error('To list available connectors:');
        console.error('  pfscan connectors list');
        process.exit(1);
      }

      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(targetId);

        if (!connector) {
          outputError(`Connector not found: ${targetId}`);
          process.exit(1);
        }

        if (!connector.enabled) {
          outputError(`Connector '${targetId}' is disabled. Enable it first.`);
          process.exit(1);
        }

        const opts = getOutputOptions();
        const dryRun = options.dryRun || false;

        if (!opts.json) {
          console.log(`${dryRun ? '[DRY RUN] ' : ''}Scanning connector: ${targetId}...`);
        }

        const scanner = new Scanner(manager.getConfigDir());
        const result = await scanner.scan(connector, {
          timeout: parseInt(options.timeout, 10),
          dryRun,
        });

        if (result.success) {
          // Save as current session for future commands
          if (!dryRun) {
            setCurrentSession(result.sessionId, targetId);
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
