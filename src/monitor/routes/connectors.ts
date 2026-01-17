/**
 * ProofScan Web Monitor - Connector detail routes
 */

import { Hono } from 'hono';
import type { MonitorEnv } from '../server.js';
import { ConfigManager } from '../../config/manager.js';
import { EventsStore } from '../../db/events-store.js';
import { getEventsDb } from '../../db/connection.js';
import {
  generateConnectorHtml,
  computeConnectorAnalytics,
  getPackageVersion,
  SHORT_ID_LENGTH,
} from '../../html/index.js';
import type {
  HtmlConnectorReportV1,
  HtmlConnectorInfo,
  HtmlSessionReportV1,
} from '../../html/types.js';
import type { StdioTransport } from '../../types/config.js';
import {
  getPoplEntriesByConnector,
  buildSessionPoplMap,
} from '../data/popl.js';
import { getConnectorDetail } from '../data/connectors.js';
import type { MonitorPoplSummary } from '../types.js';
import { escapeHtml, formatTimestamp } from '../templates/layout.js';

export const connectorsRoutes = new Hono<MonitorEnv>();

// Connector detail page
connectorsRoutes.get('/:id', async (c) => {
  const connectorId = c.req.param('id');
  const configPath = c.get('configPath');

  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();

  // Get connector config
  let connector = null;
  try {
    connector = await manager.getConnector(connectorId);
  } catch {
    // Config might not exist
  }

  // Build connector report
  const report = await buildConnectorReport(connectorId, connector, configDir);

  // Get connector detail for badge row (protocol, capabilities, etc.)
  const connectorCard = await getConnectorDetail(configPath, connectorId);

  // Get POPL entries for this connector
  const poplEntries = await getPoplEntriesByConnector(connectorId);
  const sessionPoplMap = await buildSessionPoplMap();

  // Generate base HTML
  let html = generateConnectorHtml(report);

  // Add POPL section styles and Related POPL Entries section
  html = html.replace(
    '</style>',
    `
    .back-link:hover {
      border-color: var(--accent-blue);
      background: var(--bg-tertiary);
    }
    .popl-section {
      margin: 24px 0;
    }
    .popl-section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 12px;
      text-transform: uppercase;
    }
    .popl-entries-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .popl-entry-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      text-decoration: none;
      transition: border-color 0.15s;
    }
    .popl-entry-link:hover {
      border-color: var(--accent-blue);
    }
    .popl-entry-id {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      color: var(--accent-blue);
    }
    .popl-entry-meta {
      flex: 1;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .popl-trust-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }
    .popl-trust-0 {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }
    .popl-trust-1 {
      background: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--accent-green);
    }
    .popl-trust-2 {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: var(--accent-blue);
    }
    .popl-trust-3 {
      background: rgba(255, 215, 0, 0.15);
      border: 1px solid rgba(255, 215, 0, 0.3);
      color: #ffd700;
    }
    .session-popl-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      margin-left: 8px;
      background: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.3);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      color: var(--accent-green);
      text-decoration: none;
    }
    .session-popl-badge:hover {
      background: rgba(63, 185, 80, 0.25);
    }
    .no-popl-entries {
      color: var(--text-secondary);
      font-size: 13px;
      font-style: italic;
    }

    /* Modal Overlay */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(13, 17, 23, 0.85);
      z-index: 1000;
      overflow-y: auto;
      padding: 24px;
    }

    .modal-overlay.active {
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    .modal-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      margin-top: 40px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
      z-index: 1;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-entry-id {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }

    .modal-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .modal-menu-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px 8px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 14px;
    }

    .modal-menu-btn:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      padding: 4px 8px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }

    .modal-close-btn:hover {
      color: var(--accent-red);
    }

    .modal-content {
      padding: 20px;
    }

    .modal-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 4px 0;
      min-width: 180px;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 2;
    }

    .modal-dropdown.active {
      display: block;
    }

    .modal-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      color: var(--text-primary);
      text-decoration: none;
      font-size: 13px;
      cursor: pointer;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
    }

    .modal-dropdown-item:hover {
      background: rgba(0, 212, 255, 0.1);
      color: var(--accent-blue);
    }

    .modal-dropdown-divider {
      height: 1px;
      background: var(--border-color);
      margin: 4px 0;
    }

    .modal-error {
      padding: 24px;
      text-align: center;
      color: var(--accent-red);
    }

    /* POPL Detail styles for modal content */
    .popl-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-top: 8px;
    }
    .popl-header-left { flex: 1; }
    .popl-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--text-primary);
    }
    .popl-id {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }
    .popl-subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0 0 8px 0;
    }
    .popl-meta {
      font-size: 12px;
      color: var(--text-secondary);
      margin: 0;
    }
    .trust-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
    }
    .trust-level-0 {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }
    .trust-level-1 {
      background: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--accent-green);
    }
    .trust-level-2 {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: var(--accent-blue);
    }
    .trust-level-3 {
      background: rgba(255, 215, 0, 0.15);
      border: 1px solid rgba(255, 215, 0, 0.3);
      color: #ffd700;
    }

    /* Source Table */
    .source-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .source-table th,
    .source-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .source-table tr:last-child th,
    .source-table tr:last-child td {
      border-bottom: none;
    }
    .source-table th {
      width: 120px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 12px;
    }
    .source-link {
      color: var(--accent-blue);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .source-link:hover {
      text-decoration: underline;
    }
    .source-link code {
      font-family: 'SF Mono', Consolas, monospace;
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .session-full {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--text-secondary);
      margin-left: 4px;
    }
    .no-session {
      color: var(--text-secondary);
      font-style: italic;
    }
    .badge-kind {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }

    /* Capture Table */
    .capture-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .capture-table th,
    .capture-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .capture-table tr:last-child th,
    .capture-table tr:last-child td {
      border-bottom: none;
    }
    .capture-table th {
      width: 120px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 12px;
    }
    .capture-stat {
      font-family: 'SF Mono', Consolas, monospace;
      font-weight: 600;
      color: var(--accent-blue);
    }
    .capture-stat.stat-error {
      color: var(--accent-red);
    }

    /* Artifacts Table */
    .artifacts-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .artifacts-table th,
    .artifacts-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .artifacts-table th {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
    }
    .artifacts-table tbody tr:last-child td {
      border-bottom: none;
    }
    .artifact-name {
      font-weight: 500;
      color: var(--text-primary);
    }
    .artifact-path {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .artifact-sha256 {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .artifact-link {
      color: var(--accent-blue);
      text-decoration: none;
    }
    .artifact-link:hover {
      text-decoration: underline;
    }
    .no-artifacts {
      color: var(--text-secondary);
      font-style: italic;
    }
    </style>`
  );

  // Insert Related POPL Entries section before Sessions section
  const poplSectionHtml = renderPoplSection(poplEntries);
  html = html.replace(
    '<section class="section" id="sessions">',
    `${poplSectionHtml}<section class="section" id="sessions">`
  );

  // Add POPL badges to session rows
  html = addPoplBadgesToSessions(html, sessionPoplMap);

  // Add Ledger modal HTML and JavaScript
  html = html.replace(
    '</body>',
    `${getLedgerModalHtml()}
<script>${getLedgerModalScript()}</script>
</body>`
  );

  return c.html(html);
});

/**
 * Render Related POPL Entries section
 */
function renderPoplSection(entries: MonitorPoplSummary[]): string {
  if (entries.length === 0) {
    return `
      <section class="section popl-section">
        <div class="popl-section-title">Related Ledger Entries</div>
        <p class="no-popl-entries">No Ledger entries for this connector</p>
      </section>
    `;
  }

  const entriesHtml = entries
    .map((entry) => {
      const trustClass = `popl-trust-${entry.trust_level}`;
      const createdFormatted = formatTimestamp(entry.created_at);
      return `
        <a href="/popl/${encodeURIComponent(entry.id)}" class="popl-entry-link">
          <span class="popl-entry-id">${escapeHtml(entry.id)}</span>
          <span class="popl-entry-meta">
            ${createdFormatted} | RPCs: ${entry.rpc_total} | Errors: ${entry.errors}
          </span>
          <span class="popl-trust-badge ${trustClass}">${escapeHtml(entry.trust_label)}</span>
        </a>
      `;
    })
    .join('');

  return `
    <section class="section popl-section">
      <div class="popl-section-title">Related Ledger Entries (${entries.length})</div>
      <div class="popl-entries-list">
        ${entriesHtml}
      </div>
    </section>
  `;
}

/**
 * Add POPL badges to session rows in HTML
 */
function addPoplBadgesToSessions(
  html: string,
  sessionPoplMap: Map<string, MonitorPoplSummary>
): string {
  // Find all session rows and add POPL badge if entry exists
  for (const [sessionId, popl] of sessionPoplMap) {
    // Match session ID in the HTML (both full and short versions)
    const shortId = sessionId.slice(0, 8);
    // Look for the session link pattern and add badge after it
    const sessionLinkPattern = new RegExp(
      `(<span[^>]*class="[^"]*session-id[^"]*"[^>]*>[^<]*${shortId}[^<]*</span>)`,
      'g'
    );
    html = html.replace(sessionLinkPattern, (match) => {
      return `${match}<a href="/popl/${encodeURIComponent(popl.id)}" class="session-popl-badge">Ledger</a>`;
    });
  }
  return html;
}

/**
 * Build connector report for HTML generation
 */
async function buildConnectorReport(
  connectorId: string,
  connector: import('../../types/config.js').Connector | null,
  configDir: string
): Promise<HtmlConnectorReportV1> {
  const eventsStore = new EventsStore(configDir);
  const db = getEventsDb(configDir);

  // Get session count
  const countStmt = db.prepare(
    `SELECT COUNT(*) as count FROM sessions WHERE connector_id = ?`
  );
  const totalSessionCount = (countStmt.get(connectorId) as { count: number }).count;

  // Get sessions with pagination (limit 50 for web view)
  const maxSessions = 50;
  const offset = 0;

  const sessionsStmt = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
      (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count,
      (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id AND success = 0) as error_count
    FROM sessions s
    WHERE s.connector_id = ?
    ORDER BY s.started_at DESC
    LIMIT ? OFFSET ?
  `);
  const displayedSessions = sessionsStmt.all(connectorId, maxSessions, offset) as Array<{
    session_id: string;
    started_at: string;
    ended_at: string | null;
    event_count: number;
    rpc_count: number;
    error_count: number;
  }>;

  // Build transport info
  const transportInfo: HtmlConnectorInfo['transport'] = connector
    ? {
        type: connector.transport.type,
        command:
          connector.transport.type === 'stdio'
            ? `${connector.transport.command}${
                (connector.transport as StdioTransport).args?.length
                  ? ' ' + (connector.transport as StdioTransport).args!.join(' ')
                  : ''
              }`
            : undefined,
        url:
          'url' in connector.transport
            ? (connector.transport as { url: string }).url
            : undefined,
      }
    : { type: 'stdio' as const };

  // Get server info from initialize response
  const serverInfo = getServerInfo(db, connectorId);

  // Build session reports
  const sessionReports: Record<string, HtmlSessionReportV1> = {};

  for (const session of displayedSessions) {
    const rpcCalls = eventsStore.getRpcCallsBySession(session.session_id);
    const report = buildSessionReport(session, rpcCalls, connectorId, configDir);
    sessionReports[session.session_id] = report;
  }

  // Compute analytics
  const analytics = computeConnectorAnalytics({
    sessionReports,
    sessionsTotal: totalSessionCount,
    sessionsDisplayed: displayedSessions.length,
  });

  return {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${getPackageVersion()}`,
      redacted: false,
    },
    connector: {
      connector_id: connectorId,
      enabled: connector?.enabled ?? true,
      transport: transportInfo,
      server: serverInfo ?? undefined,
      session_count: totalSessionCount,
      displayed_sessions: displayedSessions.length,
      offset,
    },
    sessions: displayedSessions.map((s) => ({
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
}

/**
 * Get server info from initialize response
 */
function getServerInfo(
  db: ReturnType<typeof getEventsDb>,
  connectorId: string
): HtmlConnectorInfo['server'] | null {
  // NOTE: rpc_calls has composite PK (rpc_id, session_id), so we must join on both
  // to avoid cross-connector data leakage
  const stmt = db.prepare(`
    SELECT e.raw_json
    FROM events e
    JOIN sessions s ON e.session_id = s.session_id
    JOIN rpc_calls r ON e.rpc_id = r.rpc_id AND r.session_id = s.session_id
    WHERE s.connector_id = ?
      AND r.method = 'initialize'
      AND e.direction = 'server_to_client'
      AND e.kind = 'response'
    ORDER BY e.ts DESC
    LIMIT 1
  `);
  const row = stmt.get(connectorId) as { raw_json: string } | undefined;
  if (!row?.raw_json) return null;

  try {
    const json = JSON.parse(row.raw_json);
    const result = json.result;
    if (result?.serverInfo) {
      return {
        name: result.serverInfo.name ?? null,
        version: result.serverInfo.version ?? null,
        protocolVersion: result.protocolVersion ?? null,
        capabilities: {
          tools: !!result.capabilities?.tools,
          resources: !!result.capabilities?.resources,
          prompts: !!result.capabilities?.prompts,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Build session report from session and RPC data
 */
function buildSessionReport(
  session: {
    session_id: string;
    started_at: string;
    ended_at: string | null;
    exit_reason?: string | null;
    event_count?: number;
  },
  rpcCalls: import('../../db/types.js').RpcCall[],
  connectorId: string,
  configDir: string
): HtmlSessionReportV1 {
  const db = getEventsDb(configDir);
  const rpcs: import('../../html/types.js').SessionRpcDetail[] = [];
  let totalLatencyMs: number | null = null;

  for (const rpc of rpcCalls) {
    // Get events for this RPC via SQL
    // NOTE: rpc_id is NOT globally unique - it's only unique within a session
    // Must filter by session_id to avoid cross-session data leakage
    const eventsStmt = db.prepare(`
      SELECT direction, kind, raw_json
      FROM events
      WHERE rpc_id = ? AND session_id = ?
      ORDER BY ts ASC
    `);
    const events = eventsStmt.all(rpc.rpc_id, session.session_id) as Array<{
      direction: string;
      kind: string;
      raw_json: string | null;
    }>;

    const requestEvent = events.find(
      (e) => e.direction === 'client_to_server' && e.kind === 'request'
    );
    const responseEvent = events.find(
      (e) => e.direction === 'server_to_client' && e.kind === 'response'
    );

    // Parse payloads
    let requestPayload: unknown = null;
    let responsePayload: unknown = null;
    let requestRaw: string | null = null;
    let responseRaw: string | null = null;

    try {
      if (requestEvent?.raw_json) {
        requestPayload = JSON.parse(requestEvent.raw_json);
        requestRaw = requestEvent.raw_json;
      }
    } catch {
      /* ignore */
    }
    try {
      if (responseEvent?.raw_json) {
        responsePayload = JSON.parse(responseEvent.raw_json);
        responseRaw = responseEvent.raw_json;
      }
    } catch {
      /* ignore */
    }

    // Calculate latency
    let latencyMs: number | null = null;
    if (rpc.request_ts && rpc.response_ts) {
      latencyMs = Math.round(
        new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime()
      );
      if (totalLatencyMs === null) {
        totalLatencyMs = latencyMs;
      } else {
        totalLatencyMs += latencyMs;
      }
    }

    // Convert DB status to RpcStatus
    const status: import('../../html/types.js').RpcStatus =
      rpc.success === 1 ? 'OK' : rpc.success === 0 ? 'ERR' : 'PENDING';

    rpcs.push({
      rpc_id: rpc.rpc_id,
      method: rpc.method,
      status,
      latency_ms: latencyMs,
      request_ts: rpc.request_ts,
      response_ts: rpc.response_ts,
      error_code: rpc.error_code ?? null,
      request: {
        json: requestPayload,
        size: requestRaw ? requestRaw.length : 0,
        truncated: false,
        preview: null,
      },
      response: {
        json: responsePayload,
        size: responseRaw ? responseRaw.length : 0,
        truncated: false,
        preview: null,
      },
    });
  }

  return {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: `proofscan v${getPackageVersion()}`,
      redacted: false,
    },
    session: {
      session_id: session.session_id,
      connector_id: connectorId,
      started_at: session.started_at,
      ended_at: session.ended_at,
      exit_reason: session.exit_reason ?? null,
      rpc_count: rpcCalls.length,
      event_count: session.event_count ?? 0,
      total_latency_ms: totalLatencyMs,
    },
    rpcs,
  };
}

/**
 * Get Ledger modal HTML structure
 */
function getLedgerModalHtml(): string {
  return `
<div class="modal-overlay" id="ledgerModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-hidden="true">
  <div class="modal-container">
    <div class="modal-header">
      <div class="modal-title" id="modalTitle">
        <span>Ledger Entry:</span>
        <span class="modal-entry-id" id="modalEntryId"></span>
      </div>
      <div class="modal-actions">
        <div style="position: relative;">
          <button class="modal-menu-btn" id="modalMenuBtn" aria-label="More options" aria-haspopup="true">⋮</button>
          <div class="modal-dropdown" id="modalDropdown" role="menu">
            <a class="modal-dropdown-item" id="modalOpenNew" target="_blank" role="menuitem">
              <span>↗</span> Open in new window
            </a>
            <div class="modal-dropdown-divider" role="separator"></div>
            <button class="modal-dropdown-item" id="modalDownloadJson" role="menuitem">
              <span>↓</span> Download JSON
            </button>
            <button class="modal-dropdown-item" id="modalDownloadYaml" role="menuitem">
              <span>↓</span> Download YAML
            </button>
            <div class="modal-dropdown-divider" role="separator"></div>
            <button class="modal-dropdown-item" id="modalCopyLink" role="menuitem">
              <span>🔗</span> Copy link
            </button>
          </div>
        </div>
        <button class="modal-close-btn" id="modalCloseBtn" aria-label="Close modal">×</button>
      </div>
    </div>
    <div class="modal-content" id="modalContent" role="document">
      <!-- Loaded dynamically -->
    </div>
  </div>
</div>`;
}

/**
 * Get Ledger modal JavaScript
 */
function getLedgerModalScript(): string {
  return `
(function() {
  var currentLedgerId = null;
  var modal = document.getElementById('ledgerModal');
  var modalContent = document.getElementById('modalContent');
  var modalEntryId = document.getElementById('modalEntryId');
  var modalOpenNew = document.getElementById('modalOpenNew');
  var modalMenuBtn = document.getElementById('modalMenuBtn');
  var modalDropdown = document.getElementById('modalDropdown');
  var modalCloseBtn = document.getElementById('modalCloseBtn');
  var modalCopyLink = document.getElementById('modalCopyLink');
  var modalDownloadJson = document.getElementById('modalDownloadJson');
  var modalDownloadYaml = document.getElementById('modalDownloadYaml');

  if (!modal) return;

  // ULID validation regex (26 chars: 0-9, A-Z excluding I, L, O, U)
  var ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

  // Validate ULID format
  function isValidUlid(str) {
    return str && typeof str === 'string' && ULID_REGEX.test(str);
  }

  // Track previous focus for accessibility
  var previousFocus = null;

  // Open modal
  function openLedgerModal(ledgerId, options) {
    options = options || {};

    // Validate ULID format before proceeding
    if (!isValidUlid(ledgerId)) {
      console.error('Invalid ULID format:', ledgerId);
      return;
    }

    // Prevent duplicate opens
    if (currentLedgerId === ledgerId) return;

    currentLedgerId = ledgerId;

    // Store focus for accessibility restoration
    previousFocus = document.activeElement;

    // Update URL (skip if from popstate to avoid loop)
    if (!options.fromPopstate) {
      var url = new URL(window.location.href);
      url.searchParams.set('ledger', ledgerId);
      history.pushState({ ledger: ledgerId }, '', url);
    }

    // Show loading state
    modalContent.innerHTML = '<div class="modal-loading">Loading...</div>';

    // Load content via fetch
    fetch('/popl/' + encodeURIComponent(ledgerId))
      .then(function(res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        return res.text();
      })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        // Try data-page="popl" first, then fallback to main
        var main = doc.querySelector('main[data-page="popl"]') || doc.querySelector('main');
        if (main) {
          modalContent.innerHTML = main.innerHTML;
          // Remove back link from modal content
          var backLink = modalContent.querySelector('.back-link');
          if (backLink) backLink.remove();
        } else {
          modalContent.innerHTML = renderErrorWithRetry('Content not found');
        }
      })
      .catch(function(err) {
        console.error('Failed to load ledger entry:', err);
        modalContent.innerHTML = renderErrorWithRetry('Failed to load: ' + err.message);
      });

    // Update modal UI
    modalEntryId.textContent = ledgerId.slice(0, 12) + '...';
    modalOpenNew.href = '/popl/' + encodeURIComponent(ledgerId);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Focus the close button for accessibility
    setTimeout(function() { modalCloseBtn.focus(); }, 100);
  }

  // Render error with retry button
  function renderErrorWithRetry(message) {
    return '<div class="modal-error">' +
      '<div class="modal-error-message">' + escapeHtml(message) + '</div>' +
      '<button class="modal-retry-btn" onclick="window.retryLedgerLoad()">Retry</button>' +
      '</div>';
  }

  // Escape HTML for safe display
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Retry function (exposed globally for onclick)
  window.retryLedgerLoad = function() {
    if (currentLedgerId) {
      var ledgerId = currentLedgerId;
      currentLedgerId = null; // Reset to allow reload
      openLedgerModal(ledgerId, { fromPopstate: true });
    }
  };

  // Close modal
  function closeLedgerModal() {
    if (!currentLedgerId) return;
    currentLedgerId = null;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    modalDropdown.classList.remove('active');

    // Restore focus for accessibility
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
      previousFocus = null;
    }
  }

  // Close and update URL
  function closeAndUpdateUrl() {
    closeLedgerModal();
    var url = new URL(window.location.href);
    url.searchParams.delete('ledger');
    history.pushState({}, '', url);
  }

  // Intercept clicks on ledger/POPL links (only entry pages, not artifacts)
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href^="/popl/"]');
    if (link) {
      // Don't intercept target="_blank" links (Open in new window)
      if (link.target === '_blank') return;

      // Ctrl/Cmd+Click opens in new tab (don't intercept)
      if (e.ctrlKey || e.metaKey) return;

      // Check if this is a POPL entry link (not artifacts or other sub-paths)
      // Format: /popl/{ULID} where ULID is 26 chars
      var href = link.getAttribute('href');
      var match = href.match(/^\/popl\/([^\/]+)$/);
      if (!match) return; // Not a direct POPL entry link, let it navigate normally

      var ledgerId = match[1].split('?')[0];
      if (ledgerId) {
        e.preventDefault();
        openLedgerModal(decodeURIComponent(ledgerId), { fromPopstate: false });
      }
    }
  });

  // Close button
  modalCloseBtn.addEventListener('click', closeAndUpdateUrl);

  // Click outside modal (on overlay)
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeAndUpdateUrl();
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeAndUpdateUrl();
    }
  });

  // Menu toggle
  modalMenuBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    modalDropdown.classList.toggle('active');
  });

  // Close dropdown on outside click
  document.addEventListener('click', function() {
    modalDropdown.classList.remove('active');
  });

  // Copy link
  modalCopyLink.addEventListener('click', function() {
    navigator.clipboard.writeText(window.location.href).then(function() {
      modalCopyLink.querySelector('span').textContent = '✓';
      setTimeout(function() {
        modalCopyLink.querySelector('span').textContent = '🔗';
      }, 1500);
    }).catch(function(err) {
      console.error('Copy failed:', err);
    });
  });

  // Download handlers
  modalDownloadJson.addEventListener('click', function() {
    if (currentLedgerId) {
      window.location.href = '/api/popl/' + encodeURIComponent(currentLedgerId) + '/download?format=json';
    }
  });

  modalDownloadYaml.addEventListener('click', function() {
    if (currentLedgerId) {
      window.location.href = '/api/popl/' + encodeURIComponent(currentLedgerId) + '/download?format=yaml';
    }
  });

  // Handle browser back/forward
  window.addEventListener('popstate', function() {
    var params = new URLSearchParams(window.location.search);
    var ledgerId = params.get('ledger');
    if (ledgerId) {
      openLedgerModal(ledgerId, { fromPopstate: true });
    } else {
      closeLedgerModal();
    }
  });

  // Check URL on load for modal state
  var params = new URLSearchParams(window.location.search);
  var initialLedgerId = params.get('ledger');
  if (initialLedgerId) {
    openLedgerModal(initialLedgerId, { fromPopstate: true });
  }
})();
  `;
}
