/**
 * Doctor command - diagnose and fix database issues
 *
 * Phase 7.8: Extended with connector, resource, and registry diagnostics.
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { diagnoseEventsDb, fixEventsDb, diagnoseProofsDb, fixProofsDb } from '../db/connection.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';
import { calculateResourceInfo } from './status.js';
import { listTools } from '../tools/adapter.js';
import type { ToolContext } from '../tools/adapter.js';

// Constants
const CONNECTOR_PING_TIMEOUT_MS = 3000;

interface ConnectorPingResult {
  connectorId: string;
  status: 'ok' | 'slow' | 'error';
  message: string;
  duration: number;
}

/**
 * Ping all enabled connectors and measure response time
 */
async function pingConnectors(
  manager: ConfigManager,
  timeoutMs: number
): Promise<ConnectorPingResult[]> {
  const connectors = await manager.getConnectors();
  const enabledConnectors = connectors.filter(c => c.enabled);

  const results: ConnectorPingResult[] = [];

  for (const connector of enabledConnectors) {
    const ctx: ToolContext = {
      connectorId: connector.id,
      configDir: manager.getConfigDir(),
    };

    const startTime = Date.now();

    try {
      const result = await listTools(ctx, connector, { timeout: timeoutMs / 1000 });

      const duration = Date.now() - startTime;

      if (result.error) {
        results.push({
          connectorId: connector.id,
          status: 'error',
          message: result.error,
          duration,
        });
      } else {
        // Determine status based on duration
        let status: 'ok' | 'slow' | 'error' = 'ok';
        if (duration > timeoutMs * 0.8) {
          status = 'slow';
        }

        results.push({
          connectorId: connector.id,
          status,
          message: 'OK',
          duration,
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      results.push({
        connectorId: connector.id,
        status: 'error',
        message: errMsg,
        duration,
      });
    }
  }

  return results;
}

/**
 * Get registry information
 */
async function getRegistryInfo(manager: ConfigManager): Promise<{
  total: number;
  mcpCount: number;
  a2aCount: number;
}> {
  const connectors = await manager.getConnectors();

  const mcpCount = connectors.filter(c => c.transport.type === 'stdio').length;
  const a2aCount = connectors.filter(c => c.transport.type !== 'stdio').length;

  return {
    total: connectors.length,
    mcpCount,
    a2aCount,
  };
}

export function createDoctorCommand(getConfigPath: () => string): Command {
  const cmd = new Command('doctor')
    .description('Diagnose database issues and optionally fix them')
    .option('--fix', 'Attempt to fix detected issues')
    .option('--skip-connectors', 'Skip connector ping diagnostics (faster)')
    .option('--timeout <ms>', 'Connector ping timeout in milliseconds', String(CONNECTOR_PING_TIMEOUT_MS))
    .action(async (options) => {
      const manager = new ConfigManager(getConfigPath());
      const configDir = manager.getConfigDir();

      // Parse timeout
      const timeoutMs = parseInt(options.timeout, 10) || CONNECTOR_PING_TIMEOUT_MS;

      // Run database diagnostics
      const eventsDiag = diagnoseEventsDb(configDir);
      const proofsDiag = diagnoseProofsDb(configDir);

      // Run connector pings (if not skipped)
      let connectorResults: ConnectorPingResult[] = [];
      if (!options.skipConnectors) {
        connectorResults = await pingConnectors(manager, timeoutMs);
      }

      // Get resource info
      const resources = await calculateResourceInfo(manager, true);

      // Get registry info
      const registryInfo = await getRegistryInfo(manager);

      if (getOutputOptions().json) {
        const result: Record<string, unknown> = {
          config_path: manager.getConfigPath(),
          config_dir: configDir,
          events_db: eventsDiag,
          proofs_db: proofsDiag,
          connectors: connectorResults,
          resources: {
            connectors: {
              enabled: resources.enabledCount,
              total: resources.totalCount,
            },
            ...(resources.toolCount !== undefined && {
              tools: resources.toolCount,
              estimatedTokens: resources.estimatedTokens,
            }),
            ...(resources.warning && { warning: resources.warning }),
          },
          registry: registryInfo,
        };

        if (options.fix) {
          if (eventsDiag.missingTables.length > 0 || eventsDiag.missingColumns.length > 0) {
            result.events_fix_result = fixEventsDb(configDir);
          }
          if (proofsDiag.missingTables.length > 0) {
            result.proofs_fix_result = fixProofsDb(configDir);
          }
        }

        output(result);
        return;
      }

      // Human-readable output
      console.log('proofscan Doctor');
      console.log('═════════════════════════════════════════════════════');
      console.log();

      // Database section
      console.log('Database:');

      if (eventsDiag.exists && eventsDiag.readable) {
        const expectedVersion = proofsDiag.expectedVersion;
        const isCurrent = eventsDiag.userVersion === expectedVersion;

        const versionStatus = isCurrent ? '(current)' : '(expected: ' + expectedVersion + ')';
        console.log(`  ${isCurrent ? '✅' : '⚠️'} Schema version: ${eventsDiag.userVersion} ${versionStatus}`);
        console.log('  ✅ No corruption detected');
      } else if (eventsDiag.exists && !eventsDiag.readable) {
        console.log('  ❌ Cannot read database');
      } else {
        console.log('  ⚠️  No database found');
      }

      console.log();

      // Connectors section
      if (!options.skipConnectors) {
        console.log('Connectors:');

        if (connectorResults.length === 0) {
          console.log('  No enabled connectors found');
        } else {
          for (const result of connectorResults) {
            const icon = result.status === 'ok' ? '✅' : result.status === 'slow' ? '⚠️' : '❌';
            const statusText = result.status === 'ok' ? 'OK' : result.status === 'slow' ? 'slow' : result.message;
            console.log(`  ${icon} ${result.connectorId}: ${statusText} (${result.duration}ms)`);
          }

          const healthyCount = connectorResults.filter(r => r.status === 'ok' || r.status === 'slow').length;
          const failedCount = connectorResults.filter(r => r.status === 'error').length;

          console.log();
          console.log(`  ${connectorResults.length} checked, ${healthyCount} healthy, ${failedCount} failed`);
        }

        console.log();
      }

      // Resources section
      console.log('Resources:');
      console.log(`  Connectors: ${resources.enabledCount} enabled / ${resources.totalCount} total`);

      if (resources.toolCount !== undefined) {
        console.log(`  Tools: ${resources.toolCount} total`);
      }

      if (resources.estimatedTokens !== undefined) {
        console.log(`  Estimated context: ~${resources.estimatedTokens.toLocaleString()} tokens`);
      }

      if (resources.warning) {
        console.log();
        console.log(`  ⚠️  ${resources.warning}`);
      }

      console.log();

      // Registry section
      console.log('Registry:');
      if (registryInfo.total === 0) {
        console.log('  No connectors configured');
      } else {
        console.log(`  ✅ ${registryInfo.total} connectors configured (${registryInfo.mcpCount} MCP, ${registryInfo.a2aCount} A2A)`);
      }

      console.log();

      // Fix logic
      const eventsHasIssues = eventsDiag.missingTables.length > 0 || eventsDiag.missingColumns.length > 0;
      const proofsHasIssues = proofsDiag.missingTables.length > 0 ||
        (proofsDiag.userVersion !== null && proofsDiag.userVersion < proofsDiag.expectedVersion);
      const hasIssues = eventsHasIssues || proofsHasIssues;

      if (hasIssues) {
        if (options.fix) {
          console.log('Attempting to fix...');
          console.log();

          // Fix events.db
          if (eventsHasIssues) {
            const fixResult = fixEventsDb(configDir);
            if (fixResult.success && fixResult.fixed.length > 0) {
              outputSuccess(`Events DB fixed: ${fixResult.fixed.join(', ')}`);
            } else if (!fixResult.success) {
              outputError(`Events DB fix failed: ${fixResult.error}`);
            }
          }

          // Fix proofs.db
          if (proofsHasIssues) {
            const fixResult = fixProofsDb(configDir);
            if (fixResult.success && fixResult.fixed.length > 0) {
              outputSuccess(`Proofs DB fixed: ${fixResult.fixed.join(', ')}`);
            } else if (!fixResult.success) {
              outputError(`Proofs DB fix failed: ${fixResult.error}`);
            }
          }

          // Verify fixes worked
          const postEventsDiag = diagnoseEventsDb(configDir);
          const postProofsDiag = diagnoseProofsDb(configDir);

          const remainingIssues =
            postEventsDiag.missingTables.length > 0 ||
            postEventsDiag.missingColumns.length > 0 ||
            postProofsDiag.missingTables.length > 0;

          if (remainingIssues) {
            console.log();
            outputError('Some issues remain after fix. Manual intervention may be required.');
          }
        } else {
          console.log('Run with --fix to attempt repair:');
          console.log('  pfscan doctor --fix');
        }
      } else if (eventsDiag.exists || proofsDiag.exists) {
        outputSuccess('All required tables and columns present');
      } else {
        console.log('No databases found. Run a scan to create them:');
        console.log('  pfscan scan start --id <connector>');
      }

      console.log();
    });

  return cmd;
}
