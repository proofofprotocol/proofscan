/**
 * Sessions commands - list, show, prune
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config/index.js';
import { EventsStore } from '../db/events-store.js';
import { ProofsStore } from '../db/proofs-store.js';
import { getEventsDb } from '../db/connection.js';
import { output, outputSuccess, outputError, outputTable, getOutputOptions } from '../utils/output.js';
import { redactDeep } from '../secrets/redaction.js';
import { t } from '../i18n/index.js';
import {
  DEFAULT_EMBED_MAX_BYTES,
  toRpcStatus,
  createPayloadData,
  getSessionHtmlFilename,
  getSpillFilename,
  generateSessionHtml,
  openInBrowser,
} from '../html/index.js';
import type { HtmlSessionReportV1, SessionRpcDetail } from '../html/index.js';
import type { SessionWithStats, RpcCall, Event } from '../db/types.js';

// Get package version for HTML reports
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let packageVersion = '0.0.0';
try {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  packageVersion = pkg.version || '0.0.0';
} catch {
  // Fallback version
}

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

/**
 * Get RPC event data for HTML export
 */
function getRpcEventData(
  configDir: string,
  sessionId: string,
  rpcId: string
): { requestRaw: string | null; responseRaw: string | null; requestJson: unknown; responseJson: unknown } {
  const db = getEventsDb(configDir);

  const requestEvent = db.prepare(`
    SELECT raw_json FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'request'
  `).get(sessionId, rpcId) as { raw_json: string | null } | undefined;

  const responseEvent = db.prepare(`
    SELECT raw_json FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
  `).get(sessionId, rpcId) as { raw_json: string | null } | undefined;

  const requestRaw = requestEvent?.raw_json ?? null;
  const responseRaw = responseEvent?.raw_json ?? null;

  let requestJson: unknown = null;
  let responseJson: unknown = null;

  if (requestRaw) {
    try {
      requestJson = JSON.parse(requestRaw);
    } catch {
      requestJson = requestRaw;
    }
  }

  if (responseRaw) {
    try {
      responseJson = JSON.parse(responseRaw);
    } catch {
      responseJson = responseRaw;
    }
  }

  return { requestRaw, responseRaw, requestJson, responseJson };
}

/**
 * Export session as HTML file
 */
async function exportSessionHtml(
  session: SessionWithStats,
  rpcCalls: RpcCall[],
  eventCount: number,
  configDir: string,
  options: {
    outDir: string;
    open: boolean;
    redact: boolean;
    embedMaxBytes: number;
    spill: boolean;
  }
): Promise<void> {
  console.log(t('html.exporting'));

  // Create output directory if needed
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  // Build RPC details with payloads
  const rpcs: SessionRpcDetail[] = [];

  for (const rpc of rpcCalls) {
    let { requestRaw, responseRaw, requestJson, responseJson } = getRpcEventData(
      configDir,
      session.session_id,
      rpc.rpc_id
    );

    // Apply redaction if requested
    if (options.redact) {
      if (requestJson) {
        const result = redactDeep(requestJson);
        requestJson = result.value;
        requestRaw = requestJson ? JSON.stringify(requestJson) : null;
      }
      if (responseJson) {
        const result = redactDeep(responseJson);
        responseJson = result.value;
        responseRaw = responseJson ? JSON.stringify(responseJson) : null;
      }
    }

    // Handle spill files for oversized payloads
    let requestSpillFile: string | undefined;
    let responseSpillFile: string | undefined;

    const requestSize = requestRaw ? Buffer.byteLength(requestRaw, 'utf8') : 0;
    const responseSize = responseRaw ? Buffer.byteLength(responseRaw, 'utf8') : 0;

    if (options.spill) {
      if (requestSize > options.embedMaxBytes && requestRaw) {
        requestSpillFile = getSpillFilename(session.session_id, rpc.rpc_id, 'req');
        const spillPath = path.join(options.outDir, requestSpillFile);
        fs.writeFileSync(spillPath, requestRaw, 'utf8');
      }
      if (responseSize > options.embedMaxBytes && responseRaw) {
        responseSpillFile = getSpillFilename(session.session_id, rpc.rpc_id, 'res');
        const spillPath = path.join(options.outDir, responseSpillFile);
        fs.writeFileSync(spillPath, responseRaw, 'utf8');
      }
    }

    // Create payload data with truncation handling
    const requestPayload = createPayloadData(
      requestJson,
      requestRaw,
      options.embedMaxBytes,
      requestSpillFile
    );
    const responsePayload = createPayloadData(
      responseJson,
      responseRaw,
      options.embedMaxBytes,
      responseSpillFile
    );

    // Calculate latency
    let latency_ms: number | null = null;
    if (rpc.response_ts) {
      latency_ms = new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime();
    }

    rpcs.push({
      rpc_id: rpc.rpc_id,
      method: rpc.method,
      status: toRpcStatus(rpc.success),
      latency_ms,
      request_ts: rpc.request_ts,
      response_ts: rpc.response_ts,
      error_code: rpc.error_code,
      request: requestPayload,
      response: responsePayload,
    });
  }

  if (options.redact) {
    console.log(t('html.redactedNote'));
  }

  // Calculate total latency across all RPCs
  const totalLatencyMs = rpcs.reduce((sum, rpc) => {
    if (rpc.latency_ms !== null) {
      return sum + rpc.latency_ms;
    }
    return sum;
  }, 0);

  // Build report
  const report: HtmlSessionReportV1 = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${packageVersion}`,
      redacted: options.redact,
    },
    session: {
      session_id: session.session_id,
      connector_id: session.connector_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      exit_reason: session.exit_reason,
      rpc_count: rpcCalls.length,
      event_count: eventCount,
      total_latency_ms: rpcs.length > 0 ? totalLatencyMs : null,
    },
    rpcs,
  };

  // Generate and write HTML
  const html = generateSessionHtml(report);
  const filename = getSessionHtmlFilename(session.session_id);
  const outputPath = path.join(options.outDir, filename);
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(t('html.exported', { path: outputPath }));

  // Count spill files
  const spillCount = rpcs.filter(r => r.request.spillFile || r.response.spillFile).length;
  if (spillCount > 0) {
    console.log(`  (${spillCount} RPC(s) with spill files)`);
  }

  // Open in browser if requested
  if (options.open) {
    console.log(t('html.opening'));
    try {
      await openInBrowser(outputPath);
    } catch (error) {
      console.error('Failed to open browser:', error);
    }
  }
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
    .option('--html', 'Export as standalone HTML file')
    .option('--out <dir>', 'Output directory for HTML', './pfscan_reports')
    .option('--open', 'Open HTML in default browser')
    .option('--redact', 'Redact sensitive values')
    .option('--embed-max-bytes <n>', 'Max bytes per payload before truncation', String(DEFAULT_EMBED_MAX_BYTES))
    .option('--spill', 'Write oversized payloads to separate files')
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

        // HTML export mode
        if (options.html) {
          await exportSessionHtml(session, rpcCalls, events.length, manager.getConfigDir(), {
            outDir: options.out,
            open: options.open,
            redact: options.redact,
            embedMaxBytes: parseInt(options.embedMaxBytes, 10),
            spill: options.spill,
          });
          return;
        }

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
