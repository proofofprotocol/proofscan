/**
 * Analyze command
 *
 * Cross-session and cross-connector analysis of tool usage.
 *
 * Usage:
 *   pfscan analyze                    # Overall analysis
 *   pfscan analyze <connector>        # Connector-level analysis
 *   pfscan analyze --session <id>     # Session-level analysis (replaces permissions)
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  resolveSession,
  isSessionError,
  formatSessionError,
} from '../utils/session-resolver.js';
import { shortenId } from '../eventline/types.js';
import {
  OperationCategory,
  CATEGORY_ORDER,
  CATEGORY_ORDER_FRIENDLY,
  getCategoryLabel,
  ToolInfo,
  CategoryStats,
  ToolPermission,
  classifyTool,
  extractToolsFromSession,
  extractToolCallCounts,
  groupByCategory,
  getConnectorSummaries,
  getAllToolUsage,
  getToolUsageForConnector,
  getMethodCounts,
  getSessionDateRange,
  getLatestToolsForConnector,
  getSessionsForConnector,
} from '../db/tool-analysis.js';
import { t } from '../i18n/index.js';

// ============================================================
// Types
// ============================================================

/** Overall analysis data */
export interface OverallAnalysisData {
  schema_version: string;
  period: {
    start: string | null;
    end: string | null;
  };
  overview: {
    connector_count: number;
    session_count: number;
    rpc_count: number;
  };
  by_connector: Array<{
    connector_id: string;
    session_count: number;
    rpc_count: number;
  }>;
  methods: Array<{
    method: string;
    count: number;
  }>;
  tools_called: Array<{
    name: string;
    call_count: number;
    connector_id: string;
    category: OperationCategory;
  }>;
  by_category: Record<OperationCategory, number>;
}

/** Connector analysis data */
export interface ConnectorAnalysisData {
  schema_version: string;
  connector_id: string;
  period: {
    start: string | null;
    end: string | null;
  };
  session_count: number;
  available_tools: ToolInfo[];
  tool_usage: Array<{
    name: string;
    call_count: number;
    category: OperationCategory;
  }>;
  by_category: Record<OperationCategory, number>;
}

/** Session analysis data (replaces permissions) */
export interface SessionAnalysisData {
  schema_version: string;
  session_id: string;
  connector_id: string;
  resolved_by: 'option' | 'latest' | 'current';
  categories: Record<OperationCategory, CategoryStats>;
  totals: {
    allowed_tool_count: number;
    called_count: number;
  };
}

// ============================================================
// Data Generation
// ============================================================

/**
 * Generate overall analysis
 */
function generateOverallAnalysis(configDir: string): OverallAnalysisData {
  const connectors = getConnectorSummaries(configDir);
  const dateRange = getSessionDateRange(configDir);
  const methods = getMethodCounts(configDir);
  const toolUsage = getAllToolUsage(configDir);

  // Calculate totals
  const totalSessions = connectors.reduce((sum, c) => sum + c.session_count, 0);
  const totalRpcs = connectors.reduce((sum, c) => sum + c.rpc_count, 0);

  // Calculate by category
  const byCategory: Record<OperationCategory, number> = {
    read: 0,
    write: 0,
    network: 0,
    exec: 0,
    other: 0,
  };
  for (const tool of toolUsage) {
    byCategory[tool.category] += tool.call_count;
  }

  return {
    schema_version: 'analyze.overall.v1',
    period: {
      start: dateRange.min,
      end: dateRange.max,
    },
    overview: {
      connector_count: connectors.length,
      session_count: totalSessions,
      rpc_count: totalRpcs,
    },
    by_connector: connectors.map(c => ({
      connector_id: c.connector_id,
      session_count: c.session_count,
      rpc_count: c.rpc_count,
    })),
    methods: Array.from(methods.entries())
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count),
    tools_called: toolUsage,
    by_category: byCategory,
  };
}

/**
 * Generate connector analysis
 */
function generateConnectorAnalysis(
  configDir: string,
  connectorId: string
): ConnectorAnalysisData {
  const sessions = getSessionsForConnector(configDir, connectorId);
  const tools = getLatestToolsForConnector(configDir, connectorId);
  const toolUsage = getToolUsageForConnector(configDir, connectorId);

  // Get date range for this connector
  const startDate = sessions.length > 0 ? sessions[sessions.length - 1].started_at : null;
  const endDate = sessions.length > 0 ? sessions[0].started_at : null;

  // Calculate by category
  const byCategory: Record<OperationCategory, number> = {
    read: 0,
    write: 0,
    network: 0,
    exec: 0,
    other: 0,
  };
  for (const tool of toolUsage) {
    byCategory[tool.category] += tool.call_count;
  }

  return {
    schema_version: 'analyze.connector.v1',
    connector_id: connectorId,
    period: {
      start: startDate,
      end: endDate,
    },
    session_count: sessions.length,
    available_tools: tools,
    tool_usage: toolUsage.map(t => ({
      name: t.name,
      call_count: t.call_count,
      category: t.category,
    })),
    by_category: byCategory,
  };
}

/**
 * Generate session analysis (replaces permissions)
 */
function generateSessionAnalysis(
  configDir: string,
  sessionId: string,
  connectorId: string,
  resolvedBy: 'option' | 'latest' | 'current'
): SessionAnalysisData {
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

  // Add tools that were called but not in allowed list
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
  for (const cat of CATEGORY_ORDER_FRIENDLY) {
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
    schema_version: 'analyze.session.v1',
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
 * Format date for display (YYYY-MM-DD)
 */
function formatDate(isoDate: string | null): string {
  if (!isoDate) return '(no data)';
  return isoDate.slice(0, 10);
}

/**
 * Render overall analysis
 */
function renderOverallAnalysis(data: OverallAnalysisData): void {
  console.log('proofscan Analysis');
  console.log('==================');
  console.log();

  console.log(`Period: ${formatDate(data.period.start)} ~ ${formatDate(data.period.end)}`);
  console.log();

  console.log('Overview:');
  console.log(`  Connectors:   ${data.overview.connector_count}`);
  console.log(`  Sessions:     ${data.overview.session_count}`);
  console.log(`  RPC calls:    ${data.overview.rpc_count}`);
  console.log();

  if (data.by_connector.length > 0) {
    console.log('By Connector:');
    for (const conn of data.by_connector) {
      const sessions = String(conn.session_count).padStart(3);
      const rpcs = String(conn.rpc_count).padStart(4);
      console.log(`  ${conn.connector_id.padEnd(12)} ${sessions} sessions, ${rpcs} RPCs`);
    }
    console.log();
  }

  if (data.methods.length > 0) {
    console.log('Methods:');
    for (const m of data.methods) {
      console.log(`  ${m.method.padEnd(14)} ${m.count} calls`);
    }
    console.log();
  }

  if (data.tools_called.length > 0) {
    console.log('Tools Called (across all sessions):');
    for (const tool of data.tools_called.slice(0, 10)) {
      const countStr = tool.call_count === 1 ? '1 call' : `${tool.call_count} calls`;
      console.log(`  ${tool.name.padEnd(20)} ${countStr.padStart(8)}  (${tool.connector_id})`);
    }
    if (data.tools_called.length > 10) {
      console.log(`  ... and ${data.tools_called.length - 10} more`);
    }
    console.log();
  }

  // By category summary
  const totalCalls = Object.values(data.by_category).reduce((a, b) => a + b, 0);
  if (totalCalls > 0) {
    console.log('By Category:');
    for (const cat of CATEGORY_ORDER) {
      const count = data.by_category[cat];
      if (count > 0) {
        const pct = Math.round((count / totalCalls) * 100);
        console.log(`  ${getCategoryLabel(cat).padEnd(24)} ${count} calls (${pct}%)`);
      }
    }
  }
}

/**
 * Render connector analysis
 */
function renderConnectorAnalysis(data: ConnectorAnalysisData): void {
  console.log(`proofscan Analysis: ${data.connector_id}`);
  console.log('='.repeat(20 + data.connector_id.length));
  console.log();

  console.log(`Period: ${formatDate(data.period.start)} ~ ${formatDate(data.period.end)} (${data.session_count} sessions)`);
  console.log();

  // Available tools
  if (data.available_tools.length > 0) {
    console.log('Available Tools (from latest tools/list):');
    const toolsByCategory = groupByCategory(data.available_tools);
    for (const cat of CATEGORY_ORDER) {
      const tools = toolsByCategory[cat];
      if (tools.length > 0) {
        for (const tool of tools) {
          console.log(`  ${tool.name.padEnd(24)} ${getCategoryLabel(cat)}`);
        }
      }
    }
    console.log();
  }

  // Tool usage
  if (data.tool_usage.length > 0) {
    console.log(`Tool Usage (across ${data.session_count} sessions):`);
    for (const tool of data.tool_usage) {
      const countStr = tool.call_count === 1 ? '1 call' : `${tool.call_count} calls`;
      console.log(`  ${tool.name.padEnd(24)} ${countStr}`);
    }
    console.log();
  }

  // By category summary
  const totalCalls = Object.values(data.by_category).reduce((a, b) => a + b, 0);
  if (totalCalls > 0) {
    console.log('By Category:');
    for (const cat of CATEGORY_ORDER) {
      const count = data.by_category[cat];
      if (count > 0) {
        const pct = Math.round((count / totalCalls) * 100);
        console.log(`  ${getCategoryLabel(cat).padEnd(24)} ${count} calls (${pct}%)`);
      }
    }
  }
}

/**
 * Render session analysis (replaces permissions display)
 */
function renderSessionAnalysis(data: SessionAnalysisData): void {
  console.log(`${data.connector_id} (session: ${shortenId(data.session_id, 8)}...)`);
  console.log();

  for (const cat of CATEGORY_ORDER_FRIENDLY) {
    const stats = data.categories[cat];
    const label = getCategoryLabel(cat);

    // Category header
    console.log(t('analyze.section.header', { label }));

    // Permission/usage
    const hasPermission = stats.allowed_tool_count > 0;
    console.log(`  ${t('analyze.permission.label')}: ${hasPermission ? t('analyze.permission.allowed') : t('analyze.permission.denied')}`);
    console.log(`  ${t('analyze.usage.label')}: ${t('analyze.usage.count', { count: stats.called_count })}`);

    // Tool list
    if (stats.tools.length > 0) {
      console.log();
      for (const tool of stats.tools) {
        const allowedMark = tool.allowed ? '' : ` ${t('analyze.notAllowed')}`;
        console.log(`    ${tool.name}: ${t('analyze.usage.count', { count: tool.called })}${allowedMark}`);
      }
    }

    console.log();
  }

  // Totals
  console.log('─'.repeat(40));
  console.log(t('analyze.total', { allowed: data.totals.allowed_tool_count, count: data.totals.called_count }));
}

// ============================================================
// Command
// ============================================================

export function createAnalyzeCommand(getConfigPath: () => string): Command {
  const cmd = new Command('analyze')
    .description('Analyze tool usage across sessions and connectors')
    .addHelpText('after', `
Examples:
  pfscan analyze                    # Overall analysis
  pfscan analyze time               # Connector-level analysis
  pfscan analyze --session abc123   # Session-level analysis
  pfscan analyze --latest           # Latest session analysis
  pfscan analyze --json             # JSON output
`)
    .argument('[connector]', 'Connector ID for connector-level analysis')
    .option('--session <id>', 'Session ID for session-level analysis')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .action(async (connectorArg: string | undefined, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();
        const jsonMode = getOutputOptions().json;

        // Determine analysis mode
        if (options.session || options.latest) {
          // Session-level analysis (replaces permissions)
          const connectorId = connectorArg || options.connector;

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

          const data = generateSessionAnalysis(
            configDir,
            result.sessionId,
            result.connectorId,
            result.resolvedBy
          );

          if (jsonMode) {
            output(data);
          } else {
            renderSessionAnalysis(data);
          }
        } else if (connectorArg) {
          // Connector-level analysis
          const data = generateConnectorAnalysis(configDir, connectorArg);

          if (jsonMode) {
            output(data);
          } else {
            renderConnectorAnalysis(data);
          }
        } else {
          // Overall analysis
          const data = generateOverallAnalysis(configDir);

          if (jsonMode) {
            output(data);
          } else {
            renderOverallAnalysis(data);
          }
        }
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
