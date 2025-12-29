/**
 * Sessions commands - list, show, prune
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventsStore } from '../db/events-store.js';
import { ProofsStore } from '../db/proofs-store.js';
import { output, outputSuccess, outputError, outputTable, getOutputOptions } from '../utils/output.js';
import type { SessionWithStats, PruneCandidate } from '../db/types.js';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'running';
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function createSessionsCommand(getConfigPath: () => string): Command {
  const cmd = new Command('sessions')
    .description('Manage scan sessions');

  cmd
    .command('list')
    .description('List all sessions')
    .option('--connector <id>', 'Filter by connector ID')
    .option('--last <n>', 'Limit to last N sessions', '20')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const eventsStore = new EventsStore(manager.getConfigDir());
        const limit = parseInt(options.last, 10);

        let sessions: SessionWithStats[];
        if (options.connector) {
          sessions = eventsStore.getSessionsByConnector(options.connector, limit);
        } else {
          sessions = eventsStore.getAllSessions(limit);
        }

        if (sessions.length === 0) {
          output({ sessions: [] }, 'No sessions found.');
          return;
        }

        if (getOutputOptions().json) {
          output(sessions);
        } else {
          const headers = ['Session ID', 'Connector', 'Started', 'Duration', 'Status', 'Events', 'Protected'];
          const rows = sessions.map(s => [
            s.session_id.slice(0, 8) + '...',
            s.connector_id,
            formatDate(s.started_at).split(',')[0], // Date only
            formatDuration(s.started_at, s.ended_at),
            s.exit_reason || 'running',
            String(s.event_count || 0),
            s.protected ? 'yes' : 'no',
          ]);
          outputTable(headers, rows);
        }
      } catch (error) {
        outputError('Failed to list sessions', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show session details')
    .requiredOption('--id <session_id>', 'Session ID (can be partial)')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const eventsStore = new EventsStore(manager.getConfigDir());
        const proofsStore = new ProofsStore(manager.getConfigDir());

        // Try to find session by partial ID
        const allSessions = eventsStore.getAllSessions();
        const session = allSessions.find(s =>
          s.session_id === options.id || s.session_id.startsWith(options.id)
        );

        if (!session) {
          outputError(`Session not found: ${options.id}`);
          process.exit(1);
        }

        const events = eventsStore.getEventsBySession(session.session_id);
        const rpcCalls = eventsStore.getRpcCallsBySession(session.session_id);
        const proofs = proofsStore.getProofsBySession(session.session_id);

        const result = {
          ...session,
          events,
          rpc_calls: rpcCalls,
          proofs,
        };

        if (getOutputOptions().json) {
          output(result);
        } else {
          console.log(`Session: ${session.session_id}`);
          console.log(`Connector: ${session.connector_id}`);
          console.log(`Started: ${formatDate(session.started_at)}`);
          console.log(`Ended: ${formatDate(session.ended_at)}`);
          console.log(`Duration: ${formatDuration(session.started_at, session.ended_at)}`);
          console.log(`Status: ${session.exit_reason || 'running'}`);
          console.log(`Protected: ${session.protected ? 'yes' : 'no'}`);
          console.log(`Events: ${events.length}`);
          console.log(`RPC Calls: ${rpcCalls.length}`);
          console.log(`Proofs: ${proofs.length}`);

          if (rpcCalls.length > 0) {
            console.log('\nRPC Calls:');
            for (const rpc of rpcCalls) {
              const status = rpc.success === 1 ? '✓' : rpc.success === 0 ? '✗' : '?';
              console.log(`  ${status} ${rpc.method} (id: ${rpc.rpc_id})`);
            }
          }
        }
      } catch (error) {
        outputError('Failed to show session', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('prune')
    .description('Delete old sessions (dry-run by default)')
    .option('--keep-last <n>', 'Keep last N sessions per connector')
    .option('--before <date>', 'Delete sessions before date (YYYY-MM-DD)')
    .option('--connector <id>', 'Only prune specific connector')
    .option('--yes', 'Actually delete (without this, only shows what would be deleted)')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const eventsStore = new EventsStore(manager.getConfigDir());
        const proofsStore = new ProofsStore(manager.getConfigDir());

        // Get protected session IDs from proofs
        const protectedIds = new Set(proofsStore.getProtectedSessionIds());

        // Build prune options
        const pruneOpts: {
          keepLast?: number;
          before?: string;
          connectorId?: string;
        } = {};

        if (options.keepLast) {
          pruneOpts.keepLast = parseInt(options.keepLast, 10);
        }
        if (options.before) {
          pruneOpts.before = new Date(options.before).toISOString();
        }
        if (options.connector) {
          pruneOpts.connectorId = options.connector;
        }

        // Get candidates
        let candidates = eventsStore.getPruneCandidates(pruneOpts);

        // Filter out protected sessions
        const originalCount = candidates.length;
        candidates = candidates.filter(c => !protectedIds.has(c.session_id));

        if (candidates.length === 0) {
          output({ candidates: [], protected_count: originalCount - candidates.length },
            'No sessions to prune.');
          return;
        }

        const totalEvents = candidates.reduce((sum, c) => sum + c.event_count, 0);

        if (getOutputOptions().json) {
          output({
            dry_run: !options.yes,
            candidates,
            total_sessions: candidates.length,
            total_events: totalEvents,
            protected_skipped: originalCount - candidates.length,
          });
        } else {
          console.log(`${options.yes ? 'Pruning' : 'Would prune'} ${candidates.length} session(s):`);
          console.log();

          const headers = ['Session ID', 'Connector', 'Started', 'Events', 'Reason'];
          const rows = candidates.map(c => [
            c.session_id.slice(0, 8) + '...',
            c.connector_id,
            formatDate(c.started_at).split(',')[0],
            String(c.event_count),
            c.reason,
          ]);
          outputTable(headers, rows);

          console.log();
          console.log(`Total: ${candidates.length} sessions, ${totalEvents} events`);
          if (originalCount > candidates.length) {
            console.log(`Skipped ${originalCount - candidates.length} protected session(s)`);
          }
        }

        if (options.yes) {
          const sessionIds = candidates.map(c => c.session_id);
          const deleted = eventsStore.deleteSessions(sessionIds);
          outputSuccess(`Deleted ${deleted} session(s)`);
        } else if (!getOutputOptions().json) {
          console.log('\nRun with --yes to actually delete.');
        }
      } catch (error) {
        outputError('Failed to prune sessions', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
