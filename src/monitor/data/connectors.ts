/**
 * ProofScan Web Monitor - Connector data queries
 */

import { createHash } from 'crypto';
import { ConfigManager } from '../../config/manager.js';
import { EventsStore } from '../../db/events-store.js';
import { TargetsStore } from '../../db/targets-store.js';
import { getEventsDb } from '../../db/connection.js';
import { listPoplEntries, hasPoplDir } from '../../popl/index.js';
import type { Connector } from '../../types/config.js';
import type {
  MonitorHomeData,
  MonitorConnectorCard,
  MonitorConnectorKpis,
  MonitorConnectorCapabilities,
  ConnectorStatus,
  TransportType,
  ProtocolTag,
} from '../types.js';
import { getPoplKpis } from './popl.js';
import {
  computeAggregatedHeatmap,
  computeAggregatedMethodDistribution,
} from './aggregator.js';

/**
 * Get complete home page data
 */
export async function getHomeData(
  configPath: string,
  generatedAt: string
): Promise<MonitorHomeData> {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();

  let connectors: Connector[] = [];
  try {
    connectors = await manager.getConnectors();
  } catch {
    // Config might not exist or be invalid
    connectors = [];
  }

  const connectorCards = connectors.map((connector) =>
    buildConnectorCard(connector, configDir)
  );

  // Also include connectors that have data but are not in config
  const knownIds = new Set(connectors.map((c) => c.id));
  const orphanConnectorIds = getOrphanConnectorIds(configDir, knownIds);
  for (const id of orphanConnectorIds) {
    connectorCards.push(buildOrphanConnectorCard(id, configDir));
  }

  // Include A2A agents from targets table
  // These may not have sessions yet but should be visible in monitor
  const agentIds = getAgentIds(configDir);
  for (const id of agentIds) {
    if (!knownIds.has(id)) {
      connectorCards.push(buildAgentCard(id, configDir));
    }
  }

  // Sort by last activity (most recent first)
  connectorCards.sort((a, b) => {
    if (!a.last_activity && !b.last_activity) return 0;
    if (!a.last_activity) return 1;
    if (!b.last_activity) return -1;
    return b.last_activity.localeCompare(a.last_activity);
  });

  // Get POPL KPIs
  const popl = await getPoplKpis(configDir);

  // Compute aggregated analytics (cross-connector)
  const aggregated_analytics = {
    heatmap: computeAggregatedHeatmap(configDir),
    method_distribution: computeAggregatedMethodDistribution(configDir),
  };

  return {
    generated_at: generatedAt,
    connectors: connectorCards,
    popl,
    aggregated_analytics,
  };
}

/**
 * Build connector card data from config and DB
 */
function buildConnectorCard(
  connector: Connector,
  configDir: string
): MonitorConnectorCard {
  const eventsStore = new EventsStore(configDir);
  const db = getEventsDb(configDir);

  // Get recent sessions for status determination
  const recentSessions = eventsStore.getSessionsByTarget(connector.id, 5);

  // Get protocol and server info from initialize response
  const protocolInfo = getProtocolInfo(db, connector.id);

  // Calculate KPIs
  const kpis = calculateKpis(db, connector.id);

  // Detect capabilities
  const capabilities = detectCapabilities(db, connector.id);

  // Determine status (independent of enabled)
  const status = determineStatus(recentSessions);

  // Get last activity
  const lastActivity = getLastActivity(db, connector.id);

  return {
    target_id: connector.id,
    package_name: protocolInfo?.name ?? connector.id,
    package_version: protocolInfo?.version ?? 'unknown',
    protocol: protocolInfo?.protocol ?? 'Unknown',
    protocol_version: protocolInfo?.protocolVersion,
    status,
    enabled: connector.enabled,
    capabilities,
    transport: getTransportType(connector),
    kpis,
    last_activity: lastActivity,
    last_activity_relative: formatRelativeTime(lastActivity),
  };
}

/**
 * Build card for connector that exists in DB but not in config
 */
function buildOrphanConnectorCard(
  connectorId: string,
  configDir: string
): MonitorConnectorCard {
  const eventsStore = new EventsStore(configDir);
  const db = getEventsDb(configDir);

  const recentSessions = eventsStore.getSessionsByTarget(connectorId, 5);
  const protocolInfo = getProtocolInfo(db, connectorId);
  const kpis = calculateKpis(db, connectorId);
  const capabilities = detectCapabilities(db, connectorId);
  const status = determineStatus(recentSessions);
  const lastActivity = getLastActivity(db, connectorId);

  return {
    target_id: connectorId,
    package_name: protocolInfo?.name ?? connectorId,
    package_version: protocolInfo?.version ?? 'unknown',
    protocol: protocolInfo?.protocol ?? 'Unknown',
    protocol_version: protocolInfo?.protocolVersion,
    status,
    enabled: false, // Not in config = disabled
    capabilities,
    transport: 'stdio', // Default assumption
    kpis,
    last_activity: lastActivity,
    last_activity_relative: formatRelativeTime(lastActivity),
  };
}

/**
 * Get connector IDs that have sessions but are not in config
 * Also checks target_id for A2A agents
 */
function getOrphanConnectorIds(
  configDir: string,
  knownIds: Set<string>
): string[] {
  const db = getEventsDb(configDir);

  // Check both connector_id and target_id for A2A compatibility
  const stmt = db.prepare(`
    SELECT DISTINCT COALESCE(target_id, connector_id) as id FROM sessions
    WHERE COALESCE(target_id, connector_id) IS NOT NULL
  `);
  const rows = stmt.all() as { id: string }[];
  return rows
    .map((r) => r.id)
    .filter((id) => !knownIds.has(id));
}

/**
 * Get A2A agent IDs from targets table
 */
function getAgentIds(configDir: string): string[] {
  try {
    const targetsStore = new TargetsStore(configDir);
    const targets = targetsStore.list({ type: 'agent' });
    return targets.map((t) => t.id);
  } catch {
    // Targets table might not exist yet
    return [];
  }
}

/**
 * Build card for A2A agent from targets table
 */
function buildAgentCard(
  agentId: string,
  configDir: string
): MonitorConnectorCard {
  const eventsStore = new EventsStore(configDir);
  const db = getEventsDb(configDir);

  const recentSessions = eventsStore.getSessionsByTarget(agentId, 5);
  const protocolInfo = getProtocolInfo(db, agentId);
  const kpis = calculateKpis(db, agentId);
  const capabilities = detectCapabilities(db, agentId);
  const status = determineStatus(recentSessions);
  const lastActivity = getLastActivity(db, agentId);

  // Try to get agent name from targets
  let agentName = agentId;
  try {
    const targetsStore = new TargetsStore(configDir);
    const targets = targetsStore.list({ type: 'agent' });
    const agent = targets.find((t) => t.id === agentId);
    if (agent?.name) {
      agentName = agent.name;
    }
  } catch {
    // Ignore
  }

  return {
    target_id: agentId,
    package_name: agentName,
    package_version: protocolInfo?.version ?? 'unknown',
    protocol: protocolInfo?.protocol ?? 'A2A',
    protocol_version: protocolInfo?.protocolVersion,
    status,
    enabled: true, // Agents are enabled by default in targets table
    capabilities,
    transport: 'http', // A2A uses HTTP
    kpis,
    last_activity: lastActivity,
    last_activity_relative: formatRelativeTime(lastActivity),
  };
}

/**
 * Protocol and server info from initialize response
 */
interface ProtocolInfo {
  name: string;
  version: string;
  protocol: ProtocolTag;
  protocolVersion?: string;
}

/**
 * Get protocol and server info from latest initialize response
 * Detection rules:
 * - MCP: Has initialize RPC with serverInfo in response (typical MCP pattern)
 * - A2A: Has message/send RPC (A2A message/send method)
 * - JSON-RPC: Has RPC calls but no MCP/A2A evidence
 * - Unknown: No observed traffic to determine
 */
function getProtocolInfo(
  db: ReturnType<typeof getEventsDb>,
  connectorId: string
): ProtocolInfo | null {
  // Check for initialize response with serverInfo (MCP pattern)
  // NOTE: rpc_calls has composite PK (rpc_id, session_id), so we must join on both
  // to avoid cross-connector data leakage
  const initStmt = db.prepare(`
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
  const initRow = initStmt.get(connectorId) as { raw_json: string } | undefined;

  if (initRow?.raw_json) {
    try {
      const json = JSON.parse(initRow.raw_json);
      const result = json.result;

      // MCP detection: serverInfo with name is the key indicator
      if (result?.serverInfo?.name) {
        return {
          name: result.serverInfo.name,
          version: result.serverInfo.version ?? 'unknown',
          protocol: 'MCP',
          protocolVersion: result.protocolVersion,
        };
      }

      // Has initialize response but no serverInfo - could be custom JSON-RPC
      return {
        name: connectorId,
        version: 'unknown',
        protocol: 'JSON-RPC',
      };
    } catch {
      // Parse error - fall through
    }
  }

  // Check for A2A traffic: message/send method
  const a2aStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
      AND r.method = 'message/send'
  `);
  const a2aCount = (a2aStmt.get(connectorId) as { count: number }).count;

  if (a2aCount > 0) {
    // A2A traffic detected
    // Try to get agent name from cached agent card
    let agentName = connectorId;
    const agentCardStmt = db.prepare(`
      SELECT ac.agent_card_json
      FROM agent_cache ac
      JOIN targets t ON ac.target_id = t.id
      WHERE t.id = ?
    `);
    const agentCardRow = agentCardStmt.get(connectorId) as { agent_card_json: string } | undefined;
    if (agentCardRow?.agent_card_json) {
      try {
        const agentCard = JSON.parse(agentCardRow.agent_card_json);
        if (agentCard.name) {
          agentName = agentCard.name;
        }
      } catch {
        // Ignore parse error
      }
    }

    return {
      name: agentName,
      version: 'unknown',
      protocol: 'A2A',
    };
  }

  // Check if there are any RPC calls at all
  const rpcStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
  `);
  const rpcCount = (rpcStmt.get(connectorId) as { count: number }).count;

  if (rpcCount > 0) {
    // Has RPC traffic but no initialize response - generic JSON-RPC
    return {
      name: connectorId,
      version: 'unknown',
      protocol: 'JSON-RPC',
    };
  }

  // No observed traffic
  return null;
}

/**
 * Calculate KPIs for a connector
 */
function calculateKpis(
  db: ReturnType<typeof getEventsDb>,
  connectorId: string
): MonitorConnectorKpis {
  // Total sessions
  const sessionStmt = db.prepare(`
    SELECT COUNT(*) as count FROM sessions WHERE connector_id = ?
  `);
  const sessions = (sessionStmt.get(connectorId) as { count: number }).count;

  // Total RPCs and errors
  const rpcStmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
  `);
  const rpcRow = rpcStmt.get(connectorId) as { total: number; errors: number };

  // Average latency (only for completed RPCs)
  const latencyStmt = db.prepare(`
    SELECT AVG(
      CAST((julianday(response_ts) - julianday(request_ts)) * 86400000 AS INTEGER)
    ) as avg_ms
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
      AND r.response_ts IS NOT NULL
  `);
  const latencyRow = latencyStmt.get(connectorId) as { avg_ms: number | null };

  return {
    sessions,
    rpcs: rpcRow.total,
    errors: rpcRow.errors ?? 0,
    avg_latency_ms: latencyRow.avg_ms ? Math.round(latencyRow.avg_ms) : null,
  };
}

/**
 * Detect capabilities based on observed data (fact-based)
 */
function detectCapabilities(
  db: ReturnType<typeof getEventsDb>,
  connectorId: string
): MonitorConnectorCapabilities {
  // Check for observed capability methods
  const methodStmt = db.prepare(`
    SELECT DISTINCT r.method
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
      AND (
        r.method LIKE 'tools/%'
        OR r.method LIKE 'resources/%'
        OR r.method LIKE 'prompts/%'
        OR r.method LIKE 'tasks/%'
        OR r.method LIKE 'progress/%'
      )
  `);
  const rows = methodStmt.all(connectorId) as { method: string }[];
  const methods = new Set(rows.map((r) => r.method));

  return {
    tools: [...methods].some((m) => m.startsWith('tools/')),
    resources: [...methods].some((m) => m.startsWith('resources/')),
    prompts: [...methods].some((m) => m.startsWith('prompts/')),
    subscriptions: [...methods].some(
      (m) => m.startsWith('tasks/') || m.startsWith('progress/')
    ),
  };
}

/**
 * Determine status based on recent sessions (independent of enabled/disabled)
 */
function determineStatus(
  recentSessions: { exit_reason: string | null; rpc_count?: number }[]
): ConnectorStatus {
  if (recentSessions.length === 0) {
    return 'OFFLINE';
  }

  // Check for RPC errors in recent sessions
  // We need to query error counts separately
  const hasRpcErrors = recentSessions.some((s) => {
    // This would require additional query, simplified for now
    return false;
  });

  if (hasRpcErrors) {
    return 'ERR';
  }

  // Check if latest session ended with error
  const latest = recentSessions[0];
  if (latest.exit_reason === 'error' || latest.exit_reason === 'killed') {
    return 'WARN';
  }

  return 'OK';
}

/**
 * Get last activity timestamp for connector
 */
function getLastActivity(
  db: ReturnType<typeof getEventsDb>,
  connectorId: string
): string | null {
  const stmt = db.prepare(`
    SELECT MAX(r.response_ts) as last_ts
    FROM rpc_calls r
    JOIN sessions s ON r.session_id = s.session_id
    WHERE s.connector_id = ?
  `);
  const row = stmt.get(connectorId) as { last_ts: string | null };
  return row.last_ts;
}

/**
 * Get transport type from connector config
 */
function getTransportType(connector: Connector): TransportType {
  if ('command' in connector.transport) {
    return 'stdio';
  }
  if ('url' in connector.transport) {
    const transport = connector.transport as { type?: string };
    if (transport.type === 'rpc-sse') {
      return 'sse';
    }
    return 'http';
  }
  return 'stdio';
}

/**
 * Format timestamp as relative time string
 */
function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) {
    return 'never';
  }

  const now = Date.now();
  const ts = new Date(timestamp).getTime();
  const diffMs = now - ts;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Get detailed connector data for API endpoint
 */
export async function getConnectorDetail(
  configPath: string,
  connectorId: string
): Promise<MonitorConnectorCard | null> {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  const db = getEventsDb(configDir);

  // Check if connector exists in config
  let connector: Connector | null = null;
  try {
    connector = await manager.getConnector(connectorId);
  } catch {
    // Connector not in config
  }

  // Check if connector has any data
  const sessionStmt = db.prepare(
    `SELECT COUNT(*) as count FROM sessions WHERE connector_id = ?`
  );
  const sessionCount = (sessionStmt.get(connectorId) as { count: number }).count;

  if (!connector && sessionCount === 0) {
    return null;
  }

  if (connector) {
    return buildConnectorCard(connector, configDir);
  } else {
    return buildOrphanConnectorCard(connectorId, configDir);
  }
}

/**
 * Monitor summary for change detection (Phase 12.1)
 */
export interface MonitorSummary {
  generated_at: string;
  session_count: number;
  rpc_count: number;
  ledger_count: number;
  latest_event_ts: string | null;
  digest: string; // SHA-256 first 16 chars for change detection
}

/**
 * Get lightweight summary for polling-based change detection
 * Used by Auto-check feature to detect new data without full page reload
 *
 * Note: getEventsDb() returns a cached singleton connection, so no explicit
 * close is needed. The connection is reused across all monitor requests.
 */
export async function getMonitorSummary(
  configPath: string
): Promise<MonitorSummary> {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  // Note: getEventsDb returns a singleton connection - no leak risk
  const db = getEventsDb(configDir);
  const generatedAt = new Date().toISOString();

  // Fast SQL counts
  const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get() as {
    c: number;
  };
  const rpcCount = db.prepare('SELECT COUNT(*) as c FROM rpc_calls').get() as {
    c: number;
  };

  // Latest event timestamp: prefer events table, fallback to rpc_calls.response_ts
  let latestEventTs: string | null = null;
  try {
    // Check if events table has data (more reliable than rpc_calls.response_ts)
    const eventsRow = db.prepare('SELECT MAX(ts) as ts FROM events').get() as {
      ts: string | null;
    };
    if (eventsRow.ts) {
      latestEventTs = eventsRow.ts;
    }
  } catch (err) {
    // events table might not exist in older DBs - log for debugging
    console.debug('[getMonitorSummary] events table query failed:', err);
  }
  if (!latestEventTs) {
    const rpcRow = db.prepare(
      'SELECT MAX(response_ts) as ts FROM rpc_calls'
    ).get() as { ts: string | null };
    latestEventTs = rpcRow.ts;
  }

  // Ledger count using existing POPL helpers
  // Note: POPL entries are stored in .popl/ directory relative to where the
  // monitor server was started. This is typically the user's project root.
  let ledgerCount = 0;
  const outputRoot = process.cwd();
  if (hasPoplDir(outputRoot)) {
    try {
      const entries = await listPoplEntries(outputRoot);
      ledgerCount = entries.length;
    } catch (err) {
      console.debug('[getMonitorSummary] Failed to list POPL entries:', err);
    }
  }

  // Create digest using SHA-256 for change detection
  const digestStr = `${sessionCount.c}:${rpcCount.c}:${ledgerCount}:${latestEventTs || ''}`;
  const digest = createHash('sha256').update(digestStr).digest('hex').slice(0, 16);

  return {
    generated_at: generatedAt,
    session_count: sessionCount.c,
    rpc_count: rpcCount.c,
    ledger_count: ledgerCount,
    latest_event_ts: latestEventTs,
    digest,
  };
}
