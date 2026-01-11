/**
 * Archive commands - plan and run cleanup based on retention settings
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventsStore, getDbSizes } from '../db/index.js';
import { ProofsStore } from '../db/proofs-store.js';
import { output, outputSuccess, outputError, outputTable, getOutputOptions } from '../utils/output.js';
import type { RetentionConfig } from '../types/config.js';
import type { PruneCandidate, ArchivePlan } from '../db/types.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function computeArchivePlan(
  eventsStore: EventsStore,
  proofsStore: ProofsStore,
  retention: RetentionConfig,
  configDir: string
): Promise<ArchivePlan> {
  const protectedIds = new Set(proofsStore.getProtectedSessionIds());
  const sessionsToDelete: PruneCandidate[] = [];

  // 1. Get sessions exceeding keep_last_sessions
  if (retention.keep_last_sessions !== undefined) {
    const candidates = eventsStore.getPruneCandidates({
      keepLast: retention.keep_last_sessions,
    });
    for (const c of candidates) {
      if (!protectedIds.has(c.session_id)) {
        sessionsToDelete.push(c);
      }
    }
  }

  // 2. Count raw_json that can be cleared based on raw_days
  let rawJsonToClear = 0;
  if (retention.raw_days !== undefined) {
    rawJsonToClear = eventsStore.countClearableRawJson(retention.raw_days);
  }

  // 3. Check max_db_mb (simple heuristic)
  // Note: currentSizeMb and maxMb used for future size-based pruning
  getDbSizes(configDir); // Ensure DB access works

  // Estimate savings (rough: each event ~500 bytes raw_json)
  const estimatedSavingsMb = (
    sessionsToDelete.reduce((sum, s) => sum + s.event_count * 500, 0) +
    (rawJsonToClear * 300)
  ) / (1024 * 1024);

  return {
    sessions_to_delete: sessionsToDelete,
    raw_json_to_clear: rawJsonToClear,
    estimated_savings_mb: estimatedSavingsMb,
  };
}

/**
 * Show archive status and plan (default action)
 */
async function showStatusAndPlan(getConfigPath: () => string): Promise<void> {
  try {
    const manager = new ConfigManager(getConfigPath());
    const config = await manager.load();
    const eventsStore = new EventsStore(manager.getConfigDir());
    const proofsStore = new ProofsStore(manager.getConfigDir());

    // Get retention settings with defaults
    const retention: RetentionConfig = {
      keep_last_sessions: config.retention?.keep_last_sessions ?? 50,
      raw_days: config.retention?.raw_days ?? 7,
      max_db_mb: config.retention?.max_db_mb ?? 500,
    };

    const plan = await computeArchivePlan(eventsStore, proofsStore, retention, manager.getConfigDir());
    const dbSizes = getDbSizes(manager.getConfigDir());

    // Get current data stats
    const sessions = eventsStore.getAllSessions();
    const protectedIds = proofsStore.getProtectedSessionIds();

    if (getOutputOptions().json) {
      output({
        database: {
          events_db_size: dbSizes.events,
          proofs_db_size: dbSizes.proofs,
        },
        current_data: {
          total_sessions: sessions.length,
          protected_sessions: protectedIds.length,
        },
        retention,
        plan,
      });
    } else {
      console.log('Archive Status & Plan');
      console.log('=====================\n');

      console.log('Database:');
      console.log(`  events.db:   ${formatBytes(dbSizes.events)}`);
      console.log(`  proofs.db:   ${formatBytes(dbSizes.proofs)}`);
      console.log();

      console.log('Current Data:');
      console.log(`  Sessions:    ${sessions.length} (${protectedIds.length} protected)`);
      console.log();

      console.log('Retention Settings:');
      console.log(`  keep_last_sessions: ${retention.keep_last_sessions}`);
      console.log(`  raw_days: ${retention.raw_days}`);
      console.log(`  max_db_mb: ${retention.max_db_mb}`);
      console.log();

      console.log('Cleanup Plan:');

      if (plan.sessions_to_delete.length > 0) {
        console.log(`  Sessions to delete:  ${plan.sessions_to_delete.length}`);
        const headers = ['Session ID', 'Connector', 'Events', 'Reason'];
        const rows = plan.sessions_to_delete.slice(0, 5).map(s => [
          s.session_id.slice(0, 8) + '...',
          s.connector_id,
          String(s.event_count),
          s.reason,
        ]);
        outputTable(headers, rows);
        if (plan.sessions_to_delete.length > 5) {
          console.log(`  ... and ${plan.sessions_to_delete.length - 5} more`);
        }
      } else {
        console.log('  Sessions to delete:  0 (within limit)');
      }

      console.log(`  raw_json to clear:   ${plan.raw_json_to_clear} events (older than ${retention.raw_days} days)`);
      console.log(`  Estimated savings:   ~${plan.estimated_savings_mb.toFixed(1)} MB`);
      console.log('\nRun "pfscan archive run --yes" to execute.');
    }
  } catch (error) {
    outputError('Failed to compute archive plan', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

export function createArchiveCommand(getConfigPath: () => string): Command {
  const cmd = new Command('archive')
    .description('Manage data retention and cleanup')
    .addHelpText('after', `
Examples:
  pfscan archive              # Show status and cleanup plan
  pfscan archive run          # Dry run (show what would be done)
  pfscan archive run --yes    # Execute cleanup
`)
    .action(async () => {
      // Default action: show status and plan
      await showStatusAndPlan(getConfigPath);
    });

  cmd
    .command('run')
    .description('Execute archive cleanup')
    .option('--yes', 'Actually execute (without this, only shows what would be done)')
    .option('--vacuum', 'Run VACUUM after cleanup to reclaim space')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const config = await manager.load();
        const eventsStore = new EventsStore(manager.getConfigDir());
        const proofsStore = new ProofsStore(manager.getConfigDir());

        // Get retention settings with defaults
        const retention: RetentionConfig = {
          keep_last_sessions: config.retention?.keep_last_sessions ?? 50,
          raw_days: config.retention?.raw_days ?? 7,
          max_db_mb: config.retention?.max_db_mb ?? 500,
        };

        const plan = await computeArchivePlan(eventsStore, proofsStore, retention, manager.getConfigDir());

        if (!options.yes) {
          // Dry run - same as plan
          const dbSizes = getDbSizes(manager.getConfigDir());

          if (getOutputOptions().json) {
            output({
              dry_run: true,
              retention,
              plan,
              current_db_size_mb: dbSizes.events / (1024 * 1024),
            });
          } else {
            console.log('Archive Run (DRY RUN)');
            console.log('=====================\n');

            console.log(`Sessions to delete: ${plan.sessions_to_delete.length}`);
            console.log(`raw_json to clear: ${plan.raw_json_to_clear} events`);
            console.log(`Estimated savings: ~${plan.estimated_savings_mb.toFixed(1)} MB`);
            console.log('\nRun with --yes to actually execute.');
          }
          return;
        }

        // Actually execute
        const results = {
          sessions_deleted: 0,
          raw_json_cleared: 0,
          vacuumed: false,
        };

        // 1. Delete sessions
        if (plan.sessions_to_delete.length > 0) {
          const sessionIds = plan.sessions_to_delete.map(s => s.session_id);
          results.sessions_deleted = eventsStore.deleteSessions(sessionIds);
        }

        // 2. Clear raw_json
        if (plan.raw_json_to_clear > 0 && retention.raw_days !== undefined) {
          results.raw_json_cleared = eventsStore.clearRawJson({
            beforeDays: retention.raw_days,
          });
        }

        // 3. Vacuum if requested
        if (options.vacuum) {
          eventsStore.vacuum();
          results.vacuumed = true;
        }

        const dbSizes = getDbSizes(manager.getConfigDir());

        if (getOutputOptions().json) {
          output({
            success: true,
            results,
            final_db_size_mb: dbSizes.events / (1024 * 1024),
          });
        } else {
          console.log('Archive Run Complete');
          console.log('====================\n');

          console.log(`Sessions deleted: ${results.sessions_deleted}`);
          console.log(`raw_json cleared: ${results.raw_json_cleared} events`);
          if (results.vacuumed) {
            console.log('Database vacuumed');
          }
          console.log(`\nFinal events.db size: ${formatBytes(dbSizes.events)}`);

          outputSuccess('Archive complete');
        }
      } catch (error) {
        outputError('Failed to run archive', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
