/**
 * Connectors commands
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ConfigManager, parseMcpServers, parseMcpServerById, readStdin } from '../config/index.js';
import type { Connector, StdioTransport } from '../types/index.js';
import { output, outputSuccess, outputError, outputTable, redactSecrets } from '../utils/output.js';
import { redactionSummary, redactDeep } from '../secrets/redaction.js';
import { EventsStore } from '../db/events-store.js';
import { getEventsDb } from '../db/connection.js';
import { t } from '../i18n/index.js';
import {
  DEFAULT_EMBED_MAX_BYTES,
  SHORT_ID_LENGTH,
  toRpcStatus,
  createPayloadData,
  getConnectorHtmlFilename,
  getSpillFilename,
  generateConnectorHtml,
  openInBrowser,
  getPackageVersion,
  validateOutputPath,
  validateEmbedMaxBytes,
  ensureOutputDir,
  safeWriteFile,
  computeConnectorAnalytics,
} from '../html/index.js';
import type {
  HtmlConnectorReportV1,
  HtmlConnectorInfo,
  HtmlMcpServerInfo,
  HtmlSessionReportV1,
  SessionRpcDetail,
} from '../html/index.js';
import type { SessionWithStats, RpcCall } from '../db/types.js';

// ============================================================================
// Connector HTML Export Helper Functions
// ============================================================================

/**
 * Get MCP server info from latest initialize response across ALL sessions
 * (not just latest session - handles cases where latest session has no initialize)
 */
function getMcpServerInfo(
  configDir: string,
  connectorId: string
): HtmlMcpServerInfo | null {
  const db = getEventsDb(configDir);

  // Query latest initialize response across all sessions for this connector
  const initResponse = db.prepare(`
    SELECT e.raw_json FROM events e
    JOIN rpc_calls r ON e.rpc_id = r.rpc_id AND e.session_id = r.session_id
    JOIN sessions s ON e.session_id = s.session_id
    WHERE s.connector_id = ?
      AND r.method = 'initialize'
      AND e.kind = 'response'
    ORDER BY e.ts DESC
    LIMIT 1
  `).get(connectorId) as { raw_json: string | null } | undefined;

  if (!initResponse?.raw_json) return null;

  try {
    const json = JSON.parse(initResponse.raw_json);
    const caps = json.result?.capabilities;
    return {
      name: json.result?.serverInfo?.name ?? null,
      version: json.result?.serverInfo?.version ?? null,
      protocolVersion: json.result?.protocolVersion ?? null,
      capabilities: {
        tools: caps?.tools !== undefined,
        resources: caps?.resources !== undefined,
        prompts: caps?.prompts !== undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Get session count for connector (separate COUNT query for efficiency)
 */
function getSessionCount(configDir: string, connectorId: string): number {
  const db = getEventsDb(configDir);
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM sessions WHERE connector_id = ?
  `).get(connectorId) as { count: number };
  return result.count;
}

/**
 * Get sessions with LIMIT/OFFSET at DB level (not slice())
 * Includes error_count for ERR badge in left pane
 */
function getSessionsWithPagination(
  configDir: string,
  connectorId: string,
  limit: number,
  offset: number
): Array<SessionWithStats & { error_count: number }> {
  const db = getEventsDb(configDir);
  return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
      (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count,
      (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id AND success = 0) as error_count
    FROM sessions s
    WHERE s.connector_id = ?
    ORDER BY s.started_at DESC
    LIMIT ? OFFSET ?
  `).all(connectorId, limit, offset) as Array<SessionWithStats & { error_count: number }>;
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
 * Build session report data for HTML export
 */
function buildSessionReport(
  session: SessionWithStats,
  rpcCalls: RpcCall[],
  eventCount: number,
  configDir: string,
  options: {
    redact: boolean;
    embedMaxBytes: number;
    spill: boolean;
    outDir: string;
  }
): { report: HtmlSessionReportV1; spillCount: number } {
  const rpcs: SessionRpcDetail[] = [];
  let spillCount = 0;

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
        safeWriteFile(spillPath, requestRaw);
        spillCount++;
      }
      if (responseSize > options.embedMaxBytes && responseRaw) {
        responseSpillFile = getSpillFilename(session.session_id, rpc.rpc_id, 'res');
        const spillPath = path.join(options.outDir, responseSpillFile);
        safeWriteFile(spillPath, responseRaw);
        spillCount++;
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

  // Calculate total latency across all RPCs
  const totalLatencyMs = rpcs.reduce((sum, rpc) => {
    if (rpc.latency_ms !== null) {
      return sum + rpc.latency_ms;
    }
    return sum;
  }, 0);

  const report: HtmlSessionReportV1 = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${getPackageVersion()}`,
      redacted: options.redact,
    },
    session: {
      session_id: session.session_id,
      target_id: session.target_id ?? session.connector_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      exit_reason: session.exit_reason,
      rpc_count: rpcCalls.length,
      event_count: eventCount,
      total_latency_ms: rpcs.length > 0 ? totalLatencyMs : null,
    },
    rpcs,
  };

  return { report, spillCount };
}

/**
 * Export connector as HTML file
 */
async function exportConnectorHtml(
  connectorId: string,
  connector: Connector | null,
  configDir: string,
  options: {
    outDir: string;
    open: boolean;
    redact: boolean;
    embedMaxBytes: number;
    spill: boolean;
    maxSessions: number;
    offset: number;
  }
): Promise<void> {
  // 1. Get total count (separate COUNT query - efficient)
  const totalSessionCount = getSessionCount(configDir, connectorId);

  // 2. Get sessions with LIMIT/OFFSET at DB level (NOT slice())
  const displayedSessions = getSessionsWithPagination(
    configDir,
    connectorId,
    options.maxSessions,
    options.offset
  );

  console.log(t('html.connectorExporting', { count: displayedSessions.length }));

  // Validate and create output directory
  const validatedOutDir = validateOutputPath(options.outDir);
  ensureOutputDir(validatedOutDir);

  // 3. Get connector config and server info
  const transportInfo: HtmlConnectorInfo['transport'] = connector ? {
    type: connector.transport.type,
    command: connector.transport.type === 'stdio'
      ? `${connector.transport.command}${(connector.transport as StdioTransport).args?.length ? ' ' + (connector.transport as StdioTransport).args!.join(' ') : ''}`
      : undefined,
    url: 'url' in connector.transport ? (connector.transport as { url: string }).url : undefined,
  } : { type: 'stdio' as const };

  // Get server info from latest initialize response (across ALL sessions)
  const serverInfo = getMcpServerInfo(configDir, connectorId);

  // 4. Build session reports
  const eventsStore = new EventsStore(configDir);
  const sessionReports: Record<string, HtmlSessionReportV1> = {};
  let totalSpillCount = 0;

  for (const session of displayedSessions) {
    const rpcCalls = eventsStore.getRpcCallsBySession(session.session_id);
    const { report, spillCount } = buildSessionReport(
      session,
      rpcCalls,
      session.event_count || 0,
      configDir,
      {
        redact: options.redact,
        embedMaxBytes: options.embedMaxBytes,
        spill: options.spill,
        outDir: validatedOutDir,
      }
    );
    sessionReports[session.session_id] = report;
    totalSpillCount += spillCount;
  }

  if (options.redact) {
    console.log(t('html.redactedNote'));
  }

  // 5. Compute analytics from session reports
  const analytics = computeConnectorAnalytics({
    sessionReports,
    sessionsTotal: totalSessionCount,
    sessionsDisplayed: displayedSessions.length,
  });

  // 6. Build connector report
  const report: HtmlConnectorReportV1 = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${getPackageVersion()}`,
      redacted: options.redact,
    },
    connector: {
      target_id: connectorId,
      enabled: connector?.enabled ?? true,
      transport: transportInfo,
      server: serverInfo ?? undefined,
      session_count: totalSessionCount,
      displayed_sessions: displayedSessions.length,
      offset: options.offset,
    },
    sessions: displayedSessions.map(s => ({
      session_id: s.session_id,
      short_id: s.session_id.slice(0, SHORT_ID_LENGTH),
      started_at: s.started_at,
      ended_at: s.ended_at,
      rpc_count: s.rpc_count ?? 0,
      event_count: s.event_count ?? 0,
      error_count: s.error_count,
      total_latency_ms: sessionReports[s.session_id]?.session.total_latency_ms ?? null,
    })),
    session_reports: sessionReports,
    analytics,
  };

  // 7. Generate and write HTML
  const html = generateConnectorHtml(report);
  const filename = getConnectorHtmlFilename(connectorId);
  const outputPath = path.join(validatedOutDir, filename);
  safeWriteFile(outputPath, html);

  console.log(t('html.connectorExported', { path: outputPath }));

  if (totalSpillCount > 0) {
    console.log(`  (${totalSpillCount} payload(s) written to spill files)`);
  }

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

// ============================================================================
// Connectors Command
// ============================================================================

export function createConnectorsCommand(getConfigPath: () => string): Command {
  const cmd = new Command('connectors')
    .description('Manage MCP server connectors');

  // List connectors action
  const listAction = async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connectors = await manager.getConnectors();

        if (connectors.length === 0) {
          output({ connectors: [] }, 'No connectors configured.');
          return;
        }

        const headers = ['ID', 'Enabled', 'Type', 'Command/URL'];
        const rows = connectors.map(c => {
          let target = '';
          if (c.transport.type === 'stdio') {
            const t = c.transport as StdioTransport;
            target = t.command + (t.args?.length ? ` ${t.args.join(' ')}` : '');
            if (target.length > 50) target = target.slice(0, 47) + '...';
          } else if ('url' in c.transport) {
            target = (c.transport as { url: string }).url;
          }
          return [c.id, c.enabled ? 'yes' : 'no', c.transport.type, target];
        });

        outputTable(headers, rows);
      } catch (error) {
        outputError('Failed to list connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
  };

  cmd
    .command('ls')
    .description('List all connectors')
    .action(listAction);

  cmd
    .command('list')
    .description('Alias for ls')
    .action(listAction);

  cmd
    .command('show')
    .description('Show connector details (secrets redacted)')
    .requiredOption('--id <id>', 'Connector ID')
    .option('--html', 'Export as standalone HTML file')
    .option('--out <dir>', 'Output directory for HTML', './pfscan_reports')
    .option('--open', 'Open HTML in default browser')
    .option('--redact', 'Redact sensitive values')
    .option('--embed-max-bytes <n>', 'Max bytes per payload before truncation', String(DEFAULT_EMBED_MAX_BYTES))
    .option('--spill', 'Write oversized payloads to separate files')
    .option('--max-sessions <n>', 'Max sessions to include in HTML', '50')
    .option('--offset <n>', 'Skip first N sessions (pagination)', '0')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connector = await manager.getConnector(options.id);

        // HTML export mode
        if (options.html) {
          const embedMaxBytes = validateEmbedMaxBytes(options.embedMaxBytes);
          const maxSessions = parseInt(options.maxSessions, 10);
          const offset = parseInt(options.offset, 10);

          // Validate numeric inputs
          if (isNaN(maxSessions) || maxSessions < 1) {
            outputError('--max-sessions must be a positive integer');
            process.exit(1);
          }
          if (isNaN(offset) || offset < 0) {
            outputError('--offset must be a non-negative integer');
            process.exit(1);
          }

          await exportConnectorHtml(options.id, connector, manager.getConfigDir(), {
            outDir: options.out,
            open: options.open,
            redact: options.redact,
            embedMaxBytes,
            spill: options.spill,
            maxSessions,
            offset,
          });
          return;
        }

        // Standard JSON/text output
        if (!connector) {
          outputError(`Connector not found: ${options.id}`);
          process.exit(1);
        }

        const redacted = redactSecrets(connector);
        if (redacted.count > 0) {
          console.log(redactionSummary(redacted.count));
          console.log();
        }
        output(redacted.value, JSON.stringify(redacted.value, null, 2));
      } catch (error) {
        outputError('Failed to show connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new connector')
    .argument('[id]', 'Connector ID')
    .option('--id <id>', 'Connector ID (alternative to positional argument)')
    .option('--stdio <cmdline>', 'Command line (command and args as single string)')
    .option('--from-mcp-json <json>', 'MCP server JSON (use "-" for stdin)')
    .option('--from-mcp-file <path>', 'Path to MCP config file (e.g., claude_desktop_config.json)')
    .option('--clip', 'Read MCP server JSON from clipboard')
    .action(async (idArg, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());

        // Validate conflicting ID options
        if (idArg && options.id && idArg !== options.id) {
          outputError('Cannot specify ID both as argument and --id option');
          process.exit(1);
        }
        const id = idArg || options.id;

        // Validate mutual exclusivity
        const inputModes = [options.fromMcpJson, options.fromMcpFile, options.clip].filter(Boolean);
        if (inputModes.length > 1) {
          outputError('Cannot use multiple input options (--from-mcp-json, --from-mcp-file, --clip)');
          process.exit(1);
        }

        // --clip mode: read from clipboard with secretize processing
        if (options.clip) {
          if (!id) {
            outputError('Connector ID required with --clip. Usage: connectors add <id> --clip');
            process.exit(1);
          }

          const { readClipboard } = await import('../utils/clipboard.js');
          let clipContent: string;
          try {
            clipContent = readClipboard();
            if (!clipContent?.trim()) {
              outputError('Clipboard is empty');
              process.exit(1);
            }
          } catch (e) {
            outputError(`Failed to read clipboard: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
          }

          const result = parseMcpServerById(clipContent, id);

          if (result.errors.length > 0) {
            outputError(`Invalid JSON: ${result.errors.join(', ')}`);
            process.exit(1);
          }

          if (result.connectors.length === 0) {
            outputError('No connector definition found in clipboard');
            process.exit(1);
          }

          if (result.connectors.length > 1) {
            outputError(`Multiple connectors found (${result.connectors.length}). Use 'connectors import --clip' instead.`);
            process.exit(1);
          }

          // Validate transport type before processing
          const rawTransport = result.connectors[0].transport;
          if (rawTransport.type !== 'stdio') {
            outputError(`Unsupported transport type: ${rawTransport.type}. Only stdio is supported.`);
            process.exit(1);
          }
          const transport = rawTransport as StdioTransport;

          // Validate command for potential shell injection patterns.
          // Note: This is defense-in-depth. Commands are executed via Node's child_process.spawn()
          // with shell: false, which prevents shell injection. However, we still block common
          // shell metacharacters as an additional safety layer against future code changes.
          // Characters blocked:
          //   ; & | - command chaining/piping
          //   ` $   - command substitution
          //   < >   - redirection
          //   ( )   - subshells
          //   \     - escape sequences
          const dangerousChars = /[;&|`$<>()\\]/;
          if (transport.command && dangerousChars.test(transport.command)) {
            outputError('Command contains potentially unsafe characters: ; & | ` $ < > ( ) \\');
            outputError('Please review the clipboard content before adding.');
            process.exit(1);
          }
          if (transport.args?.some(arg => dangerousChars.test(arg))) {
            outputError('Arguments contain potentially unsafe characters: ; & | ` $ < > ( ) \\');
            outputError('Please review the clipboard content before adding.');
            process.exit(1);
          }

          // Use toConnector for secretize/sanitize processing
          const { toConnector } = await import('../config/add.js');
          const parsed = {
            id,
            command: transport.command,
            args: transport.args,
            env: transport.env,
          };

          const { connector, secretizeOutput } = await toConnector(parsed, {
            configPath: getConfigPath(),
          });

          await manager.addConnector(connector);

          // Show secretize results if any
          for (const line of secretizeOutput) {
            console.log(`  ${line}`);
          }

          outputSuccess(`Connector '${id}' added from clipboard`);
          return;
        }

        // --from-mcp-json or --from-mcp-file mode
        if (options.fromMcpJson || options.fromMcpFile) {
          if (!id) {
            outputError('Connector ID is required. Usage: connectors add <id> --from-mcp-json \'...\'');
            process.exit(1);
          }

          let jsonContent: string;
          if (options.fromMcpFile) {
            try {
              jsonContent = await fs.readFile(options.fromMcpFile, 'utf-8');
            } catch (e) {
              outputError(`Failed to read file: ${options.fromMcpFile}`, e instanceof Error ? e : undefined);
              process.exit(1);
            }
          } else if (options.fromMcpJson === '-') {
            jsonContent = await readStdin();
          } else {
            jsonContent = options.fromMcpJson;
          }

          const result = parseMcpServerById(jsonContent, id);

          if (result.errors.length > 0) {
            outputError(result.errors.join('\n'));
            process.exit(1);
          }

          if (result.connectors.length === 0) {
            outputError('No connector found in input');
            process.exit(1);
          }

          await manager.addConnector(result.connectors[0]);
          outputSuccess(`Connector '${id}' added`);
          return;
        }

        // --stdio mode (legacy)
        if (options.stdio) {
          if (!id) {
            outputError('Connector ID is required. Usage: connectors add <id> --stdio \'...\'');
            process.exit(1);
          }

          const parts = options.stdio.trim().split(/\s+/);
          const command = parts[0];
          const args = parts.slice(1);

          const connector: Connector = {
            id,
            enabled: true,
            transport: {
              type: 'stdio',
              command,
              ...(args.length > 0 && { args }),
            },
          };

          await manager.addConnector(connector);
          outputSuccess(`Connector '${id}' added`);
          return;
        }

        // No mode specified
        outputError('One of --stdio, --from-mcp-json, --from-mcp-file, or --clip is required');
        console.error('\nExamples:');
        console.error('  # From clipboard (copy JSON from mcp.so, then run)');
        console.error('  pfscan connectors add inscribe --clip');
        console.error('');
        console.error('  # From command line');
        console.error('  pfscan connectors add inscribe --stdio \'npx -y inscribe-mcp\'');
        console.error('');
        console.error('  # From MCP JSON (README format)');
        console.error('  pfscan connectors add inscribe --from-mcp-json \'{"command":"npx","args":["-y","inscribe-mcp"]}\'');
        console.error('');
        console.error('  # From Claude Desktop config file');
        console.error('  pfscan connectors add inscribe --from-mcp-file ~/.config/Claude/claude_desktop_config.json');
        console.error('');
        console.error('  # From stdin');
        console.error('  cat config.json | pfscan connectors add inscribe --from-mcp-json -');
        process.exit(1);
      } catch (error) {
        outputError('Failed to add connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('enable')
    .description('Enable a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        await manager.enableConnector(options.id);
        outputSuccess(`Connector '${options.id}' enabled`);
      } catch (error) {
        outputError('Failed to enable connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('disable')
    .description('Disable a connector')
    .requiredOption('--id <id>', 'Connector ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        await manager.disableConnector(options.id);
        outputSuccess(`Connector '${options.id}' disabled`);
      } catch (error) {
        outputError('Failed to disable connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('delete')
    .description('Delete a connector')
    .argument('[id]', 'Connector ID')
    .option('--id <id>', 'Connector ID (alternative to positional argument)')
    .action(async (idArg, options) => {
      try {
        const id = idArg || options.id;
        if (!id) {
          outputError('Connector ID required. Usage: connectors delete <id>');
          process.exit(1);
        }
        const manager = new ConfigManager(getConfigPath());
        await manager.removeConnector(id);
        outputSuccess(`Connector '${id}' deleted`);
      } catch (error) {
        outputError('Failed to delete connector', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('import')
    .description('Import connectors from mcpServers format')
    .requiredOption('--from <format>', 'Import format (mcpServers)')
    .option('--file <path>', 'Read from file')
    .option('--stdin', 'Read from stdin')
    .option('--name <id>', 'Connector ID (required for single server definition)')
    .action(async (options) => {
      try {
        if (options.from !== 'mcpServers') {
          outputError(`Unsupported format: ${options.from}. Only 'mcpServers' is supported.`);
          process.exit(1);
        }

        if (!options.file && !options.stdin) {
          outputError('Either --file or --stdin is required');
          process.exit(1);
        }

        let jsonContent: string;
        if (options.stdin) {
          jsonContent = await readStdin();
        } else {
          jsonContent = await fs.readFile(options.file, 'utf-8');
        }

        const result = parseMcpServers(jsonContent, options.name);

        if (result.errors.length > 0) {
          outputError(`Import errors:\n${result.errors.map(e => `  - ${e}`).join('\n')}`);
          process.exit(1);
        }

        if (result.connectors.length === 0) {
          output({ imported: 0 }, 'No connectors found in input.');
          return;
        }

        const manager = new ConfigManager(getConfigPath());

        // Ensure config exists
        await manager.init(false);

        // Add each connector
        const added: string[] = [];
        const errors: string[] = [];

        for (const connector of result.connectors) {
          try {
            await manager.addConnector(connector);
            added.push(connector.id);
          } catch (error) {
            errors.push(`${connector.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (added.length > 0) {
          outputSuccess(`Imported ${added.length} connector(s): ${added.join(', ')}`);
        }
        if (errors.length > 0) {
          console.error(`Errors:\n${errors.map(e => `  - ${e}`).join('\n')}`);
        }

        // Validate after import
        const validation = await manager.validate();
        if (!validation.valid) {
          console.error('Warning: Config validation failed after import');
          process.exit(1);
        }
      } catch (error) {
        outputError('Failed to import connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
