/**
 * Find Command for psh Shell
 *
 * Cross-session search without changing `ls` semantics.
 * Scope derived from cwd:
 *   /         => all connectors
 *   /<cid>:   => that connector's sessions
 *   /<cid>/<sid>: => that session only
 */

import type { ShellContext } from './types.js';
import type { PipelineValue, RpcRow, SessionRow, ConnectorRow } from './pipeline-types.js';
import { getContextLevel, type ContextLevel } from './router-commands.js';
import { EventLineStore } from '../eventline/store.js';
import { ConfigManager } from '../config/index.js';

/** Find command options */
export interface FindOptions {
  kind: 'session' | 'rpc' | 'event';
  limit: number;
  sessions: number;
  errorsOnly: boolean;
}

/** Default options */
const DEFAULT_OPTIONS: FindOptions = {
  kind: 'rpc',
  limit: 200,
  sessions: 50,
  errorsOnly: false,
};

/** Find result type */
export type FindResult =
  | { ok: true; result: PipelineValue; stats: { count: number; sessions: number } }
  | { ok: false; error: string }
  | { ok: false; error: string; help: true };

/** Help text for find command */
const FIND_HELP = `find - cross-session search

Usage: find <kind> [options]

Kinds:
  session     List sessions across scope
  rpc         List RPC calls across sessions
  event       List events (not yet implemented)

Options:
  --limit N        Max rows to return (default: 200)
  --sessions N     Max sessions to search (default: 50)
  --errors-only    Only return error RPCs
  -h, --help       Show this help

Scope (derived from cwd):
  /                All connectors
  /<connector>:    That connector's sessions
  /<conn>/<sess>:  That session only

Examples:
  find rpc                           All RPCs in current scope
  find rpc --errors-only             Only errors
  find rpc --limit 50 --sessions 10  Limit results
  find rpc | where tools.name ~= "read"   Chain with filter
  find session --limit 10            Latest sessions`;

/**
 * Parse find command arguments
 *
 * Usage: find <kind> [--limit N] [--sessions N] [--errors-only]
 */
export function parseFindArgs(args: string[]): { ok: true; options: FindOptions } | { ok: false; error: string; help?: true } {
  const options: FindOptions = { ...DEFAULT_OPTIONS };

  // Handle help flags first
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    return { ok: false, error: FIND_HELP, help: true };
  }

  let i = 0;

  const kindArg = args[0].toLowerCase();
  if (!['session', 'rpc', 'event'].includes(kindArg)) {
    return { ok: false, error: `Invalid kind: ${args[0]}. Must be one of: session, rpc, event` };
  }
  options.kind = kindArg as 'session' | 'rpc' | 'event';
  i++;

  // Parse optional flags
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--limit') {
      const val = args[++i];
      if (!val || isNaN(parseInt(val, 10))) {
        return { ok: false, error: '--limit requires a number' };
      }
      const limitVal = parseInt(val, 10);
      if (limitVal <= 0) {
        return { ok: false, error: '--limit must be a positive number' };
      }
      options.limit = limitVal;
    } else if (arg === '--sessions') {
      const val = args[++i];
      if (!val || isNaN(parseInt(val, 10))) {
        return { ok: false, error: '--sessions requires a number' };
      }
      const sessionsVal = parseInt(val, 10);
      if (sessionsVal <= 0) {
        return { ok: false, error: '--sessions must be a positive number' };
      }
      options.sessions = sessionsVal;
    } else if (arg === '--errors-only') {
      options.errorsOnly = true;
    } else if (arg.startsWith('-')) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }

    i++;
  }

  return { ok: true, options };
}

/**
 * Execute find command
 *
 * Loads rows from multiple sessions based on scope and options.
 */
export function executeFind(
  context: ShellContext,
  configPath: string,
  options: FindOptions
): FindResult {
  const manager = new ConfigManager(configPath);
  const store = new EventLineStore(manager.getConfigDir());
  const level = getContextLevel(context);

  // Determine scope
  const scope = determineScope(level, context);

  // Load rows based on kind
  switch (options.kind) {
    case 'session':
      return findSessions(store, scope, options);
    case 'rpc':
      return findRpcs(store, scope, options, configPath);
    case 'event':
      // Event kind is reserved for future implementation
      return { ok: false, error: 'Event kind is not yet implemented' };
    default:
      return { ok: false, error: `Unknown kind: ${options.kind}` };
  }
}

/**
 * Scope for find command
 */
interface FindScope {
  level: ContextLevel;
  connectorId?: string;
  sessionId?: string;
}

/**
 * Determine search scope from context
 */
function determineScope(level: ContextLevel, context: ShellContext): FindScope {
  return {
    level,
    connectorId: context.connector,
    sessionId: context.session,
  };
}

/**
 * Find sessions across scope
 */
function findSessions(
  store: EventLineStore,
  scope: FindScope,
  options: FindOptions
): FindResult {
  const rows: SessionRow[] = [];
  let sessionCount = 0;

  if (scope.level === 'session' && scope.sessionId) {
    // Session level - return just this session info
    const sessions = store.getSessions(scope.connectorId, options.sessions);
    const session = sessions.find(s => s.session_id === scope.sessionId);
    if (session) {
      rows.push({
        session_id: session.session_id,
        connector_id: scope.connectorId!,
        started_at: session.started_at ?? '',
        ended_at: session.ended_at ?? null,
        event_count: session.event_count ?? 0,
        rpc_count: session.rpc_count ?? 0,
      });
      sessionCount = 1;
    }
  } else if (scope.level === 'connector' && scope.connectorId) {
    // Connector level - return sessions for this connector
    const sessions = store.getSessions(scope.connectorId, options.sessions);
    for (const session of sessions) {
      if (rows.length >= options.limit) break;
      rows.push({
        session_id: session.session_id,
        connector_id: scope.connectorId,
        started_at: session.started_at ?? '',
        ended_at: session.ended_at ?? null,
        event_count: session.event_count ?? 0,
        rpc_count: session.rpc_count ?? 0,
      });
    }
    sessionCount = sessions.length;
  } else {
    // Root level - return sessions across all connectors
    const connectors = store.getConnectors();
    for (const connector of connectors) {
      if (rows.length >= options.limit) break;
      const sessions = store.getSessions(connector.id, options.sessions);
      for (const session of sessions) {
        if (rows.length >= options.limit) break;
        rows.push({
          session_id: session.session_id,
          connector_id: connector.id,
          started_at: session.started_at ?? '',
          ended_at: session.ended_at ?? null,
          event_count: session.event_count ?? 0,
          rpc_count: session.rpc_count ?? 0,
        });
      }
      sessionCount += sessions.length;
    }
  }

  return {
    ok: true,
    result: { kind: 'rows', rows, rowType: 'session' },
    stats: { count: rows.length, sessions: sessionCount },
  };
}

/**
 * Extract tool name from request JSON.
 * Fallback chain: params.name ?? params.tool ?? params.toolName
 */
function extractToolName(rawJson: string | null | undefined): string | undefined {
  if (!rawJson) return undefined;

  try {
    const parsed = JSON.parse(rawJson);
    const params = parsed?.params;
    if (!params || typeof params !== 'object') return undefined;

    if (typeof params.name === 'string' && params.name.length > 0) {
      return params.name;
    }
    if (typeof params.tool === 'string' && params.tool.length > 0) {
      return params.tool;
    }
    if (typeof params.toolName === 'string' && params.toolName.length > 0) {
      return params.toolName;
    }
  } catch {
    // JSON parse error
  }

  return undefined;
}

/**
 * Find RPCs across scope
 */
function findRpcs(
  store: EventLineStore,
  scope: FindScope,
  options: FindOptions,
  _configPath: string
): FindResult {
  const rows: RpcRow[] = [];
  let sessionCount = 0;

  // Collect session IDs to search
  const sessionIds: Array<{ sessionId: string; connectorId: string }> = [];

  if (scope.level === 'session' && scope.sessionId && scope.connectorId) {
    // Session level - search only this session
    sessionIds.push({ sessionId: scope.sessionId, connectorId: scope.connectorId });
  } else if (scope.level === 'connector' && scope.connectorId) {
    // Connector level - search sessions for this connector
    const sessions = store.getSessions(scope.connectorId, options.sessions);
    for (const session of sessions) {
      sessionIds.push({ sessionId: session.session_id, connectorId: scope.connectorId });
    }
  } else {
    // Root level - search across all connectors
    const connectors = store.getConnectors();
    for (const connector of connectors) {
      const sessions = store.getSessions(connector.id, options.sessions);
      for (const session of sessions) {
        sessionIds.push({ sessionId: session.session_id, connectorId: connector.id });
      }
    }
  }

  sessionCount = sessionIds.length;

  // Load RPCs from each session
  for (const { sessionId, connectorId } of sessionIds) {
    if (rows.length >= options.limit) break;

    const rpcs = store.getRpcCalls(sessionId);

    // Build tool name map for tools/call RPCs in this session (batch lookup)
    // This avoids N+1 query pattern by fetching raw events once per session
    const toolsCallRpcIds = rpcs
      .filter(rpc => rpc.method === 'tools/call')
      .map(rpc => rpc.rpc_id);

    const toolNameMap = new Map<string, string>();
    if (toolsCallRpcIds.length > 0) {
      // Build tool name map for all tools/call RPCs in this session
      // Note: getRawEvent internally fetches all session events, so subsequent
      // calls for the same session benefit from SQLite's page cache
      for (const rpcId of toolsCallRpcIds) {
        const event = store.getRawEvent(sessionId, rpcId);
        if (event?.request?.raw_json) {
          const toolName = extractToolName(event.request.raw_json);
          if (toolName) {
            toolNameMap.set(rpcId, toolName);
          }
        }
      }
    }

    for (const rpc of rpcs) {
      if (rows.length >= options.limit) break;

      // Determine status
      let status: 'OK' | 'ERR' | 'pending';
      if (rpc.success === 1) {
        status = 'OK';
      } else if (rpc.success === 0) {
        status = 'ERR';
      } else {
        status = 'pending';
      }

      // Filter errors only
      if (options.errorsOnly && status !== 'ERR') {
        continue;
      }

      // Calculate latency
      let latency_ms: number | null = null;
      if (rpc.request_ts && rpc.response_ts) {
        const requestTime = new Date(rpc.request_ts).getTime();
        const responseTime = new Date(rpc.response_ts).getTime();
        latency_ms = responseTime - requestTime;
      }

      // Get tool_name from pre-built map (avoids N+1 query)
      const tool_name = toolNameMap.get(rpc.rpc_id);

      rows.push({
        rpc_id: rpc.rpc_id,
        session_id: rpc.session_id,
        connector_id: connectorId,
        method: rpc.method,
        status,
        latency_ms,
        request_ts: rpc.request_ts,
        response_ts: rpc.response_ts ?? null,
        error_code: rpc.error_code ?? null,
        tool_name,
      });
    }
  }

  return {
    ok: true,
    result: { kind: 'rows', rows, rowType: 'rpc' },
    stats: { count: rows.length, sessions: sessionCount },
  };
}
