/**
 * Permissions command - Phase 3
 *
 * pfscan permissions [--session <sid>] [--latest] [--connector <id>]
 *
 * Shows detailed allowed/used stats per category and per tool.
 *
 * Categories (in display order):
 * - 読み取り（Read）
 * - 書き込み（Write）
 * - ネット接続（Network）
 * - コマンド実行（Exec）
 * - その他操作（Other）
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
import { classifyTool, OperationCategory } from './summary.js';

// ============================================================
// Types
// ============================================================

/** Japanese labels for categories (Phase 3 UX format) */
const CATEGORY_LABELS: Record<OperationCategory, string> = {
  read: '読み取り（Read）',
  write: '書き込み（Write）',
  network: 'ネット接続（Network）',
  exec: 'コマンド実行（Exec）',
  other: 'その他操作（Other）',
};

/** Display order for categories */
const CATEGORY_ORDER: OperationCategory[] = ['read', 'write', 'network', 'exec', 'other'];

/** Tool permission info */
export interface ToolPermission {
  name: string;
  allowed: boolean;
  called: number;
}

/** Category stats */
export interface CategoryStats {
  allowed_tool_count: number;
  called_count: number;
  tools: ToolPermission[];
}

/** Permissions data structure */
export interface PermissionsData {
  schema_version: string;
  session_id: string;
  connector_id: string;
  resolved_by: 'option' | 'latest' | 'current';

  /** Stats per category */
  categories: Record<OperationCategory, CategoryStats>;

  /** Totals across all categories */
  totals: {
    allowed_tool_count: number;
    called_count: number;
  };
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
function extractToolsFromSession(
  configDir: string,
  sessionId: string
): Array<{ name: string; description?: string; category: OperationCategory }> {
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
 * Extract tool call counts from tools/call requests
 */
function extractToolCallCounts(
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

// ============================================================
// Permissions Generation
// ============================================================

/**
 * Generate permissions data for a session
 */
function generatePermissions(
  configDir: string,
  sessionId: string,
  connectorId: string,
  resolvedBy: 'option' | 'latest' | 'current'
): PermissionsData {
  const allowedTools = extractToolsFromSession(configDir, sessionId);
  const callCounts = extractToolCallCounts(configDir, sessionId);

  // Initialize categories
  const categories: Record<OperationCategory, CategoryStats> = {
    read: { allowed_tool_count: 0, called_count: 0, tools: [] },
    write: { allowed_tool_count: 0, called_count: 0, tools: [] },
    network: { allowed_tool_count: 0, called_count: 0, tools: [] },
    exec: { allowed_tool_count: 0, called_count: 0, tools: [] },
    other: { allowed_tool_count: 0, called_count: 0, tools: [] },
  };

  // Track which tools are allowed
  const allowedToolNames = new Set(allowedTools.map(t => t.name));

  // Add allowed tools to their categories
  for (const tool of allowedTools) {
    const called = callCounts.get(tool.name) || 0;
    categories[tool.category].tools.push({
      name: tool.name,
      allowed: true,
      called,
    });
    categories[tool.category].allowed_tool_count++;
    categories[tool.category].called_count += called;
  }

  // Add tools that were called but not in allowed list (shouldn't happen normally)
  for (const [toolName, count] of callCounts) {
    if (!allowedToolNames.has(toolName)) {
      const category = classifyTool(toolName);
      categories[category].tools.push({
        name: toolName,
        allowed: false,
        called: count,
      });
      categories[category].called_count += count;
    }
  }

  // Sort tools: called desc, then name asc
  for (const cat of CATEGORY_ORDER) {
    categories[cat].tools.sort((a, b) => {
      if (b.called !== a.called) {
        return b.called - a.called;
      }
      return a.name.localeCompare(b.name);
    });
  }

  // Calculate totals
  const totals = {
    allowed_tool_count: allowedTools.length,
    called_count: Array.from(callCounts.values()).reduce((sum, c) => sum + c, 0),
  };

  return {
    schema_version: 'phase3.permissions.v1',
    session_id: sessionId,
    connector_id: connectorId,
    resolved_by: resolvedBy,
    categories,
    totals,
  };
}

// ============================================================
// Rendering
// ============================================================

/**
 * Render permissions to terminal
 */
function renderPermissions(data: PermissionsData): void {
  console.log(`${data.connector_id} (session: ${shortenId(data.session_id, 8)}...)`);
  console.log();

  for (const cat of CATEGORY_ORDER) {
    const stats = data.categories[cat];
    const label = CATEGORY_LABELS[cat];

    // Category header
    console.log(`【${label}】`);

    // 許可/使用
    const hasPermission = stats.allowed_tool_count > 0;
    console.log(`  許可: ${hasPermission ? 'あり' : 'なし'}`);
    console.log(`  使用: ${stats.called_count} 回`);

    // Tool list
    if (stats.tools.length > 0) {
      console.log();
      for (const tool of stats.tools) {
        const allowedMark = tool.allowed ? '' : ' (未許可)';
        console.log(`    ${tool.name}: ${tool.called} 回${allowedMark}`);
      }
    }

    console.log();
  }

  // Totals
  console.log('─'.repeat(40));
  console.log(`合計: ${data.totals.allowed_tool_count} ツール許可, ${data.totals.called_count} 回使用`);
}

// ============================================================
// Command
// ============================================================

export function createPermissionsCommand(getConfigPath: () => string): Command {
  const cmd = new Command('permissions')
    .description('Show detailed permission stats per category and tool')
    .addHelpText('after', `
Examples:
  pfscan permissions time              # Latest session for 'time' connector
  pfscan permissions --session abc123  # Specific session by ID
  pfscan permissions --latest          # Latest session across all connectors
  pfscan permissions --id mcp          # Alias for: permissions mcp
`)
    .argument('[connector]', 'Connector ID (uses latest session for connector)')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .option('--id <id>', 'Alias for --connector')
    .action(async (connectorArg: string | undefined, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        // Resolve connector from positional arg, --connector, or --id
        const connectorId = connectorArg || options.connector || options.id;

        // Resolve session
        // If connector is provided (positional or option), treat as --latest for that connector
        const result = resolveSession({
          sessionId: options.session,
          latest: options.latest || !!connectorId,
          connectorId,
          configDir,
        });

        if (isSessionError(result)) {
          console.error(formatSessionError(result));
          process.exit(1);
        }

        // Generate permissions
        const permissions = generatePermissions(
          configDir,
          result.sessionId,
          result.connectorId,
          result.resolvedBy
        );

        if (getOutputOptions().json) {
          output(permissions);
          return;
        }

        renderPermissions(permissions);

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
