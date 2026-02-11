/**
 * Status command - show current database and system status
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { getDbSizes, getDbPaths, getEventsDb, diagnoseEventsDb } from '../db/connection.js';
import { formatBytes } from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';
import { t } from '../i18n/index.js';

interface ResourceInfo {
  enabledCount: number;
  totalCount: number;
  toolCount?: number;
  estimatedTokens?: number;
  warning?: string;
}

/**
 * Calculate resource usage information
 * @param manager - ConfigManager instance
 * @param showTools - Whether to fetch tool counts (slow operation)
 * @returns Resource usage information
 */
async function calculateResourceInfo(manager: ConfigManager, showTools: boolean): Promise<ResourceInfo> {
  const connectors = await manager.getConnectors();

  // Count enabled/total connectors
  const enabledCount = connectors.filter(c => c.enabled).length;
  const totalCount = connectors.length;

  let toolCount: number | undefined;
  let estimatedTokens: number | undefined;
  let warning: string | undefined;

  // Get latest tools/list response for each enabled connector
  let totalTools = 0;
  let totalBytes = 0;

  if (showTools && enabledCount > 0) {
    const db = getEventsDb(manager.getConfigDir());

    for (const connector of connectors) {
      if (!connector.enabled) continue;

      const result = db.prepare(`
        SELECT e.raw_json, r.request_ts
        FROM events e
        JOIN rpc_calls r ON e.rpc_id = r.rpc_id AND e.session_id = r.session_id
        JOIN sessions s ON e.session_id = s.session_id
        WHERE s.connector_id = ?
          AND r.method = 'tools/list'
          AND e.kind = 'response'
        ORDER BY e.ts DESC
        LIMIT 1
      `).get(connector.id) as { raw_json: string | null } | undefined;

      if (result?.raw_json) {
        try {
          const json = JSON.parse(result.raw_json);
          const tools = json.result?.tools;
          if (Array.isArray(tools)) {
            totalTools += tools.length;
            // Calculate bytes for token estimation
            const toolsStr = JSON.stringify(tools);
            totalBytes += Buffer.byteLength(toolsStr, 'utf8');
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    toolCount = totalTools;
    estimatedTokens = Math.ceil(totalBytes / 4); // 1 token ≈ 4 bytes

    // Warning threshold: 5000 tokens
    if (estimatedTokens > 5000) {
      warning = t('resources.warningExceeds');
    }
  }

  return {
    enabledCount,
    totalCount,
    toolCount,
    estimatedTokens,
    warning,
  };
}

/**
 * Display resource information
 */
function displayResources(resources: ResourceInfo, json: boolean): void {
  if (json) {
    output({
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
    });
    return;
  }

  console.log(t('resources.title'));
  if (resources.totalCount === 0) {
    console.log(`  ${t('resources.noConnectors')}`);
    console.log();
    return;
  }

  console.log(`  ${t('resources.connectors')} ${resources.enabledCount} ${t('resources.enabled')} / ${resources.totalCount} ${t('resources.total')}`);

  if (resources.toolCount !== undefined) {
    console.log(`  ${t('resources.tools')} ${resources.toolCount} ${t('resources.total')}`);
    if (resources.estimatedTokens !== undefined) {
      console.log(`  ${t('resources.estimatedContext')} ~${resources.estimatedTokens.toLocaleString()} ${t('resources.tokens')}`);
    }
  }
  console.log();

  if (resources.warning) {
    console.log(`⚠️  ${resources.warning}`);
    console.log(`   ${t('resources.considerDisabling')}`);
    console.log();
  }
}

export function createStatusCommand(getConfigPath: () => string): Command {
  const cmd = new Command('status')
    .description('Show database and system status')
    .option('--resources', 'Show resource usage (tools and estimated context tokens)')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());
        const dbSizes = getDbSizes(manager.getConfigDir());
        const dbPaths = getDbPaths(manager.getConfigDir());

        // Get schema info
        const schema = store.getSchema();

        // Get connectors
        const connectors = store.getConnectors();

        // Get total sessions and events
        const sessions = store.getSessions(undefined, 1000);
        const totalSessions = sessions.length;
        const totalRpcs = sessions.reduce((sum, s) => sum + (s.rpc_count || 0), 0);
        const totalEvents = sessions.reduce((sum, s) => sum + (s.event_count || 0), 0);

        // Find latest session
        const latestSession = sessions[0];
        const latestTime = latestSession ? new Date(latestSession.started_at).toISOString() : null;

        // Calculate resource info
        const resources = await calculateResourceInfo(manager, options.resources);

        const status = {
          config_path: manager.getConfigPath(),
          config_dir: manager.getConfigDir(),
          db: {
            events_db_path: dbPaths.events,
            events_db_size: dbSizes.events,
            proofs_db_path: dbPaths.proofs,
            proofs_db_size: dbSizes.proofs,
            schema_version: schema.version,
            tables: Array.from(schema.tables.keys()),
          },
          data: {
            connectors: connectors.length,
            sessions: totalSessions,
            rpcs: totalRpcs,
            events: totalEvents,
            latest_session: latestTime,
          },
          ...(options.resources && {
            resources: {
              connectors: {
                enabled: resources.enabledCount,
                total: resources.totalCount,
              },
              ...(resources.toolCount !== undefined && {
                tools: resources.toolCount,
                estimatedTokens: resources.estimatedTokens,
              }),
            },
          }),
        };

        if (getOutputOptions().json) {
          output(status);
          return;
        }

        console.log('proofscan Status');
        console.log('═════════════════════════════════════════════════════');
        console.log();

        console.log(t('status.configuration'));
        console.log(`  Config file:  ${manager.getConfigPath()}`);
        console.log(`  Data dir:     ${manager.getConfigDir()}`);
        console.log();

        console.log(t('status.database'));
        console.log(`  events.db:    ${formatBytes(dbSizes.events)}`);
        console.log(`  proofs.db:    ${formatBytes(dbSizes.proofs)}`);
        console.log(`  Schema ver:   ${schema.version}`);
        console.log(`  Tables:       ${Array.from(schema.tables.keys()).join(', ')}`);
        console.log();

        console.log(t('status.dataSummary'));
        console.log(`  Connectors:   ${connectors.length}`);
        console.log(`  Sessions:     ${totalSessions}`);
        console.log(`  RPC calls:    ${totalRpcs}`);
        console.log(`  Events:       ${totalEvents}`);
        if (latestTime) {
          console.log(`  Latest:       ${latestTime}`);
        }
        console.log();

        // Display resources
        displayResources(resources, false);

        if (connectors.length > 0) {
          console.log(t('status.connectors'));
          for (const c of connectors.slice(0, 5)) {
            console.log(`  - ${c.id} (${c.session_count} sessions)`);
          }
          if (connectors.length > 5) {
            console.log(`  ... and ${connectors.length - 5} more`);
          }
          console.log();
        }

        console.log('Quick Commands:');
        console.log('  pfscan view           Show recent events');
        console.log('  pfscan tree           Show structure');
        console.log('  pfscan explore        Interactive browse');
        console.log('  pfscan scan start     Run a new scan');

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          // Show paths even when no data
          const manager = new ConfigManager(getConfigPath());
          const dbPaths = getDbPaths(manager.getConfigDir());
          const dbSizes = getDbSizes(manager.getConfigDir());
          const diagnostic = diagnoseEventsDb(manager.getConfigDir());

          // Calculate resource info from config only (no DB needed)
          const resources = await calculateResourceInfo(manager, false);

          if (getOutputOptions().json) {
            output({
              status: 'no_data',
              config_path: manager.getConfigPath(),
              config_dir: manager.getConfigDir(),
              db: {
                events_db_path: dbPaths.events,
                events_db_size: dbSizes.events,
                events_db_version: diagnostic.userVersion,
                proofs_db_path: dbPaths.proofs,
                proofs_db_size: dbSizes.proofs,
              },
              ...(options.resources && {
                resources: {
                  connectors: {
                    enabled: resources.enabledCount,
                    total: resources.totalCount,
                  },
                },
              }),
            });
            return;
          }

          console.log('proofscan Status');
          console.log('═════════════════════════════════════════════════════');
          console.log();
          console.log(t('status.configuration'));
          console.log(`  Config file:  ${manager.getConfigPath()}`);
          console.log(`  Data dir:     ${manager.getConfigDir()}`);
          console.log();
          console.log(t('status.database'));
          console.log(`  events.db:    ${dbPaths.events}`);
          console.log(`                ${formatBytes(dbSizes.events)} (version: ${diagnostic.userVersion ?? 'N/A'})`);
          console.log(`  proofs.db:    ${dbPaths.proofs}`);
          console.log(`                ${formatBytes(dbSizes.proofs)}`);
          console.log();

          // Display resources even when no data
          displayResources(resources, false);

          console.log(t('status.noDataYet'));
          console.log();
          console.log('  pfscan config init');
          console.log('  pfscan connectors import --from mcpServers --stdin');
          console.log('  pfscan scan start --id <connector>');
          console.log();
          console.log('Troubleshooting:');
          console.log('  pfscan doctor         Run diagnostics');
          return;
        }
        throw error;
      }
    });

  return cmd;
}

// Aliases
export { createStatusCommand as createStCommand };
