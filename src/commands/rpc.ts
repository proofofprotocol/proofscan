/**
 * RPC command - View RPC call details
 *
 * pfscan rpc list [--session <sid>] [--latest]  # List RPC calls
 * pfscan rpc show [--session <sid>] --id <rpc_id>  # Show RPC details
 *
 * Session resolution priority:
 * 1. --session <id> if specified
 * 2. --latest flag
 * 3. Current session from state file
 */

import { Command } from 'commander';
import * as path from 'path';
import { ConfigManager } from '../config/index.js';
import { getEventsDb } from '../db/connection.js';
import {
  formatTimestamp,
  formatBytes,
  shortenId,
} from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  resolveSession,
  isSessionError,
  formatSessionError,
} from '../utils/session-resolver.js';
import { redactDeep } from '../secrets/redaction.js';
import { t } from '../i18n/index.js';
import {
  DEFAULT_EMBED_MAX_BYTES,
  toRpcStatus,
  createPayloadData,
  getRpcHtmlFilename,
  getSpillFilename,
  generateRpcHtml,
  openInBrowser,
  getPackageVersion,
  validateOutputPath,
  validateEmbedMaxBytes,
  ensureOutputDir,
  safeWriteFile,
} from '../html/index.js';
import type { HtmlRpcReportV1 } from '../html/index.js';
import type { RpcCall, Event } from '../db/types.js';

interface RpcListItem {
  rpc_id: string;
  method: string;
  status: 'OK' | 'ERR' | 'pending';
  latency_ms: number | null;
  request_ts: string;
  response_ts: string | null;
  error_code: number | null;
}

interface RpcDetail {
  rpc_id: string;
  session_id: string;
  connector_id: string;
  method: string;
  status: 'OK' | 'ERR' | 'pending';
  latency_ms: number | null;
  request_size: number | null;
  response_size: number | null;
  error_code: number | null;
  request_ts: string;
  response_ts: string | null;
  request_json: unknown | null;
  response_json: unknown | null;
  // Raw JSON strings for HTML export (needed for size calculation and spill)
  request_raw?: string | null;
  response_raw?: string | null;
}

/**
 * Get RPC calls for a session with computed fields
 */
function getRpcList(configDir: string, sessionId: string): RpcListItem[] {
  const db = getEventsDb(configDir);

  const rpcs = db.prepare(`
    SELECT * FROM rpc_calls
    WHERE session_id = ?
    ORDER BY request_ts DESC
  `).all(sessionId) as RpcCall[];

  return rpcs.map(rpc => {
    let latency_ms: number | null = null;
    if (rpc.response_ts) {
      latency_ms = new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime();
    }

    let status: 'OK' | 'ERR' | 'pending';
    if (rpc.success === 1) {
      status = 'OK';
    } else if (rpc.success === 0) {
      status = 'ERR';
    } else {
      status = 'pending';
    }

    return {
      rpc_id: rpc.rpc_id,
      method: rpc.method,
      status,
      latency_ms,
      request_ts: rpc.request_ts,
      response_ts: rpc.response_ts,
      error_code: rpc.error_code,
    };
  });
}

/**
 * Get detailed RPC information including request/response JSON
 */
function getRpcDetail(configDir: string, sessionId: string, rpcId: string): RpcDetail | null {
  const db = getEventsDb(configDir);

  // Find the session
  const session = db.prepare(`
    SELECT session_id, connector_id FROM sessions
    WHERE session_id = ?
    LIMIT 1
  `).get(sessionId) as { session_id: string; connector_id: string } | undefined;

  if (!session) {
    return null;
  }

  // Get the RPC call
  const rpc = db.prepare(`
    SELECT * FROM rpc_calls
    WHERE session_id = ? AND rpc_id = ?
  `).get(session.session_id, rpcId) as RpcCall | undefined;

  if (!rpc) {
    return null;
  }

  // Get request and response events
  const requestEvent = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'request'
  `).get(session.session_id, rpcId) as Event | undefined;

  const responseEvent = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
  `).get(session.session_id, rpcId) as Event | undefined;

  // Parse JSON
  let requestJson: unknown = null;
  let responseJson: unknown = null;

  if (requestEvent?.raw_json) {
    try {
      requestJson = JSON.parse(requestEvent.raw_json);
    } catch {
      requestJson = requestEvent.raw_json;
    }
  }

  if (responseEvent?.raw_json) {
    try {
      responseJson = JSON.parse(responseEvent.raw_json);
    } catch {
      responseJson = responseEvent.raw_json;
    }
  }

  // Calculate sizes
  const requestSize = requestEvent?.raw_json ? Buffer.byteLength(requestEvent.raw_json, 'utf8') : null;
  const responseSize = responseEvent?.raw_json ? Buffer.byteLength(responseEvent.raw_json, 'utf8') : null;

  // Calculate latency
  let latency_ms: number | null = null;
  if (rpc.response_ts) {
    latency_ms = new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime();
  }

  // Determine status
  let status: 'OK' | 'ERR' | 'pending';
  if (rpc.success === 1) {
    status = 'OK';
  } else if (rpc.success === 0) {
    status = 'ERR';
  } else {
    status = 'pending';
  }

  return {
    rpc_id: rpc.rpc_id,
    session_id: session.session_id,
    connector_id: session.connector_id,
    method: rpc.method,
    status,
    latency_ms,
    request_size: requestSize,
    response_size: responseSize,
    error_code: rpc.error_code,
    request_ts: rpc.request_ts,
    response_ts: rpc.response_ts,
    request_json: requestJson,
    response_json: responseJson,
    request_raw: requestEvent?.raw_json ?? null,
    response_raw: responseEvent?.raw_json ?? null,
  };
}

/**
 * Render RPC list item for terminal
 */
function renderRpcListItem(item: RpcListItem, options: { fulltime?: boolean }): string {
  const ts = formatTimestamp(new Date(item.request_ts).getTime(), options.fulltime);
  const statusSymbol = item.status === 'OK' ? '✓' : item.status === 'ERR' ? '✗' : '?';

  const parts: string[] = [
    ts,
    statusSymbol,
    item.rpc_id.slice(0, 8).padEnd(8),
    item.method.slice(0, 30).padEnd(30),
  ];

  if (item.latency_ms !== null) {
    parts.push(`${item.latency_ms}ms`);
  } else {
    parts.push('(pending)');
  }

  if (item.error_code !== null) {
    parts.push(`err=${item.error_code}`);
  }

  return parts.join(' ');
}

/**
 * Render RPC detail for terminal
 */
function renderRpcDetail(detail: RpcDetail): void {
  console.log('═'.repeat(60));
  console.log(`RPC: ${detail.method}`);
  console.log('═'.repeat(60));
  console.log();

  // Basic info
  console.log('Info:');
  console.log(`  RPC ID:      ${detail.rpc_id}`);
  console.log(`  Session:     ${shortenId(detail.session_id, 12)}...`);
  console.log(`  Connector:   ${detail.connector_id}`);
  console.log(`  Status:      ${detail.status}${detail.error_code !== null ? ` (code: ${detail.error_code})` : ''}`);
  console.log();

  // Timing
  console.log('Timing:');
  console.log(`  Request:     ${detail.request_ts}`);
  if (detail.response_ts) {
    console.log(`  Response:    ${detail.response_ts}`);
  }
  if (detail.latency_ms !== null) {
    console.log(`  Latency:     ${detail.latency_ms}ms`);
  }
  console.log();

  // Size
  console.log('Size:');
  if (detail.request_size !== null) {
    console.log(`  Request:     ${formatBytes(detail.request_size)}`);
  }
  if (detail.response_size !== null) {
    console.log(`  Response:    ${formatBytes(detail.response_size)}`);
  }
  console.log();

  // Request JSON
  console.log('─'.repeat(60));
  console.log('Request:');
  console.log('─'.repeat(60));
  if (detail.request_json) {
    console.log(JSON.stringify(detail.request_json, null, 2));
  } else {
    console.log('  (no request data)');
  }
  console.log();

  // Response JSON
  console.log('─'.repeat(60));
  console.log('Response:');
  console.log('─'.repeat(60));
  if (detail.response_json) {
    console.log(JSON.stringify(detail.response_json, null, 2));
  } else {
    console.log('  (no response data)');
  }
}

/**
 * Export RPC detail as HTML file
 */
async function exportRpcHtml(
  detail: RpcDetail,
  options: {
    outDir: string;
    open: boolean;
    redact: boolean;
    embedMaxBytes: number;
    spill: boolean;
  }
): Promise<void> {
  console.log(t('html.exporting'));

  // Validate and create output directory
  const validatedOutDir = validateOutputPath(options.outDir);
  ensureOutputDir(validatedOutDir);

  // Apply redaction if requested
  let requestJson = detail.request_json;
  let responseJson = detail.response_json;
  let requestRaw = detail.request_raw ?? null;
  let responseRaw = detail.response_raw ?? null;

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
    console.log(t('html.redactedNote'));
  }

  // Handle spill files for oversized payloads
  let requestSpillFile: string | undefined;
  let responseSpillFile: string | undefined;

  const requestSize = requestRaw ? Buffer.byteLength(requestRaw, 'utf8') : 0;
  const responseSize = responseRaw ? Buffer.byteLength(responseRaw, 'utf8') : 0;

  if (options.spill) {
    if (requestSize > options.embedMaxBytes && requestRaw) {
      requestSpillFile = getSpillFilename(detail.session_id, detail.rpc_id, 'req');
      const spillPath = path.join(validatedOutDir, requestSpillFile);
      safeWriteFile(spillPath, requestRaw);
      console.log(t('html.spillFileWritten', { file: requestSpillFile }));
    }
    if (responseSize > options.embedMaxBytes && responseRaw) {
      responseSpillFile = getSpillFilename(detail.session_id, detail.rpc_id, 'res');
      const spillPath = path.join(validatedOutDir, responseSpillFile);
      safeWriteFile(spillPath, responseRaw);
      console.log(t('html.spillFileWritten', { file: responseSpillFile }));
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

  // Build report
  const report: HtmlRpcReportV1 = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${getPackageVersion()}`,
      redacted: options.redact,
    },
    rpc: {
      rpc_id: detail.rpc_id,
      session_id: detail.session_id,
      connector_id: detail.connector_id,
      method: detail.method,
      status: toRpcStatus(detail.status === 'OK' ? 1 : detail.status === 'ERR' ? 0 : null),
      latency_ms: detail.latency_ms,
      error_code: detail.error_code,
      request_ts: detail.request_ts,
      response_ts: detail.response_ts,
      request: requestPayload,
      response: responsePayload,
    },
  };

  // Generate and write HTML
  const html = generateRpcHtml(report);
  const filename = getRpcHtmlFilename(detail.rpc_id);
  const outputPath = path.join(validatedOutDir, filename);
  safeWriteFile(outputPath, html);

  console.log(t('html.exported', { path: outputPath }));

  // Open in browser if requested
  if (options.open) {
    console.log(t('html.opening'));
    try {
      await openInBrowser(outputPath);
    } catch {
      console.error(t('errors.openBrowserFailed', { path: outputPath }));
    }
  }
}

export function createRpcCommand(getConfigPath: () => string): Command {
  const cmd = new Command('rpc')
    .description('View RPC call details');

  // rpc ls [--session <sid>] [--latest] [--connector <id>]
  const listAction = async (options: {
    session?: string;
    latest?: boolean;
    connector?: string;
    fulltime?: boolean;
    limit: string;
  }) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        // Resolve session
        const result = resolveSession({
          sessionId: options.session,
          latest: options.latest,
          connectorId: options.connector,
          configDir,
        });

        if (isSessionError(result)) {
          console.error(formatSessionError(result));
          process.exit(1);
        }

        const rpcs = getRpcList(configDir, result.sessionId);

        if (rpcs.length === 0) {
          console.log(`No RPC calls found for session ${shortenId(result.sessionId, 8)}...`);
          console.log(`(resolved by: ${result.resolvedBy})`);
          return;
        }

        // Limit results
        const limitedRpcs = rpcs.slice(0, parseInt(options.limit, 10));

        if (getOutputOptions().json) {
          output(limitedRpcs);
          return;
        }

        // Print session info
        console.log(`Session: ${shortenId(result.sessionId, 12)}... (${result.resolvedBy})`);
        console.log();

        // Print header
        const header = options.fulltime
          ? 'Time                    St RPC      Method                         Latency'
          : 'Time         St RPC      Method                         Latency';
        console.log(header);
        console.log('-'.repeat(header.length));

        // Print items
        for (const item of limitedRpcs) {
          console.log(renderRpcListItem(item, { fulltime: options.fulltime }));
        }

        // Summary
        console.log();
        const okCount = limitedRpcs.filter(r => r.status === 'OK').length;
        const errCount = limitedRpcs.filter(r => r.status === 'ERR').length;
        const pendingCount = limitedRpcs.filter(r => r.status === 'pending').length;
        console.log(`${limitedRpcs.length} RPCs: ${okCount} OK, ${errCount} ERR, ${pendingCount} pending`);
        console.log();
        console.log('hint: Use `pfscan rpc show --id <rpc>` for details');

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
  };

  cmd
    .command('ls')
    .description('List RPC calls for a session')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .option('--fulltime', 'Show full timestamp')
    .option('--limit <n>', 'Number of RPCs to show', '20')
    .action(listAction);

  cmd
    .command('list')
    .description('Alias for ls')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .option('--fulltime', 'Show full timestamp')
    .option('--limit <n>', 'Number of RPCs to show', '20')
    .action(listAction);

  // rpc show [--session <sid>] --id <rpc_id> [--html] [--out <dir>] [--open] [--redact] [--embed-max-bytes <n>] [--spill]
  cmd
    .command('show')
    .description('Show RPC call details with request/response JSON')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .requiredOption('--id <rpc_id>', 'RPC ID')
    .option('--html', 'Export as standalone HTML file')
    .option('--out <dir>', 'Output directory for HTML', './pfscan_reports')
    .option('--open', 'Open HTML in default browser')
    .option('--redact', 'Redact sensitive values')
    .option('--embed-max-bytes <n>', 'Max bytes per payload before truncation', String(DEFAULT_EMBED_MAX_BYTES))
    .option('--spill', 'Write oversized payloads to separate files')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        // Resolve session
        const result = resolveSession({
          sessionId: options.session,
          latest: options.latest,
          connectorId: options.connector,
          configDir,
        });

        if (isSessionError(result)) {
          console.error(formatSessionError(result));
          process.exit(1);
        }

        const detail = getRpcDetail(configDir, result.sessionId, options.id);

        if (!detail) {
          console.log('RPC call not found.');
          console.log(`Session: ${shortenId(result.sessionId, 8)}... (${result.resolvedBy})`);
          console.log('hint: Use `pfscan rpc list` to see available RPCs');
          return;
        }

        // HTML export mode
        if (options.html) {
          const embedMaxBytes = validateEmbedMaxBytes(options.embedMaxBytes);
          await exportRpcHtml(detail, {
            outDir: options.out,
            open: options.open,
            redact: options.redact,
            embedMaxBytes,
            spill: options.spill,
          });
          return;
        }

        if (getOutputOptions().json) {
          output(detail);
          return;
        }

        renderRpcDetail(detail);

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
    });

  return cmd;
}
