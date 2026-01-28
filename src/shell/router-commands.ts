/**
 * Router-style commands: cd, ls, show, ..
 *
 * These commands provide a router-cli inspired navigation experience
 * for exploring connectors, sessions, and RPC calls.
 */

import type { ShellContext, ProtoType } from './types.js';
import { PIPELINE_SESSION_LIMIT } from './types.js';
import { printSuccess, printError, printInfo, shortenSessionId } from './prompt.js';
import { selectSession, canInteract } from './selector.js';
import { EventLineStore } from '../eventline/store.js';
import { EventsStore } from '../db/events-store.js';
import { ConfigManager } from '../config/index.js';
import { setCurrentSession, clearCurrentSession, formatRelativeTime } from '../utils/index.js';
import {
  createRefFromContext,
  refToJson,
  parseRef,
  isRef,
  RefResolver,
  createRefDataProvider,
  type RefStruct,
} from './ref-resolver.js';

// ProtoType is imported from types.ts

/**
 * Detect protocol type from session events
 *
 * Detection priority (intentional):
 * 1. MCP - Check first because MCP is more common and has clear markers (initialize, tools/*)
 * 2. A2A - Check second for a2a.* or agent.* method patterns
 * 3. Unknown (?) - Default when no protocol markers are found
 *
 * Note: If a session has both MCP and A2A methods, it will be classified as MCP.
 * This is intentional as mixed-protocol sessions are rare and MCP is the primary use case.
 */
export function detectProto(store: EventLineStore, sessionId: string): ProtoType {
  try {
    const rpcs = store.getRpcCalls(sessionId);

    const allMethods = new Set<string>();
    // RpcCall has 'method' property
    rpcs.forEach(r => allMethods.add(r.method));

    // MCP detection: initialize + tools/list (checked first - higher priority)
    const hasMcpInit = allMethods.has('initialize');
    const hasMcpTools = allMethods.has('tools/list') || allMethods.has('tools/call');
    if (hasMcpInit || hasMcpTools) {
      return 'mcp';
    }

    // A2A detection: a2a.* or agent.* methods
    for (const method of allMethods) {
      if (method.startsWith('a2a.') || method.startsWith('agent.')) {
        return 'a2a';
      }
    }

    return '?';
  } catch {
    // Return unknown on any error (e.g., DB access failure)
    // This is intentional to avoid blocking navigation due to proto detection errors
    return '?';
  }
}

/**
 * Detect protocol for a connector (uses latest session)
 */
export function detectConnectorProto(store: EventLineStore, connectorId: string): ProtoType {
  try {
    const sessions = store.getSessions(connectorId, 1);
    if (sessions.length === 0) {
      return '?';
    }
    return detectProto(store, sessions[0].session_id);
  } catch {
    return '?';
  }
}

/**
 * Get the EventLineStore instance
 */
function getStore(configPath: string): EventLineStore {
  const manager = new ConfigManager(configPath);
  return new EventLineStore(manager.getConfigDir());
}

/**
 * Context level for navigation
 */
export type ContextLevel = 'root' | 'connector' | 'session';

/**
 * Get current context level
 */
export function getContextLevel(context: ShellContext): ContextLevel {
  if (context.session) return 'session';
  if (context.connector) return 'connector';
  return 'root';
}

// Constants for query limits
const MAX_SESSIONS_SEARCH = 100;
const MAX_INTERACTIVE_OPTIONS = 20;
const MAX_AMBIGUOUS_DISPLAY = 5;

/**
 * Session match result for selection
 */
interface SessionMatch {
  session_id: string;
  target_id: string | null;
}

/**
 * Save current location as previous (for cd - navigation)
 *
 * This function stores the current connector and session before navigation,
 * allowing users to return to the previous location with `cd -`.
 *
 * @param context - The shell context to update
 */
function savePreviousLocation(context: ShellContext): void {
  context.previousConnector = context.connector;
  context.previousSession = context.session;
}

/**
 * Handle session selection from matches
 *
 * This helper extracts the common session selection logic:
 * - If exactly one match, select it
 * - If multiple matches and interactive, show selection UI
 * - If multiple matches and non-interactive, show error with list
 *
 * @returns true if a session was selected, false otherwise
 */
async function selectSessionFromMatches(
  matches: SessionMatch[],
  prefix: string,
  context: ShellContext,
  store: EventLineStore,
  targetId: string
): Promise<boolean> {
  if (matches.length === 1) {
    savePreviousLocation(context);
    context.session = matches[0].session_id;
    context.connector = targetId;
    context.proto = detectProto(store, matches[0].session_id);
    setCurrentSession(matches[0].session_id, targetId);
    printSuccess(`→ /${targetId}/${shortenSessionId(matches[0].session_id)}`);
    return true;
  }

  if (canInteract()) {
    printInfo(`Multiple sessions match "${prefix}". Select one:`);
    const selected = await selectSession(
      matches.slice(0, MAX_INTERACTIVE_OPTIONS).map(s => ({ id: s.session_id, connector_id: s.target_id }))
    );
    if (selected) {
      savePreviousLocation(context);
      context.session = selected;
      context.connector = targetId;
      context.proto = detectProto(store, selected);
      setCurrentSession(selected, targetId);
      printSuccess(`→ /${targetId}/${shortenSessionId(selected)}`);
      return true;
    }
  } else {
    printError(`Ambiguous session prefix: ${prefix}`);
    matches.slice(0, MAX_AMBIGUOUS_DISPLAY).forEach(s => {
      console.log(`  ${shortenSessionId(s.session_id)}`);
    });
  }
  return false;
}

/**
 * Handle 'cc' command - change context
 *
 * cc              - Go to latest session (home)
 * cc /            - Go to root
 * cc ..           - Go up one level
 * cc ../..        - Go up multiple levels
 * cc -            - Go to previous location
 * cc <connector>  - Go to connector context
 * cc <session>    - Go to session (within connector context)
 * cc conn|sess    - Go directly to session
 */
export async function handleCc(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  const store = getStore(configPath);

  // cc / - go to root
  if (args[0] === '/') {
    savePreviousLocation(context);
    context.connector = undefined;
    context.session = undefined;
    context.proto = undefined;
    clearCurrentSession();
    printSuccess('→ /');
    return;
  }

  // cc .. or cc ../.. - go up one or more levels
  if (args[0]?.startsWith('..')) {
    const parts = args[0].split('/');
    // Validate: only '..' and empty strings (from leading/trailing slashes) are valid
    const invalidParts = parts.filter(p => p !== '..' && p !== '');
    if (invalidParts.length > 0) {
      printError(`Invalid path: ${args[0]} (invalid: ${invalidParts.join(', ')})`);
      printInfo('Use: cd .. or cd ../.. to go up levels');
      return;
    }

    savePreviousLocation(context);
    const upCount = parts.filter(p => p === '..').length;

    for (let i = 0; i < upCount; i++) {
      const level = getContextLevel(context);
      if (level === 'session') {
        context.session = undefined;
        setCurrentSession('', context.connector);
      } else if (level === 'connector') {
        context.connector = undefined;
        context.session = undefined;
        context.proto = undefined;
        clearCurrentSession();
      } else {
        // Already at root
        break;
      }
    }

    // Print current location
    if (context.session) {
      printSuccess(`→ /${context.connector}/${shortenSessionId(context.session)}`);
    } else if (context.connector) {
      printSuccess(`→ /${context.connector}`);
    } else {
      printSuccess('→ /');
    }
    return;
  }

  // cc - : go to previous location
  if (args[0] === '-') {
    if (!context.previousConnector && !context.previousSession) {
      printInfo('No previous location');
      return;
    }

    // Swap current and previous
    const currentConnector = context.connector;
    const currentSession = context.session;

    context.connector = context.previousConnector;
    context.session = context.previousSession;
    context.previousConnector = currentConnector;
    context.previousSession = currentSession;

    // Update proto for new location
    if (context.session) {
      context.proto = detectProto(store, context.session);
      setCurrentSession(context.session, context.connector);
      printSuccess(`→ /${context.connector}/${shortenSessionId(context.session)}`);
    } else if (context.connector) {
      context.proto = detectConnectorProto(store, context.connector);
      setCurrentSession('', context.connector);
      printSuccess(`→ /${context.connector}`);
    } else {
      context.proto = undefined;
      clearCurrentSession();
      printSuccess('→ /');
    }
    return;
  }

  // cc (no args) - go to "home" (latest session)
  if (args.length === 0) {
    const level = getContextLevel(context);

    if (level === 'session') {
      printInfo('Already at session context');
      return;
    }

    // Get latest session (optionally filtered by current target)
    const sessions = store.getSessions(context.connector, 1);
    if (sessions.length === 0) {
      if (context.connector) {
        printError(`No sessions for connector: ${context.connector}`);
        printInfo('Run: plans run basic-mcp');
      } else {
        printError('No sessions yet');
        printInfo('Run: plans run basic-mcp --connector <id>');
      }
      return;
    }

    const latestSession = sessions[0];
    savePreviousLocation(context);
    context.session = latestSession.session_id;
    context.connector = latestSession.connector_id;
    context.proto = detectProto(store, latestSession.session_id);
    setCurrentSession(latestSession.session_id, latestSession.connector_id);
    printSuccess(`→ /${latestSession.connector_id}/${shortenSessionId(latestSession.session_id)}`);
    return;
  }

  // Parse argument - could be <connector>, <session>, <connector>/<session>, or @ref
  const arg = args[0];

  // Handle @ references (e.g., @last, @ref:name, @session:abc)
  if (isRef(arg)) {
    const manager = new ConfigManager(configPath);
    const eventsStore = new EventsStore(manager.getConfigDir());
    const dataProvider = createRefDataProvider(eventsStore);
    const resolver = new RefResolver(dataProvider);

    const result = resolver.resolve(arg, context);
    if (!result.success || !result.ref) {
      printError(result.error || `Failed to resolve reference: ${arg}`);
      return;
    }

    const ref = result.ref;

    // Navigate based on ref kind
    if (ref.kind === 'rpc') {
      // For RPC refs, navigate to the containing session
      if (!ref.session || !ref.target) {
        printError(`Cannot navigate to RPC reference: missing session/connector`);
        printInfo(`Use: show ${arg} to view RPC details`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.target;
      context.session = ref.session;
      context.proto = detectProto(store, ref.session);
      setCurrentSession(ref.session, ref.target);
      printSuccess(`→ /${ref.target}/${shortenSessionId(ref.session)}`);
      printInfo(`(navigated to session containing RPC)`);
      return;
    }

    if (ref.kind === 'session') {
      if (!ref.session || !ref.target) {
        printError(`Invalid session reference: missing session/connector`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.target;
      context.session = ref.session;
      context.proto = detectProto(store, ref.session);
      setCurrentSession(ref.session, ref.target);
      printSuccess(`→ /${ref.target}/${shortenSessionId(ref.session)}`);
      return;
    }

    if (ref.kind === 'connector') {
      if (!ref.target) {
        printError(`Invalid connector reference: missing connector`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.target;
      context.session = undefined;
      context.proto = detectConnectorProto(store, ref.target);
      setCurrentSession('', ref.target);
      printSuccess(`→ /${ref.target}`);
      return;
    }

    if (ref.kind === 'context') {
      // Root context - go to root
      savePreviousLocation(context);
      context.connector = undefined;
      context.session = undefined;
      context.proto = undefined;
      clearCurrentSession();
      printSuccess('→ /');
      return;
    }

    printError(`Cannot navigate to ${ref.kind} reference`);
    return;
  }

  // Check for connector/session format (or legacy connector|session)
  if (arg.includes('/') || arg.includes('|')) {
    const separator = arg.includes('/') ? '/' : '|';
    const [connectorPart, sessionPart] = arg.split(separator, 2);

    // Handle absolute path: /connectorId (e.g., cd /time)
    if (separator === '/' && connectorPart === '') {
      // Absolute path: sessionPart is actually the connector ID
      const absoluteTarget = sessionPart;

      // Validate absoluteTarget is not empty (handles "cd //" case)
      if (!absoluteTarget || absoluteTarget.trim() === '') {
        printError('Invalid path: empty connector ID');
        printInfo('Use: cd /connector or cd /connector/session');
        return;
      }

      // Validate against path traversal attempts (e.g., /.. or /../foo)
      if (absoluteTarget.includes('..')) {
        printError('Invalid path: path traversal not allowed');
        printInfo('Use: cd /connector or cd /connector/session');
        return;
      }

      // Check if target contains another / (i.e., /connector/session)
      // Split into segments and filter empty parts (handles multiple slashes like ///)
      const segments = absoluteTarget.split('/').filter(s => s !== '');
      if (segments.length > 2) {
        printError('Invalid path format: too many segments');
        printInfo('Use: cd /connector or cd /connector/session');
        return;
      }

      if (segments.length === 2) {
        const [absConnector, absSession] = segments;

        // Find connector
        const connectors = store.getConnectors();
        const connector = connectors.find(c => c.id === absConnector || c.id.startsWith(absConnector));
        if (!connector) {
          printError(`Connector not found: ${absConnector}`);
          const available = connectors.map(c => c.id);
          if (available.length > 0) {
            printInfo(`Available connectors: ${available.join(', ')}`);
          }
          return;
        }

        // Find session by prefix
        const sessions = store.getSessions(connector.id, MAX_SESSIONS_SEARCH);
        const matches = sessions.filter(s => s.session_id.startsWith(absSession));

        if (matches.length === 0) {
          printError(`Session not found: ${absSession}`);
          return;
        }

        await selectSessionFromMatches(matches, absSession, context, store, connector.id);
        return;
      }

      // Just /connectorId - navigate to connector (segments.length === 1)
      const absConnectorId = segments[0];
      const connectors = store.getConnectors();
      const connector = connectors.find(c => c.id === absConnectorId || c.id.startsWith(absConnectorId));
      if (!connector) {
        printError(`Connector not found: ${absConnectorId}`);
        const available = connectors.map(c => c.id);
        if (available.length > 0) {
          printInfo(`Available connectors: ${available.join(', ')}`);
        }
        return;
      }

      savePreviousLocation(context);
      context.connector = connector.id;
      context.session = undefined;
      context.proto = detectConnectorProto(store, connector.id);
      setCurrentSession('', connector.id);
      printSuccess(`→ /${connector.id}`);
      return;
    }

    // Validate separated format (relative path: connector/session)
    if (!connectorPart || !sessionPart) {
      printError(`Invalid format: ${arg}`);
      printInfo('Use: cd connector/session or connector|session (e.g., mcp/abc12345)');
      return;
    }

    // Validate connector exists
    const connectors = store.getConnectors();
    const connector = connectors.find(c => c.id === connectorPart || c.id.startsWith(connectorPart));
    if (!connector) {
      printError(`Connector not found: ${connectorPart}`);
      return;
    }

    // Find session by prefix
    const sessions = store.getSessions(connector.id, MAX_SESSIONS_SEARCH);
    const matches = sessions.filter(s => s.session_id.startsWith(sessionPart));

    if (matches.length === 0) {
      printError(`Session not found: ${sessionPart}`);
      return;
    }

    await selectSessionFromMatches(matches, sessionPart, context, store, connector.id);
    return;
  }

  // At root: arg is a connector
  // At connector: arg is a session prefix
  const level = getContextLevel(context);

  if (level === 'root') {
    // Treat as connector - search both history and config
    const historyConnectors = store.getConnectors();
    const manager = new ConfigManager(configPath);
    const configuredConnectors = await manager.getConnectors();

    // Merge IDs from both sources (deduplicated)
    const allConnectorIds = new Set([
      ...historyConnectors.map(c => c.id),
      ...configuredConnectors.map(c => c.id),
    ]);

    // Find matching connector (exact match first, then prefix)
    let matchId: string | undefined;
    for (const id of allConnectorIds) {
      if (id === arg) {
        matchId = id;
        break;
      }
    }
    if (!matchId) {
      for (const id of allConnectorIds) {
        if (id.startsWith(arg)) {
          matchId = id;
          break;
        }
      }
    }

    if (!matchId) {
      printError(`Connector not found: ${arg}`);
      printInfo('Available: ' + [...allConnectorIds].join(', '));
      return;
    }

    savePreviousLocation(context);
    context.connector = matchId;
    context.session = undefined;
    // Proto detection will return '?' for connectors with no history (config-only)
    context.proto = detectConnectorProto(store, matchId);
    setCurrentSession('', matchId);
    printSuccess(`→ /${matchId}`);
    return;
  }

  if (level === 'connector' || level === 'session') {
    // At connector or session level - treat arg as session prefix
    // Runtime check for connector (should always be set at these levels)
    if (!context.connector) {
      printError('No connector in context');
      return;
    }

    const sessions = store.getSessions(context.connector, MAX_SESSIONS_SEARCH);
    const matches = sessions.filter(s => s.session_id.startsWith(arg));

    if (matches.length === 0) {
      printError(`Session not found: ${arg}`);
      return;
    }

    await selectSessionFromMatches(matches, arg, context, store, context.connector);
    return;
  }
}

/**
 * Handle '..' command - go up one level
 */
export function handleUp(context: ShellContext): void {
  const level = getContextLevel(context);

  if (level === 'session') {
    savePreviousLocation(context);
    context.session = undefined;
    setCurrentSession('', context.connector);
    printSuccess(`→ /${context.connector}`);
    return;
  }

  if (level === 'connector') {
    savePreviousLocation(context);
    context.connector = undefined;
    context.session = undefined;
    context.proto = undefined;
    clearCurrentSession();
    printSuccess('→ /');
    return;
  }

  printInfo('Already at root');
}

/**
 * Handle 'pwd' command - show current context with copyable path
 *
 * Options:
 *   --json  Output RefStruct as JSON (for piping to ref add)
 */
export function handlePwd(context: ShellContext, configPath: string, args: string[] = []): void {
  const isJson = args.includes('--json');
  const level = getContextLevel(context);
  const store = getStore(configPath);

  // --json: Output RefStruct for piping
  if (isJson) {
    // Update context.proto for accurate output
    if (level === 'session' && context.session) {
      context.proto = detectProto(store, context.session);
    } else if (level === 'connector' && context.connector) {
      context.proto = detectConnectorProto(store, context.connector);
    }

    const ref = createRefFromContext(context);
    console.log(refToJson(ref));
    return;
  }

  // Default: human-readable output
  console.log();
  console.log('Current context:');

  if (level === 'root') {
    console.log('  Level: root');
    console.log('  Path: /');
  } else if (level === 'connector' && context.connector) {
    const proto = detectConnectorProto(store, context.connector);
    console.log(`  Level: connector`);
    console.log(`  Connector: ${context.connector}`);
    console.log(`  Proto: ${proto}`);
    console.log(`  Path: ${context.connector}`);
  } else if (level === 'session' && context.connector && context.session) {
    const proto = detectProto(store, context.session);
    console.log(`  Level: session`);
    console.log(`  Connector: ${context.connector}`);
    console.log(`  Session: ${shortenSessionId(context.session)}`);
    console.log(`  Proto: ${proto}`);
    console.log(`  Path: ${context.connector}|${shortenSessionId(context.session)}`);
  }
  console.log();
}

/**
 * Handle 'ls' command - list items at current level
 *
 * root: list connectors
 * connector: list sessions
 * session: list rpc calls
 */
export async function handleLs(
  args: string[],
  context: ShellContext,
  configPath: string,
  executeCommand: (tokens: string[]) => Promise<void>
): Promise<void> {
  const level = getContextLevel(context);
  const isLong = args.includes('-l') || args.includes('--long');
  const isJson = args.includes('--json');
  const idsOnly = args.includes('--ids');

  const store = getStore(configPath);

  if (level === 'root') {
    // List connectors with proto
    await listConnectors(store, configPath, isLong, isJson, idsOnly);
    return;
  }

  if (level === 'connector') {
    // List sessions for current connector
    if (!context.connector) {
      printError('No connector in context');
      return;
    }
    await listSessions(store, context.connector, isLong, isJson, idsOnly);
    return;
  }

  // Session level - list RPC calls
  if (!context.session) {
    printError('No session in context');
    return;
  }
  await listRpcs(store, context.session, isLong, isJson, idsOnly, executeCommand);
}

/**
 * List connectors at root level (router-style table)
 * Merges connectors from both config.json and events.db (scan history)
 */
async function listConnectors(
  store: EventLineStore,
  configPath: string,
  _isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  // Get connectors from history (events.db)
  const historyConnectors = store.getConnectors();
  const historyMap = new Map(historyConnectors.map(c => [c.id, c]));

  // Get configured connectors (config.json)
  const manager = new ConfigManager(configPath);
  const configuredConnectors = await manager.getConnectors();
  const configuredIds = new Set(configuredConnectors.map(c => c.id));

  // Build merged connector list:
  // - All connectors from history (with configured flag)
  // - Plus config-only connectors that have no history yet
  interface MergedConnector {
    id: string;
    session_count: number;
    latest_session: string | null;
    configured: boolean;
    hasHistory: boolean;
  }

  const mergedConnectors: MergedConnector[] = [];

  // Add all history connectors
  for (const c of historyConnectors) {
    mergedConnectors.push({
      id: c.id,
      session_count: c.session_count,
      latest_session: c.latest_session ?? null,
      configured: configuredIds.has(c.id),
      hasHistory: true,
    });
  }

  // Add config-only connectors (not in history)
  for (const c of configuredConnectors) {
    if (!historyMap.has(c.id)) {
      mergedConnectors.push({
        id: c.id,
        session_count: 0,
        latest_session: null,
        configured: true,
        hasHistory: false,
      });
    }
  }

  if (mergedConnectors.length === 0) {
    printInfo('No connectors found. Add one with: connectors add --id <id> --command <cmd>');
    return;
  }

  if (isJson) {
    const data = mergedConnectors.map(c => ({
      id: c.id,
      proto: c.hasHistory ? detectConnectorProto(store, c.id) : '?',
      sessions: c.session_count,
      latest: c.latest_session,
      configured: c.configured,
      hasHistory: c.hasHistory,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (idsOnly) {
    mergedConnectors.forEach(c => console.log(c.id));
    return;
  }

  // Router-style table format
  const isTTY = process.stdout.isTTY;
  const data = mergedConnectors.map(c => ({
    id: c.id,
    proto: c.hasHistory ? detectConnectorProto(store, c.id) : '?',
    sessions: c.session_count,
    latest: c.latest_session ? formatRelativeTime(c.latest_session) : '-',
    configured: c.configured,
    hasHistory: c.hasHistory,
  }));

  // Calculate column widths (account for markers)
  // Markers: ' *' for history-only, ' +' for config-only (no history)
  const maxId = Math.max(12, ...data.map(d => d.id.length + 2));

  console.log();

  // Header (always show in table format)
  console.log(
    dimText('ID', isTTY).padEnd(isTTY ? maxId + 9 : maxId) + '  ' +
    dimText('Proto', isTTY).padEnd(isTTY ? 14 : 5) + '  ' +
    dimText('Sessions', isTTY).padEnd(isTTY ? 17 : 8) + '  ' +
    dimText('Last Activity', isTTY)
  );
  console.log(dimText('-'.repeat(maxId + 40), isTTY));

  // Rows
  data.forEach(d => {
    const protoColor = getProtoColor(d.proto, isTTY);

    // Determine marker:
    // - No marker if configured + has history (normal state)
    // - ' *' if history-only (not in config)
    // - ' +' if config-only (no history yet, ready for scan)
    let marker = '';
    if (!d.configured) {
      marker = isTTY ? ' \x1b[2m*\x1b[0m' : ' *';
    } else if (!d.hasHistory) {
      marker = isTTY ? ' \x1b[33m+\x1b[0m' : ' +';
    }
    const idDisplay = d.id + marker;

    console.log(
      idDisplay.padEnd(isTTY ? maxId + (marker ? 7 : 0) : maxId) + '  ' +
      protoColor.padEnd(isTTY ? 14 : 5) + '  ' +
      String(d.sessions).padEnd(8) + '  ' +
      d.latest
    );
  });

  // Show legend
  const hasHistoryOnly = data.some(d => !d.configured);
  const hasConfigOnly = data.some(d => !d.hasHistory);
  if (hasHistoryOnly || hasConfigOnly) {
    console.log();
    if (hasConfigOnly) {
      printInfo('+ = ready (run: plans run basic-mcp)');
    }
    if (hasHistoryOnly) {
      printInfo('* = history only (not in config)');
    }
  }

  console.log();
  printInfo(`Hint: cd <connector> to enter, show <connector> for details`);
}

/**
 * List sessions for a target (router-style table)
 */
async function listSessions(
  store: EventLineStore,
  targetId: string,
  _isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  const sessions = store.getSessions(targetId, 50);

  if (sessions.length === 0) {
    printInfo(`No sessions for target: ${targetId}`);
    printInfo('Run: plans run basic-mcp');
    return;
  }

  if (isJson) {
    const data = sessions.map(s => ({
      id: s.session_id,
      prefix: shortenSessionId(s.session_id),
      started_at: s.started_at,
      event_count: s.event_count,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (idsOnly) {
    sessions.forEach(s => console.log(shortenSessionId(s.session_id)));
    return;
  }

  // Router-style table format
  const isTTY = process.stdout.isTTY;

  console.log();

  // Header
  console.log(
    dimText('Session', isTTY).padEnd(isTTY ? 19 : 10) + '  ' +
    dimText('Started', isTTY).padEnd(isTTY ? 21 : 12) + '  ' +
    dimText('Events', isTTY)
  );
  console.log(dimText('-'.repeat(40), isTTY));

  // Rows
  sessions.forEach(s => {
    const prefix = shortenSessionId(s.session_id);
    const started = s.started_at ? formatRelativeTime(s.started_at) : '-';
    console.log(
      prefix.padEnd(10) + '  ' +
      started.padEnd(12) + '  ' +
      String(s.event_count)
    );
  });

  console.log();
  printInfo('Hint: cd <session> to enter, show <session> for details, cd .. to go back');
}

/**
 * List RPC calls for a session
 */
async function listRpcs(
  _store: EventLineStore,
  sessionId: string,
  _isLong: boolean,
  isJson: boolean,
  _idsOnly: boolean,
  executeCommand: (tokens: string[]) => Promise<void>
): Promise<void> {
  // Use existing rpc list command
  const args = ['rpc', 'list', '--session', sessionId];
  if (isJson) args.push('--json');
  await executeCommand(args);

  // Show hint for navigation
  printInfo('Hint: show <id> to view details, cd .. to go back');
}

/**
 * Extract HTML export options from args
 */
function getHtmlOptions(args: string[]): string[] {
  const options: string[] = [];
  const outIdx = args.indexOf('--out');
  if (outIdx !== -1 && args[outIdx + 1]) {
    options.push('--out', args[outIdx + 1]);
  }
  const embedIdx = args.indexOf('--embed-max-bytes');
  if (embedIdx !== -1 && args[embedIdx + 1]) {
    options.push('--embed-max-bytes', args[embedIdx + 1]);
  }
  const maxSessionsIdx = args.indexOf('--max-sessions');
  if (maxSessionsIdx !== -1 && args[maxSessionsIdx + 1]) {
    options.push('--max-sessions', args[maxSessionsIdx + 1]);
  }
  const offsetIdx = args.indexOf('--offset');
  if (offsetIdx !== -1 && args[offsetIdx + 1]) {
    options.push('--offset', args[offsetIdx + 1]);
  }
  if (args.includes('--html')) options.push('--html');
  if (args.includes('--open')) options.push('--open');
  if (args.includes('--redact')) options.push('--redact');
  if (args.includes('--spill')) options.push('--spill');
  return options;
}

/**
 * Handle 'show' command - show details at current level
 *
 * Supports @ references:
 *   show @last      - show latest session/RPC
 *   show @rpc:abc   - show specific RPC
 *   show @ref:name  - show saved reference
 *
 * connector level:
 *   show           - connector details
 *   show <session> - session details
 *
 * session level:
 *   show           - session details
 *   show <rpcId>   - rpc details
 *
 * HTML export options:
 *   show --html                   - export current session to HTML
 *   show --html --id <rpc>        - export specific RPC to HTML
 *   show --html --out <dir>       - specify output directory
 *   show --html --open            - open in browser after export
 *   show --html --redact          - redact sensitive values
 *   show --html --embed-max-bytes - max bytes per payload
 *   show --html --spill           - write oversized payloads to separate files
 */
export async function handleShow(
  args: string[],
  context: ShellContext,
  configPath: string,
  executeCommand: (tokens: string[]) => Promise<void>
): Promise<void> {
  const level = getContextLevel(context);
  const isJson = args.includes('--json');
  const isHtml = args.includes('--html');
  const htmlOptions = isHtml ? getHtmlOptions(args) : [];
  // Get --id value if present (for show --html --id <rpc>)
  const idIdx = args.indexOf('--id');
  const idValue = idIdx !== -1 && args[idIdx + 1] ? args[idIdx + 1] : undefined;
  // Target is non-option argument (excluding --id value)
  const target = args.find((a, i) => !a.startsWith('-') && (idIdx === -1 || i !== idIdx + 1));

  const store = getStore(configPath);

  // Handle @ references first
  if (target && isRef(target)) {
    const manager = new ConfigManager(configPath);
    const eventsStore = new EventsStore(manager.getConfigDir());
    const dataProvider = createRefDataProvider(eventsStore);
    const resolver = new RefResolver(dataProvider);

    const result = resolver.resolve(target, context);
    if (!result.success || !result.ref) {
      printError(result.error || `Failed to resolve reference: ${target}`);
      return;
    }

    const ref = result.ref;

    // Show based on ref kind
    if (ref.kind === 'rpc') {
      if (!ref.session || !ref.rpc) {
        printError(`Invalid RPC reference: missing session/rpc ID`);
        return;
      }
      await executeCommand(['rpc', 'show', '--session', ref.session, '--id', ref.rpc, ...(isJson ? ['--json'] : []), ...htmlOptions]);
      return;
    }

    if (ref.kind === 'session') {
      if (!ref.session) {
        printError(`Invalid session reference: missing session ID`);
        return;
      }
      await executeCommand(['sessions', 'show', '--id', ref.session, ...(isJson ? ['--json'] : []), ...htmlOptions]);
      return;
    }

    if (ref.kind === 'connector') {
      if (!ref.target) {
        printError(`Invalid connector reference: missing connector ID`);
        return;
      }
      await executeCommand(['connectors', 'show', '--id', ref.target, ...(isJson ? ['--json'] : []), ...htmlOptions]);
      return;
    }

    if (ref.kind === 'context') {
      printInfo('At root context. Use: show <connector> to view connector details');
      return;
    }

    printError(`Cannot show ${ref.kind} reference`);
    return;
  }

  if (level === 'root') {
    if (target) {
      // Show connector details with HTML support
      await executeCommand(['connectors', 'show', '--id', target, ...(isJson ? ['--json'] : []), ...htmlOptions]);
    } else {
      printInfo('At root level. Use: show <connector> or cc <connector>');
    }
    return;
  }

  if (level === 'connector') {
    if (!context.connector) {
      printError('No connector in context');
      return;
    }

    if (target) {
      // Show session details
      // First resolve session prefix
      const sessions = store.getSessions(context.connector, MAX_SESSIONS_SEARCH);
      const matches = sessions.filter(s => s.session_id.startsWith(target));

      if (matches.length === 0) {
        printError(`Session not found: ${target}`);
        return;
      }

      if (matches.length > 1) {
        printError(`Ambiguous session prefix: ${target}`);
        matches.slice(0, MAX_AMBIGUOUS_DISPLAY).forEach(s => {
          console.log(`  ${shortenSessionId(s.session_id)}`);
        });
        return;
      }

      await executeCommand(['sessions', 'show', '--id', matches[0].session_id, ...(isJson ? ['--json'] : []), ...htmlOptions]);
    } else {
      // Show connector details with HTML support (connector-level)
      await executeCommand(['connectors', 'show', '--id', context.connector, ...(isJson ? ['--json'] : []), ...htmlOptions]);
    }
    return;
  }

  // Session level
  if (!context.session) {
    printError('No session in context');
    return;
  }

  // Handle --id option for specific RPC (e.g., show --html --id 1)
  const rpcTarget = idValue || target;

  if (rpcTarget) {
    // Show RPC details
    await executeCommand(['rpc', 'show', '--session', context.session, '--id', rpcTarget, ...(isJson ? ['--json'] : []), ...htmlOptions]);
  } else {
    // Show session details
    await executeCommand(['sessions', 'show', '--id', context.session, ...(isJson ? ['--json'] : []), ...htmlOptions]);
  }
}

/**
 * Get colored proto string for TTY output
 *
 * @param proto - Protocol type ('mcp', 'a2a', or '?')
 * @param isTTY - Whether the output is a TTY (enables ANSI colors)
 * @returns Colored string if TTY, plain string otherwise
 */
function getProtoColor(proto: ProtoType, isTTY: boolean): string {
  if (!isTTY) return proto;

  switch (proto) {
    case 'mcp':
      return '\x1b[32mmcp\x1b[0m';  // green
    case 'a2a':
      return '\x1b[36ma2a\x1b[0m';  // cyan
    default:
      return '\x1b[90m?\x1b[0m';    // gray
  }
}

/**
 * Get dim text for TTY output (used for table headers)
 *
 * @param text - The text to dim
 * @param isTTY - Whether the output is a TTY (enables ANSI colors)
 * @returns Dim ANSI-styled string if TTY, plain string otherwise
 */
function dimText(text: string, isTTY: boolean): string {
  if (!isTTY) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

// formatRelativeTime is imported from ../utils/index.js

/**
 * Get RPC detail as JSON string for piping to inscribe
 *
 * @param target - Reference target (e.g., @rpc:1, @ref:name, @last)
 * @param context - Shell context
 * @param configDir - Config directory path
 * @returns JSON string of RPC detail, or null if not found
 */
export async function getRpcDetailJson(
  target: string,
  context: ShellContext,
  configDir: string
): Promise<string | null> {
  const eventsStore = new EventsStore(configDir);
  const dataProvider = createRefDataProvider(eventsStore);
  const resolver = new RefResolver(dataProvider);

  // Resolve reference
  const parsed = parseRef(target);
  let sessionId: string | undefined;
  let rpcId: string | undefined;

  if (parsed.type === 'last') {
    const result = resolver.resolveLast(context);
    if (!result.success || !result.ref || result.ref.kind !== 'rpc') {
      return null;
    }
    sessionId = result.ref.session;
    rpcId = result.ref.rpc;
  } else if (parsed.type === 'rpc' && parsed.id) {
    rpcId = parsed.id;
    sessionId = context.session;
  } else if (parsed.type === 'ref' && parsed.id) {
    const result = resolver.resolveUserRef(parsed.id);
    if (!result.success || !result.ref || result.ref.kind !== 'rpc') {
      return null;
    }
    sessionId = result.ref.session;
    rpcId = result.ref.rpc;
  } else {
    return null;
  }

  if (!rpcId) {
    return null;
  }

  // Get RPC with events
  const rpcData = eventsStore.getRpcWithEvents(rpcId, sessionId);
  if (!rpcData) {
    return null;
  }

  // Get session for connector_id
  const session = eventsStore.getSession(rpcData.rpc.session_id);

  // Parse request/response JSON
  let requestJson: unknown = null;
  let responseJson: unknown = null;

  if (rpcData.request?.raw_json) {
    try {
      requestJson = JSON.parse(rpcData.request.raw_json);
    } catch {
      requestJson = rpcData.request.raw_json;
    }
  }

  if (rpcData.response?.raw_json) {
    try {
      responseJson = JSON.parse(rpcData.response.raw_json);
    } catch {
      responseJson = rpcData.response.raw_json;
    }
  }

  // Build RPC detail object (same format as rpc show --json)
  const detail = {
    rpc_id: rpcData.rpc.rpc_id,
    session_id: rpcData.rpc.session_id,
    connector_id: session?.connector_id,
    method: rpcData.rpc.method,
    request_ts: rpcData.rpc.request_ts,
    response_ts: rpcData.rpc.response_ts,
    success: rpcData.rpc.success,
    error_code: rpcData.rpc.error_code,
    request_json: requestJson,
    response_json: responseJson,
  };

  return JSON.stringify(detail, null, 2);
}

// ============ Pipeline Support (Filter DSL v0.1) ============

import type {
  PipelineValue,
  RpcRow,
  SessionRow,
  ConnectorRow,
} from './pipeline-types.js';

/**
 * Get ls result as pipeline rows for filtering
 *
 * Used by: ls | where <filter-expr>
 */
export function getLsRows(context: ShellContext, configPath: string): PipelineValue {
  const level = getContextLevel(context);
  const store = getStore(configPath);

  if (level === 'session' && context.connector && context.session) {
    const rpcs = getRpcRowsInternal(store, context.session);
    return { kind: 'rows', rows: rpcs, rowType: 'rpc' };
  }

  if (level === 'connector' && context.connector) {
    const sessions = getSessionRowsInternal(store, context.connector);
    return { kind: 'rows', rows: sessions, rowType: 'session' };
  }

  // Root level - return connector rows
  const connectors = getConnectorRowsInternal(store, configPath);
  return { kind: 'rows', rows: connectors, rowType: 'connector' };
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

    // Fallback chain matches analytics.ts implementation
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
    // JSON parse error - return undefined
  }

  return undefined;
}

/**
 * Get RPC rows for a session (internal helper)
 */
function getRpcRowsInternal(store: EventLineStore, sessionId: string): RpcRow[] {
  const rpcs = store.getRpcCalls(sessionId);

  return rpcs.map((rpc) => {
    // Determine status from success field
    let status: 'OK' | 'ERR' | 'pending';
    if (rpc.success === 1) {
      status = 'OK';
    } else if (rpc.success === 0) {
      status = 'ERR';
    } else {
      status = 'pending';
    }

    // Calculate latency
    let latency_ms: number | null = null;
    if (rpc.request_ts && rpc.response_ts) {
      const requestTime = new Date(rpc.request_ts).getTime();
      const responseTime = new Date(rpc.response_ts).getTime();
      latency_ms = responseTime - requestTime;
    }

    // Extract tool_name for tools/call method
    let tool_name: string | undefined;
    if (rpc.method === 'tools/call') {
      const rawEvent = store.getRawEvent(sessionId, rpc.rpc_id);
      if (rawEvent?.request?.raw_json) {
        tool_name = extractToolName(rawEvent.request.raw_json);
      }
    }

    return {
      rpc_id: rpc.rpc_id,
      session_id: rpc.session_id,
      method: rpc.method,
      status,
      latency_ms,
      request_ts: rpc.request_ts,
      response_ts: rpc.response_ts,
      error_code: rpc.error_code,
      tool_name,
    };
  });
}

/**
 * Get session rows for a target (internal helper)
 */
function getSessionRowsInternal(store: EventLineStore, targetId: string): SessionRow[] {
  const sessions = store.getSessions(targetId, PIPELINE_SESSION_LIMIT);

  return sessions.map((session) => ({
    session_id: session.session_id,
    connector_id: targetId,
    target_id: targetId,
    started_at: session.started_at,
    ended_at: session.ended_at,
    event_count: session.event_count ?? 0,
    rpc_count: session.rpc_count ?? 0,
    total_latency_ms: undefined, // Could be calculated if needed
  }));
}

/**
 * Get connector rows at root level (internal helper)
 */
function getConnectorRowsInternal(store: EventLineStore, configPath: string): ConnectorRow[] {
  const historyConnectors = store.getConnectors();

  return historyConnectors.map((c) => ({
    connector_id: c.id,
    name: c.id, // Use ID as name since we don't have a separate name field
    session_count: c.session_count,
    created_at: c.latest_session ?? new Date().toISOString(),
  }));
}
