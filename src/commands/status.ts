/**
 * Status command - show current database and system status
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { getDbSizes, getDbPaths, diagnoseEventsDb } from '../db/connection.js';
import { formatBytes } from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';

export function createStatusCommand(getConfigPath: () => string): Command {
  const cmd = new Command('status')
    .description('Show database and system status')
    .action(async () => {
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
        };

        if (getOutputOptions().json) {
          output(status);
          return;
        }

        console.log('proofscan Status');
        console.log('═════════════════════════════════════════════════════');
        console.log();

        console.log('Configuration:');
        console.log(`  Config file:  ${manager.getConfigPath()}`);
        console.log(`  Data dir:     ${manager.getConfigDir()}`);
        console.log();

        console.log('Database:');
        console.log(`  events.db:    ${formatBytes(dbSizes.events)}`);
        console.log(`  proofs.db:    ${formatBytes(dbSizes.proofs)}`);
        console.log(`  Schema ver:   ${schema.version}`);
        console.log(`  Tables:       ${Array.from(schema.tables.keys()).join(', ')}`);
        console.log();

        console.log('Data Summary:');
        console.log(`  Connectors:   ${connectors.length}`);
        console.log(`  Sessions:     ${totalSessions}`);
        console.log(`  RPC calls:    ${totalRpcs}`);
        console.log(`  Events:       ${totalEvents}`);
        if (latestTime) {
          console.log(`  Latest:       ${latestTime}`);
        }
        console.log();

        if (connectors.length > 0) {
          console.log('Connectors:');
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
            });
            return;
          }

          console.log('proofscan Status');
          console.log('═════════════════════════════════════════════════════');
          console.log();
          console.log('Configuration:');
          console.log(`  Config file:  ${manager.getConfigPath()}`);
          console.log(`  Data dir:     ${manager.getConfigDir()}`);
          console.log();
          console.log('Database:');
          console.log(`  events.db:    ${dbPaths.events}`);
          console.log(`                ${formatBytes(dbSizes.events)} (version: ${diagnostic.userVersion ?? 'N/A'})`);
          console.log(`  proofs.db:    ${dbPaths.proofs}`);
          console.log(`                ${formatBytes(dbSizes.proofs)}`);
          console.log();
          console.log('No data yet. Initialize and run a scan:');
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
