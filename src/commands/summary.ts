/**
 * Summary command - Phase 3
 *
 * pfscan summary [--session <sid>] [--latest] [--connector <id>]
 *
 * Shows:
 * - できること（capability）: tools from tools/list
 * - やったこと（tool call）: tools/call invocations
 * - 注意点: security notes (max 3 lines)
 *
 * Categories:
 * - 読み取り（Read）
 * - 書き込み（Write）
 * - ネット接続（Network）
 * - コマンド実行（Exec）
 * - その他操作（Other）
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { getEventsDb } from '../db/connection.js';
import type { Session } from '../db/types.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  resolveSession,
  isSessionError,
  formatSessionError,
} from '../utils/session-resolver.js';
import { shortenId } from '../eventline/types.js';
import { getCategoryLabel } from '../db/tool-analysis.js';
import { t } from '../i18n/index.js';

// ============================================================
// Types
// ============================================================

/** Operation category */
export type OperationCategory = 'read' | 'write' | 'network' | 'exec' | 'other';

/** Tool info extracted from tools/list response */
export interface ToolInfo {
  name: string;
  description?: string;
  category: OperationCategory;
}

/** Tool call record */
export interface ToolCallRecord {
  name: string;
  count: number;
  category: OperationCategory;
}

/** Note severity levels */
export type NoteSeverity = 'info' | 'warn' | 'critical';

/** Note structure for JSON output */
export interface SummaryNote {
  code: string;
  severity: NoteSeverity;
  category?: OperationCategory;
  tool?: string;
  called?: boolean;
}

/** Actor info (Phase 3.4) */
export interface ActorInfo {
  id: string;
  kind: string;
  label: string;
}

/** Summary data structure (Phase 3.4: v2 with actor and secret_ref_count) */
export interface SummaryData {
  schema_version: string;
  session_id: string;
  connector_id: string;
  resolved_by: 'option' | 'latest' | 'current';

  /** Phase 3.4: Actor info (null if not set) */
  actor: ActorInfo | null;

  /** Capabilities from tools/list */
  capabilities: {
    tools: ToolInfo[];
    by_category: Record<OperationCategory, string[]>;
    total_count: number;
  };

  /** Tool calls from tools/call */
  tool_calls: {
    records: ToolCallRecord[];
    by_category: Record<OperationCategory, { name: string; count: number }[]>;
    total_count: number;
  };

  /** Security notes (English codes for JSON) */
  notes: SummaryNote[];

  /** Phase 3.4: Secret reference count */
  secret_ref_count: number;
}

// ============================================================
// Category Classification (v1 rules)
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
 * Note: "run" alone is ambiguous; only exec when combined with command/shell/etc.
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
  // "run" is checked separately with context
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
 * "get" is too ambiguous - get_current_time is not a read operation
 * "search/query/find" are checked separately with file context
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
  // "search/query/find" are checked separately with file context
];

/**
 * File/path related keywords that strengthen "read" classification
 * If tool has "get" + file-related term, classify as read
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
 * Ambiguous keywords that need file context to be "read"
 * search, query, find → only read if file/path/directory context exists
 */
const AMBIGUOUS_READ_KEYWORDS: RegExp[] = [
  wordPattern('search'),
  wordPattern('query'),
  wordPattern('find'),
];

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
  // This prevents "get_current_time" from being classified as "read"
  if (matchesAny(text, MISC_KEYWORDS)) {
    return 'other';
  }

  // Priority 5: Check read with strong keywords
  if (matchesAny(text, READ_KEYWORDS)) {
    return 'read';
  }

  // Priority 6: Check ambiguous read keywords (search/query/find) + file context
  if (matchesAny(text, AMBIGUOUS_READ_KEYWORDS) && matchesAny(text, FILE_RELATED_KEYWORDS)) {
    return 'read';
  }

  // Priority 7: Check "get" + file-related (weak read signal)
  // Only classify as read if "get" is combined with file-related terms
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
 * Extract tools from tools/list response
 */
function extractToolsFromSession(configDir: string, sessionId: string): ToolInfo[] {
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
 * Extract tool calls from tools/call requests
 */
function extractToolCalls(configDir: string, sessionId: string): ToolCallRecord[] {
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

  // Convert to records
  return Array.from(counts.entries()).map(([name, count]) => ({
    name,
    count,
    category: classifyTool(name),
  }));
}

/**
 * Generate notes based on capabilities and tool calls
 */
function generateNotes(
  capabilities: ToolInfo[],
  toolCalls: ToolCallRecord[]
): SummaryNote[] {
  const notes: SummaryNote[] = [];

  // Check for exec
  const hasExecCapability = capabilities.some(t => t.category === 'exec');
  const hasExecCall = toolCalls.some(t => t.category === 'exec');
  const execTool = toolCalls.find(t => t.category === 'exec')?.name
    || capabilities.find(t => t.category === 'exec')?.name;

  if (hasExecCall) {
    notes.push({
      code: 'exec_called',
      severity: 'critical',
      category: 'exec',
      tool: execTool,
      called: true,
    });
  } else if (hasExecCapability) {
    notes.push({
      code: 'exec_capable',
      severity: 'warn',
      category: 'exec',
      tool: execTool,
      called: false,
    });
  }

  // Check for write
  const hasWriteCall = toolCalls.some(t => t.category === 'write');
  const writeTool = toolCalls.find(t => t.category === 'write')?.name;

  if (hasWriteCall) {
    notes.push({
      code: 'write_called',
      severity: 'warn',
      category: 'write',
      tool: writeTool,
      called: true,
    });
  }

  // Check for network
  const hasNetworkCall = toolCalls.some(t => t.category === 'network');
  const networkTool = toolCalls.find(t => t.category === 'network')?.name;

  if (hasNetworkCall) {
    notes.push({
      code: 'network_called',
      severity: 'warn',
      category: 'network',
      tool: networkTool,
      called: true,
    });
  }

  // If no sensitive operations were called, add info note
  if (!hasExecCall && !hasWriteCall && !hasNetworkCall) {
    notes.push({
      code: 'no_sensitive_calls',
      severity: 'info',
    });
  }

  // Limit to 3 notes
  return notes.slice(0, 3);
}

/**
 * Group items by category
 */
function groupByCategory<T extends { category: OperationCategory }>(
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
// Summary Generation
// ============================================================

/**
 * Get session data from database
 */
function getSession(configDir: string, sessionId: string): Session | null {
  const db = getEventsDb(configDir);
  const stmt = db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
  return stmt.get(sessionId) as Session | null;
}

/**
 * Generate summary data for a session
 * Phase 3.4: Now includes actor and secret_ref_count
 */
function generateSummary(
  configDir: string,
  sessionId: string,
  connectorId: string,
  resolvedBy: 'option' | 'latest' | 'current'
): SummaryData {
  const capabilities = extractToolsFromSession(configDir, sessionId);
  const toolCalls = extractToolCalls(configDir, sessionId);
  const notes = generateNotes(capabilities, toolCalls);

  // Get session for actor and secret_ref_count
  const session = getSession(configDir, sessionId);

  // Build actor info if available
  let actor: ActorInfo | null = null;
  if (session?.actor_id && session?.actor_kind && session?.actor_label) {
    actor = {
      id: session.actor_id,
      kind: session.actor_kind,
      label: session.actor_label,
    };
  }

  // Group capabilities by category
  const capabilitiesByCategory = groupByCategory(capabilities);
  const capabilitiesSimple: Record<OperationCategory, string[]> = {
    read: capabilitiesByCategory.read.map(t => t.name),
    write: capabilitiesByCategory.write.map(t => t.name),
    network: capabilitiesByCategory.network.map(t => t.name),
    exec: capabilitiesByCategory.exec.map(t => t.name),
    other: capabilitiesByCategory.other.map(t => t.name),
  };

  // Group tool calls by category
  const toolCallsByCategory = groupByCategory(toolCalls);
  const toolCallsSimple: Record<OperationCategory, { name: string; count: number }[]> = {
    read: toolCallsByCategory.read.map(t => ({ name: t.name, count: t.count })),
    write: toolCallsByCategory.write.map(t => ({ name: t.name, count: t.count })),
    network: toolCallsByCategory.network.map(t => ({ name: t.name, count: t.count })),
    exec: toolCallsByCategory.exec.map(t => ({ name: t.name, count: t.count })),
    other: toolCallsByCategory.other.map(t => ({ name: t.name, count: t.count })),
  };

  return {
    schema_version: 'phase3.summary.v2',
    session_id: sessionId,
    connector_id: connectorId,
    resolved_by: resolvedBy,
    actor,
    capabilities: {
      tools: capabilities,
      by_category: capabilitiesSimple,
      total_count: capabilities.length,
    },
    tool_calls: {
      records: toolCalls,
      by_category: toolCallsSimple,
      total_count: toolCalls.reduce((sum, t) => sum + t.count, 0),
    },
    notes,
    secret_ref_count: session?.secret_ref_count ?? 0,
  };
}

// ============================================================
// Rendering (Phase 3 UX)
// ============================================================

/**
 * Get note message from i18n
 */
function getNoteMessage(code: string): string {
  return t(`summary.notes.${code}`);
}

/**
 * Render summary to terminal (Phase 3 UX format)
 * Phase 3.4: Now shows actor and secret_ref_count
 */
function renderSummary(data: SummaryData): void {
  console.log(`${data.connector_id} (session: ${shortenId(data.session_id, 8)}...)`);

  // Phase 3.4: Show actor if present
  if (data.actor) {
    console.log(`actor: ${data.actor.kind} "${data.actor.label}" (${shortenId(data.actor.id, 8)}...)`);
  }

  console.log();

  // ============================================================
  // Capabilities section
  // ============================================================
  console.log(t('summary.section.capability', { count: data.capabilities.total_count }));
  console.log();

  // Show tools by category
  const categoryOrder: OperationCategory[] = ['exec', 'network', 'write', 'read', 'other'];
  let hasAnyCapability = false;

  for (const cat of categoryOrder) {
    const tools = data.capabilities.by_category[cat];
    if (tools.length > 0) {
      hasAnyCapability = true;
      console.log(`  ${getCategoryLabel(cat)}: ${tools.join(', ')}`);
    }
  }

  if (!hasAnyCapability) {
    console.log(`  ${t('common.none')}`);
  }

  console.log();

  // ============================================================
  // Tool calls section
  // ============================================================
  console.log(t('summary.section.toolCall', { count: data.tool_calls.total_count }));
  console.log();

  let hasAnyCall = false;

  for (const cat of categoryOrder) {
    const calls = data.tool_calls.by_category[cat];
    if (calls.length > 0) {
      hasAnyCall = true;
      const callStrings = calls.map(c =>
        c.count > 1 ? `${c.name} (${t('common.times', { count: c.count })})` : c.name
      );
      console.log(`  ${getCategoryLabel(cat)}: ${callStrings.join(', ')}`);
    }
  }

  if (!hasAnyCall) {
    console.log(`  ${t('common.none')}`);
  }

  console.log();

  // ============================================================
  // Notes section
  // ============================================================
  console.log(t('summary.section.notes'));
  console.log();

  if (data.notes.length > 0) {
    for (const note of data.notes) {
      const message = getNoteMessage(note.code);
      const icon = note.severity === 'critical' ? '🔴' :
                   note.severity === 'warn' ? '⚠️' : 'ℹ️';
      console.log(`  ${icon} ${message}`);
    }
  } else {
    console.log(`  ${t('common.none')}`);
  }

  // Phase 3.4: Show secret refs if any
  if (data.secret_ref_count > 0) {
    console.log();
    console.log(`secret refs: ${data.secret_ref_count}`);
  }
}

// ============================================================
// Command
// ============================================================

export function createSummaryCommand(getConfigPath: () => string): Command {
  const cmd = new Command('summary')
    .description('Show session summary with capabilities and tool calls')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
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

        // Generate summary
        const summary = generateSummary(
          configDir,
          result.sessionId,
          result.connectorId,
          result.resolvedBy
        );

        if (getOutputOptions().json) {
          output(summary);
          return;
        }

        renderSummary(summary);

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
