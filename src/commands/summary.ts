/**
 * Summary command - Phase 3
 *
 * pfscan summary [--session <sid>] [--latest] [--connector <id>]
 *
 * Shows:
 * - できること（capability）: tools from tools/list
 * - やったこと（tool call）: tools/call invocations
 * - 注意点: security concerns (max 3 lines)
 *
 * Categories:
 * - 読み取り (read)
 * - 書き込み (write)
 * - ネット接続 (network)
 * - コマンド実行 (exec)
 * - その他操作 (other)
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { getEventsDb } from '../db/connection.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  resolveSession,
  isSessionError,
  formatSessionError,
} from '../utils/session-resolver.js';
import { shortenId } from '../eventline/types.js';

// ============================================================
// Types
// ============================================================

/** Operation category */
export type OperationCategory = 'read' | 'write' | 'network' | 'exec' | 'other';

/** Japanese labels for categories */
const CATEGORY_LABELS: Record<OperationCategory, string> = {
  read: '読み取り (read)',
  write: '書き込み (write)',
  network: 'ネット接続 (network)',
  exec: 'コマンド実行 (exec)',
  other: 'その他操作 (other)',
};

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

/** Summary data structure */
export interface SummaryData {
  schema_version: string;
  session_id: string;
  connector_id: string;
  resolved_by: 'option' | 'latest' | 'current';

  /** Capabilities from tools/list */
  capabilities: {
    tools: ToolInfo[];
    by_category: Record<OperationCategory, string[]>;
  };

  /** Tool calls from tools/call */
  tool_calls: {
    records: ToolCallRecord[];
    by_category: Record<OperationCategory, { name: string; count: number }[]>;
    total_count: number;
  };

  /** Security concerns (max 3) */
  concerns: string[];
}

// ============================================================
// Category Classification
// ============================================================

/** Keywords for category classification */
const CATEGORY_KEYWORDS: Record<OperationCategory, RegExp[]> = {
  read: [
    /read/i,
    /get/i,
    /list/i,
    /search/i,
    /query/i,
    /fetch/i,
    /find/i,
    /show/i,
    /view/i,
    /cat/i,
    /head/i,
    /tail/i,
    /ls/i,
    /dir/i,
  ],
  write: [
    /write/i,
    /create/i,
    /update/i,
    /delete/i,
    /remove/i,
    /edit/i,
    /modify/i,
    /set/i,
    /put/i,
    /post/i,
    /save/i,
    /mkdir/i,
    /touch/i,
    /mv/i,
    /cp/i,
    /rm/i,
  ],
  network: [
    /http/i,
    /https/i,
    /fetch/i,
    /request/i,
    /api/i,
    /url/i,
    /web/i,
    /net/i,
    /socket/i,
    /connect/i,
    /download/i,
    /upload/i,
    /curl/i,
    /wget/i,
  ],
  exec: [
    /exec/i,
    /run/i,
    /shell/i,
    /bash/i,
    /cmd/i,
    /command/i,
    /spawn/i,
    /process/i,
    /script/i,
    /terminal/i,
  ],
  other: [],
};

/**
 * Classify a tool into a category based on name and description
 */
export function classifyTool(name: string, description?: string): OperationCategory {
  const text = `${name} ${description || ''}`.toLowerCase();

  // Check exec first (highest risk)
  for (const pattern of CATEGORY_KEYWORDS.exec) {
    if (pattern.test(text)) return 'exec';
  }

  // Check network
  for (const pattern of CATEGORY_KEYWORDS.network) {
    if (pattern.test(text)) return 'network';
  }

  // Check write
  for (const pattern of CATEGORY_KEYWORDS.write) {
    if (pattern.test(text)) return 'write';
  }

  // Check read
  for (const pattern of CATEGORY_KEYWORDS.read) {
    if (pattern.test(text)) return 'read';
  }

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
 * Generate concerns based on capabilities and tool calls
 */
function generateConcerns(
  capabilities: ToolInfo[],
  toolCalls: ToolCallRecord[]
): string[] {
  const concerns: string[] = [];

  // Check for exec capability
  const hasExecCapability = capabilities.some(t => t.category === 'exec');
  const hasExecCall = toolCalls.some(t => t.category === 'exec');

  if (hasExecCall) {
    concerns.push('コマンド実行が行われました');
  } else if (hasExecCapability) {
    concerns.push('コマンド実行可能');
  }

  // Check for write
  const hasWriteCall = toolCalls.some(t => t.category === 'write');
  if (hasWriteCall) {
    concerns.push('書き込み操作あり');
  }

  // Check for network
  const hasNetworkCall = toolCalls.some(t => t.category === 'network');
  if (hasNetworkCall) {
    concerns.push('外部ネットワーク接続あり');
  }

  // Limit to 3 concerns
  return concerns.slice(0, 3);
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
 * Generate summary data for a session
 */
function generateSummary(
  configDir: string,
  sessionId: string,
  connectorId: string,
  resolvedBy: 'option' | 'latest' | 'current'
): SummaryData {
  const capabilities = extractToolsFromSession(configDir, sessionId);
  const toolCalls = extractToolCalls(configDir, sessionId);
  const concerns = generateConcerns(capabilities, toolCalls);

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
    schema_version: 'phase3.summary.v1',
    session_id: sessionId,
    connector_id: connectorId,
    resolved_by: resolvedBy,
    capabilities: {
      tools: capabilities,
      by_category: capabilitiesSimple,
    },
    tool_calls: {
      records: toolCalls,
      by_category: toolCallsSimple,
      total_count: toolCalls.reduce((sum, t) => sum + t.count, 0),
    },
    concerns,
  };
}

// ============================================================
// Rendering
// ============================================================

/**
 * Render summary to terminal
 */
function renderSummary(data: SummaryData): void {
  console.log(`${data.connector_id} (session: ${shortenId(data.session_id, 8)}...)`);
  console.log();

  // できること (capabilities)
  console.log('├── できること（capability）:');
  const capabilityNames = data.capabilities.tools.map(t => t.name);
  if (capabilityNames.length > 0) {
    // Show up to 5 tools, then "..." if more
    const shown = capabilityNames.slice(0, 5);
    const extra = capabilityNames.length - shown.length;
    const suffix = extra > 0 ? ` (+${extra} more)` : '';
    console.log(`│   ${shown.join(', ')}${suffix}`);
  } else {
    console.log('│   (なし)');
  }

  // Show by category if verbose or many tools
  if (data.capabilities.tools.length > 3) {
    for (const [cat, label] of Object.entries(CATEGORY_LABELS) as [OperationCategory, string][]) {
      const tools = data.capabilities.by_category[cat];
      if (tools.length > 0) {
        console.log(`│   - ${label}: ${tools.join(', ')}`);
      }
    }
  }

  // やったこと (tool calls)
  console.log('├── やったこと（tool call）:');
  if (data.tool_calls.total_count > 0) {
    const callStrings = data.tool_calls.records.map(t =>
      t.count > 1 ? `${t.name} (${t.count}回)` : t.name
    );
    // Show up to 5 calls, then "..." if more
    const shown = callStrings.slice(0, 5);
    const extra = callStrings.length - shown.length;
    const suffix = extra > 0 ? ` (+${extra} more)` : '';
    console.log(`│   ${shown.join(', ')}${suffix}`);
  } else {
    console.log('│   (なし)');
  }

  // 注意点 (concerns)
  if (data.concerns.length > 0) {
    console.log('└── 注意点:');
    for (let i = 0; i < data.concerns.length; i++) {
      const prefix = i === data.concerns.length - 1 ? '    ' : '│   ';
      console.log(`${prefix}⚠ ${data.concerns[i]}`);
    }
  } else {
    console.log('└── 注意点: (なし)');
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
