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

  // Get POPL entries for this connector
  const poplEntries = await getPoplEntriesByConnector(connectorId);
  const sessionPoplMap = await buildSessionPoplMap();

  // Add back navigation link - inject into header
  let html = generateConnectorHtml(report);

  // Add back link
  html = html.replace(
    '<div class="header-left">',
    `<div class="header-left">
      <a href="/" class="back-link">← Back to Monitor</a>`
  );

  // Add POPL section styles and Related POPL Entries section
  html = html.replace(
    '</style>',
    `
    .back-link {
      display: inline-block;
      margin-bottom: 8px;
      padding: 4px 10px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--accent-blue);
      text-decoration: none;
      font-size: 12px;
    }
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

  return c.html(html);
});

/**
 * Render Related POPL Entries section
 */
function renderPoplSection(entries: MonitorPoplSummary[]): string {
  if (entries.length === 0) {
    return `
      <section class="section popl-section">
        <div class="popl-section-title">Related POPL Entries</div>
        <p class="no-popl-entries">No POPL entries for this connector</p>
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
      <div class="popl-section-title">Related POPL Entries (${entries.length})</div>
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
      return `${match}<a href="/popl/${encodeURIComponent(popl.id)}" class="session-popl-badge">POPL</a>`;
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
  const stmt = db.prepare(`
    SELECT e.raw_json
    FROM events e
    JOIN sessions s ON e.session_id = s.session_id
    JOIN rpc_calls r ON e.rpc_id = r.rpc_id
    WHERE s.connector_id = ?
      AND r.method = 'initialize'
      AND e.direction = 'server'
      AND e.kind = 'result'
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
    const eventsStmt = db.prepare(`
      SELECT direction, kind, raw_json
      FROM events
      WHERE rpc_id = ?
      ORDER BY ts ASC
    `);
    const events = eventsStmt.all(rpc.rpc_id) as Array<{
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
