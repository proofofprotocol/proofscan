/**
 * Tool Analysis Module
 *
 * Shared logic for tool extraction and classification.
 * Used by summary, analyze, and related commands.
 */

import { getEventsDb } from './connection.js';
import { t } from '../i18n/index.js';

// ============================================================
// Types
// ============================================================

/** Operation category for tool classification */
export type OperationCategory = 'read' | 'write' | 'network' | 'exec' | 'other';

/** Category display order (risk priority) */
export const CATEGORY_ORDER: OperationCategory[] = ['exec', 'network', 'write', 'read', 'other'];

/** Category display order for permissions view (user-friendly) */
export const CATEGORY_ORDER_FRIENDLY: OperationCategory[] = ['read', 'write', 'network', 'exec', 'other'];

/**
 * Get localized label for a category
 * Uses i18n module for translation
 */
export function getCategoryLabel(category: OperationCategory): string {
  return t(`category.${category}`);
}

/** Tool info extracted from tools/list response */
export interface ToolInfo {
  name: string;
  description?: string;
  category: OperationCategory;
}

/** Tool call record with count */
export interface ToolCallRecord {
  name: string;
  count: number;
  category: OperationCategory;
}

/** Tool permission info (for permissions-style display) */
export interface ToolPermission {
  name: string;
  allowed: boolean;
  called: number;
}

/** Category stats for permissions view */
export interface CategoryStats {
  allowed_tool_count: number;
  called_count: number;
  tools: ToolPermission[];
}

// ============================================================
// Category Classification
// ============================================================

/**
 * Word boundary pattern for underscore-separated identifiers
 * Matches: start of string, underscore, or space
 */
const WB = '(?:^|_|\\s)';
const WBE = '(?:$|_|\\s)';

/**
 * Create regex that matches word in underscore-separated or space-separated text
 */
function wordPattern(word: string): RegExp {
  return new RegExp(`${WB}${word}${WBE}`, 'i');
}

/**
 * Keywords that force "other" category (time/misc tools)
 * These take priority over weak matches like "get"
 */
const MISC_KEYWORDS: RegExp[] = [
  wordPattern('time'),
  wordPattern('timezone'),
  wordPattern('datetime'),
  wordPattern('clock'),
  wordPattern('date'),
  wordPattern('calendar'),
];

/**
 * Strong exec keywords (highest priority)
 */
const EXEC_KEYWORDS: RegExp[] = [
  wordPattern('exec'),
  wordPattern('execute'),
  wordPattern('shell'),
  wordPattern('bash'),
  wordPattern('powershell'),
  wordPattern('cmd'),
  wordPattern('command'),
  wordPattern('spawn'),
  wordPattern('terminal'),
];

/**
 * Keywords that indicate exec context for "run"
 */
const RUN_EXEC_CONTEXT: RegExp[] = [
  wordPattern('command'),
  wordPattern('shell'),
  wordPattern('terminal'),
  wordPattern('cmd'),
  wordPattern('script'),
  wordPattern('bash'),
  wordPattern('powershell'),
];

/**
 * Strong network keywords
 */
const NETWORK_KEYWORDS: RegExp[] = [
  wordPattern('http'),
  wordPattern('https'),
  wordPattern('request'),
  wordPattern('url'),
  wordPattern('browser'),
  wordPattern('socket'),
  wordPattern('websocket'),
  wordPattern('download'),
  wordPattern('upload'),
  wordPattern('curl'),
  wordPattern('wget'),
  wordPattern('fetch'),
];

/**
 * Strong write keywords
 */
const WRITE_KEYWORDS: RegExp[] = [
  wordPattern('write'),
  wordPattern('create'),
  wordPattern('update'),
  wordPattern('delete'),
  wordPattern('remove'),
  wordPattern('edit'),
  wordPattern('modify'),
  wordPattern('save'),
  wordPattern('mkdir'),
  wordPattern('touch'),
  wordPattern('mv'),
  wordPattern('cp'),
  wordPattern('rm'),
  wordPattern('put'),
  wordPattern('post'),
  wordPattern('patch'),
  wordPattern('insert'),
  wordPattern('append'),
];

/**
 * Strong read keywords (NOT including "get" alone)
 */
const READ_KEYWORDS: RegExp[] = [
  wordPattern('read'),
  wordPattern('list'),
  wordPattern('load'),
  wordPattern('cat'),
  wordPattern('head'),
  wordPattern('tail'),
  wordPattern('ls'),
  wordPattern('dir'),
  wordPattern('view'),
  wordPattern('show'),
];

/**
 * File/path related keywords that strengthen "read" classification
 */
const FILE_RELATED_KEYWORDS: RegExp[] = [
  wordPattern('file'),
  wordPattern('files'),
  wordPattern('path'),
  wordPattern('directory'),
  wordPattern('folder'),
  wordPattern('content'),
  wordPattern('document'),
  wordPattern('documents'),
];

/**
 * Ambiguous keywords that need file context to be "read"
 */
const AMBIGUOUS_READ_KEYWORDS: RegExp[] = [
  wordPattern('search'),
  wordPattern('query'),
  wordPattern('find'),
];

/**
 * Check if text matches any pattern in the list
 */
function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

/**
 * Classify a tool into a category based on name and description
 *
 * Priority: exec > network > write > read > other
 * Special handling for time/misc tools to avoid false "read" classification
 */
export function classifyTool(name: string, description?: string): OperationCategory {
  const text = `${name} ${description || ''}`;

  // Priority 1: Check exec (highest risk)
  if (matchesAny(text, EXEC_KEYWORDS)) {
    return 'exec';
  }

  // Priority 1b: Check "run" + exec context
  const runPattern = wordPattern('run');
  if (runPattern.test(text) && matchesAny(text, RUN_EXEC_CONTEXT)) {
    return 'exec';
  }

  // Priority 2: Check network
  if (matchesAny(text, NETWORK_KEYWORDS)) {
    return 'network';
  }

  // Priority 3: Check write
  if (matchesAny(text, WRITE_KEYWORDS)) {
    return 'write';
  }

  // Priority 4: Check if it's a time/misc tool (before read check)
  if (matchesAny(text, MISC_KEYWORDS)) {
    return 'other';
  }

  // Priority 5: Check read with strong keywords
  if (matchesAny(text, READ_KEYWORDS)) {
    return 'read';
  }

  // Priority 6: Check ambiguous read keywords + file context
  if (matchesAny(text, AMBIGUOUS_READ_KEYWORDS) && matchesAny(text, FILE_RELATED_KEYWORDS)) {
    return 'read';
  }

  // Priority 7: Check "get" + file-related (weak read signal)
  const getPattern = wordPattern('get');
  if (getPattern.test(name) && matchesAny(text, FILE_RELATED_KEYWORDS)) {
    return 'read';
  }

  // Default: other
  return 'other';
}

// ============================================================
// Data Extraction
// ============================================================

interface ToolsListResult {
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
}

interface ToolsCallParams {
  name?: string;
}

/**
 * Extract tools from tools/list response for a session
 */
export function extractToolsFromSession(
  configDir: string,
  sessionId: string
): ToolInfo[] {
  const db = getEventsDb(configDir);

  // Find tools/list response
  const toolsListRpc = db.prepare(`
    SELECT rpc_id FROM rpc_calls
    WHERE session_id = ? AND method = 'tools/list'
    ORDER BY request_ts ASC
    LIMIT 1
  `).get(sessionId) as { rpc_id: string } | undefined;

  if (!toolsListRpc) {
    return [];
  }

  // Get the response event
  const responseEvent = db.prepare(`
    SELECT raw_json FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
    LIMIT 1
  `).get(sessionId, toolsListRpc.rpc_id) as { raw_json: string | null } | undefined;

  if (!responseEvent?.raw_json) {
    return [];
  }

  try {
    const response = JSON.parse(responseEvent.raw_json);
    const result = response.result as ToolsListResult | undefined;

    if (!result?.tools || !Array.isArray(result.tools)) {
      return [];
    }

    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      category: classifyTool(tool.name, tool.description),
    }));
  } catch {
    return [];
  }
}

/**
 * Extract tool call counts from tools/call requests for a session
 */
export function extractToolCallCounts(
  configDir: string,
  sessionId: string
): Map<string, number> {
  const db = getEventsDb(configDir);

  // Find all tools/call requests
  const toolCalls = db.prepare(`
    SELECT rc.rpc_id, e.raw_json
    FROM rpc_calls rc
    JOIN events e ON rc.session_id = e.session_id AND rc.rpc_id = e.rpc_id
    WHERE rc.session_id = ? AND rc.method = 'tools/call' AND e.kind = 'request'
  `).all(sessionId) as Array<{ rpc_id: string; raw_json: string | null }>;

  // Count by tool name
  const counts = new Map<string, number>();

  for (const call of toolCalls) {
    if (!call.raw_json) continue;

    try {
      const request = JSON.parse(call.raw_json);
      const params = request.params as ToolsCallParams | undefined;
      const toolName = params?.name || 'unknown';

      counts.set(toolName, (counts.get(toolName) || 0) + 1);
    } catch {
      // Ignore parse errors
    }
  }

  return counts;
}

/**
 * Extract tool calls as records for a session
 */
export function extractToolCalls(
  configDir: string,
  sessionId: string
): ToolCallRecord[] {
  const counts = extractToolCallCounts(configDir, sessionId);

  return Array.from(counts.entries()).map(([name, count]) => ({
    name,
    count,
    category: classifyTool(name),
  }));
}

/**
 * Group items by category
 */
export function groupByCategory<T extends { category: OperationCategory }>(
  items: T[]
): Record<OperationCategory, T[]> {
  const result: Record<OperationCategory, T[]> = {
    read: [],
    write: [],
    network: [],
    exec: [],
    other: [],
  };

  for (const item of items) {
    result[item.category].push(item);
  }

  return result;
}

// ============================================================
// Cross-Session Analysis (for analyze command)
// ============================================================

/** Session info for analysis */
export interface SessionInfo {
  session_id: string;
  connector_id: string;
  started_at: string;
}

/** Connector summary for analysis */
export interface ConnectorSummary {
  connector_id: string;
  session_count: number;
  rpc_count: number;
}

/** Tool usage across sessions */
export interface ToolUsageSummary {
  name: string;
  call_count: number;
  connector_id: string;
  category: OperationCategory;
}

/**
 * Get all connectors with session and RPC counts
 */
export function getConnectorSummaries(configDir: string): ConnectorSummary[] {
  const db = getEventsDb(configDir);

  const rows = db.prepare(`
    SELECT
      COALESCE(s.target_id, s.connector_id) as connector_id,
      COUNT(DISTINCT s.session_id) as session_count,
      COUNT(r.rpc_id) as rpc_count
    FROM sessions s
    LEFT JOIN rpc_calls r ON s.session_id = r.session_id
    GROUP BY COALESCE(s.target_id, s.connector_id)
    ORDER BY session_count DESC
  `).all() as Array<{
    connector_id: string;
    session_count: number;
    rpc_count: number;
  }>;

  return rows;
}

/**
 * Get sessions for a target
 */
export function getSessionsForTarget(
  configDir: string,
  targetId: string,
  limit?: number
): SessionInfo[] {
  const db = getEventsDb(configDir);

  // Validate limit to prevent SQL injection (must be positive integer)
  const safeLimit = limit !== undefined ? Math.max(1, Math.floor(Number(limit))) : undefined;
  const limitClause = safeLimit !== undefined && Number.isFinite(safeLimit) ? `LIMIT ${safeLimit}` : '';

  const sql = `
    SELECT session_id, COALESCE(target_id, connector_id) as connector_id, started_at
    FROM sessions
    WHERE COALESCE(target_id, connector_id) = ?
    ORDER BY started_at DESC
    ${limitClause}
  `;

  return db.prepare(sql).all(targetId) as SessionInfo[];
}

/**
 * @deprecated Use getSessionsForTarget instead
 */
export function getSessionsForConnector(
  configDir: string,
  connectorId: string,
  limit?: number
): SessionInfo[] {
  return getSessionsForTarget(configDir, connectorId, limit);
}

/**
 * Get all tool calls across all sessions, grouped by tool name
 */
export function getAllToolUsage(configDir: string): ToolUsageSummary[] {
  const db = getEventsDb(configDir);

  // Get all tools/call events with connector info
  const rows = db.prepare(`
    SELECT
      e.raw_json,
      COALESCE(s.target_id, s.connector_id) as connector_id
    FROM events e
    JOIN sessions s ON e.session_id = s.session_id
    JOIN rpc_calls r ON e.session_id = r.session_id AND e.rpc_id = r.rpc_id
    WHERE r.method = 'tools/call' AND e.kind = 'request'
  `).all() as Array<{ raw_json: string | null; connector_id: string }>;

  // Aggregate by tool name and connector
  const usageMap = new Map<string, { count: number; connector_id: string }>();

  for (const row of rows) {
    if (!row.raw_json) continue;

    try {
      const request = JSON.parse(row.raw_json);
      const params = request.params as ToolsCallParams | undefined;
      const toolName = params?.name || 'unknown';
      const key = `${toolName}:${row.connector_id}`;

      const existing = usageMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        usageMap.set(key, { count: 1, connector_id: row.connector_id });
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Convert to array
  const results: ToolUsageSummary[] = [];
  for (const [key, value] of usageMap) {
    const [name] = key.split(':');
    results.push({
      name,
      call_count: value.count,
      connector_id: value.connector_id,
      category: classifyTool(name),
    });
  }

  // Sort by call count desc
  results.sort((a, b) => b.call_count - a.call_count);

  return results;
}

/**
 * Get tool usage for a specific target across all its sessions
 */
export function getToolUsageForTarget(
  configDir: string,
  targetId: string
): ToolUsageSummary[] {
  const db = getEventsDb(configDir);

  const rows = db.prepare(`
    SELECT
      e.raw_json
    FROM events e
    JOIN sessions s ON e.session_id = s.session_id
    JOIN rpc_calls r ON e.session_id = r.session_id AND e.rpc_id = r.rpc_id
    WHERE COALESCE(s.target_id, s.connector_id) = ? AND r.method = 'tools/call' AND e.kind = 'request'
  `).all(targetId) as Array<{ raw_json: string | null }>;

  // Count by tool name
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.raw_json) continue;

    try {
      const request = JSON.parse(row.raw_json);
      const params = request.params as ToolsCallParams | undefined;
      const toolName = params?.name || 'unknown';

      counts.set(toolName, (counts.get(toolName) || 0) + 1);
    } catch {
      // Ignore parse errors
    }
  }

  // Convert to array
  const results: ToolUsageSummary[] = [];
  for (const [name, count] of counts) {
    results.push({
      name,
      call_count: count,
      connector_id: targetId,
      category: classifyTool(name),
    });
  }

  // Sort by call count desc
  results.sort((a, b) => b.call_count - a.call_count);

  return results;
}

/**
 * @deprecated Use getToolUsageForTarget instead
 */
export function getToolUsageForConnector(
  configDir: string,
  connectorId: string
): ToolUsageSummary[] {
  return getToolUsageForTarget(configDir, connectorId);
}

/**
 * Get method call counts for analysis
 */
export function getMethodCounts(configDir: string): Map<string, number> {
  const db = getEventsDb(configDir);

  const rows = db.prepare(`
    SELECT method, COUNT(*) as count
    FROM rpc_calls
    GROUP BY method
    ORDER BY count DESC
  `).all() as Array<{ method: string; count: number }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.method, row.count);
  }

  return counts;
}

/**
 * Get date range of sessions
 */
export function getSessionDateRange(configDir: string): { min: string | null; max: string | null } {
  const db = getEventsDb(configDir);

  const row = db.prepare(`
    SELECT
      MIN(started_at) as min_date,
      MAX(started_at) as max_date
    FROM sessions
  `).get() as { min_date: string | null; max_date: string | null } | undefined;

  return {
    min: row?.min_date || null,
    max: row?.max_date || null,
  };
}

/**
 * Get tools from latest session for a target (capabilities)
 */
export function getLatestToolsForTarget(
  configDir: string,
  targetId: string
): ToolInfo[] {
  const db = getEventsDb(configDir);

  // Find latest session
  const latestSession = db.prepare(`
    SELECT session_id FROM sessions
    WHERE COALESCE(target_id, connector_id) = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(targetId) as { session_id: string } | undefined;

  if (!latestSession) {
    return [];
  }

  return extractToolsFromSession(configDir, latestSession.session_id);
}

/**
 * @deprecated Use getLatestToolsForTarget instead
 */
export function getLatestToolsForConnector(
  configDir: string,
  connectorId: string
): ToolInfo[] {
  return getLatestToolsForTarget(configDir, connectorId);
}
