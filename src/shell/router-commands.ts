/**
 * Router-style commands: cc, ls, show, ..
 *
 * These commands provide a router-cli inspired navigation experience
 * for exploring connectors, sessions, and RPC calls.
 */

import type { ShellContext, ProtoType } from './types.js';
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
  connector_id: string;
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
  connectorId: string
): Promise<boolean> {
  if (matches.length === 1) {
    savePreviousLocation(context);
    context.session = matches[0].session_id;
    context.connector = connectorId;
    context.proto = detectProto(store, matches[0].session_id);
    setCurrentSession(matches[0].session_id, connectorId);
    printSuccess(`→ /${connectorId}/${shortenSessionId(matches[0].session_id)}`);
    return true;
  }

  if (canInteract()) {
    printInfo(`Multiple sessions match "${prefix}". Select one:`);
    const selected = await selectSession(
      matches.slice(0, MAX_INTERACTIVE_OPTIONS).map(s => ({ id: s.session_id, connector_id: s.connector_id }))
    );
    if (selected) {
      savePreviousLocation(context);
      context.session = selected;
      context.connector = connectorId;
      context.proto = detectProto(store, selected);
      setCurrentSession(selected, connectorId);
      printSuccess(`→ /${connectorId}/${shortenSessionId(selected)}`);
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

    // Get latest session (optionally filtered by current connector)
    const sessions = store.getSessions(context.connector, 1);
    if (sessions.length === 0) {
      if (context.connector) {
        printError(`No sessions for connector: ${context.connector}`);
        printInfo('Run: scan start');
      } else {
        printError('No sessions yet');
        printInfo('Run: scan start --id <connector>');
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
      if (!ref.session || !ref.connector) {
        printError(`Cannot navigate to RPC reference: missing session/connector`);
        printInfo(`Use: show ${arg} to view RPC details`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.connector;
      context.session = ref.session;
      context.proto = detectProto(store, ref.session);
      setCurrentSession(ref.session, ref.connector);
      printSuccess(`→ /${ref.connector}/${shortenSessionId(ref.session)}`);
      printInfo(`(navigated to session containing RPC)`);
      return;
    }

    if (ref.kind === 'session') {
      if (!ref.session || !ref.connector) {
        printError(`Invalid session reference: missing session/connector`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.connector;
      context.session = ref.session;
      context.proto = detectProto(store, ref.session);
      setCurrentSession(ref.session, ref.connector);
      printSuccess(`→ /${ref.connector}/${shortenSessionId(ref.session)}`);
      return;
    }

    if (ref.kind === 'connector') {
      if (!ref.connector) {
        printError(`Invalid connector reference: missing connector`);
        return;
      }
      savePreviousLocation(context);
      context.connector = ref.connector;
      context.session = undefined;
      context.proto = detectConnectorProto(store, ref.connector);
      setCurrentSession('', ref.connector);
      printSuccess(`→ /${ref.connector}`);
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

    // Validate separated format
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
    // Treat as connector
    const connectors = store.getConnectors();
    const match = connectors.find(c => c.id === arg || c.id.startsWith(arg));
    if (!match) {
      printError(`Connector not found: ${arg}`);
      printInfo('Available: ' + connectors.map(c => c.id).join(', '));
      return;
    }

    savePreviousLocation(context);
    context.connector = match.id;
    context.session = undefined;
    context.proto = detectConnectorProto(store, match.id);
    setCurrentSession('', match.id);
    printSuccess(`→ /${match.id}`);
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
    await listConnectors(store, isLong, isJson, idsOnly);
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
 */
async function listConnectors(
  store: EventLineStore,
  _isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  const connectors = store.getConnectors();

  if (connectors.length === 0) {
    printInfo('No connectors found. Run: scan start --id <connector>');
    return;
  }

  if (isJson) {
    const data = connectors.map(c => ({
      id: c.id,
      proto: detectConnectorProto(store, c.id),
      sessions: c.session_count,
      latest: c.latest_session,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (idsOnly) {
    connectors.forEach(c => console.log(c.id));
    return;
  }

  // Router-style table format
  const isTTY = process.stdout.isTTY;
  const data = connectors.map(c => ({
    id: c.id,
    proto: detectConnectorProto(store, c.id),
    sessions: c.session_count,
    latest: c.latest_session ? formatRelativeTime(c.latest_session) : '-',
  }));

  // Calculate column widths
  const maxId = Math.max(12, ...data.map(d => d.id.length));

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

    console.log(
      d.id.padEnd(maxId) + '  ' +
      protoColor.padEnd(isTTY ? 14 : 5) + '  ' +
      String(d.sessions).padEnd(8) + '  ' +
      d.latest
    );
  });

  console.log();
  printInfo(`Hint: cd <connector> to enter, show <connector> for details`);
}

/**
 * List sessions for a connector (router-style table)
 */
async function listSessions(
  store: EventLineStore,
  connectorId: string,
  _isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  const sessions = store.getSessions(connectorId, 50);

  if (sessions.length === 0) {
    printInfo(`No sessions for connector: ${connectorId}. Run: scan start`);
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
 */
export async function handleShow(
  args: string[],
  context: ShellContext,
  configPath: string,
  executeCommand: (tokens: string[]) => Promise<void>
): Promise<void> {
  const level = getContextLevel(context);
  const isJson = args.includes('--json');
  const target = args.find(a => !a.startsWith('-'));

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
      await executeCommand(['rpc', 'show', '--session', ref.session, '--id', ref.rpc, ...(isJson ? ['--json'] : [])]);
      return;
    }

    if (ref.kind === 'session') {
      if (!ref.session) {
        printError(`Invalid session reference: missing session ID`);
        return;
      }
      await executeCommand(['sessions', 'show', '--id', ref.session, ...(isJson ? ['--json'] : [])]);
      return;
    }

    if (ref.kind === 'connector') {
      if (!ref.connector) {
        printError(`Invalid connector reference: missing connector ID`);
        return;
      }
      await executeCommand(['connectors', 'show', '--id', ref.connector, ...(isJson ? ['--json'] : [])]);
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
      // Show connector details
      await executeCommand(['connectors', 'show', '--id', target, ...(isJson ? ['--json'] : [])]);
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

      await executeCommand(['sessions', 'show', '--id', matches[0].session_id, ...(isJson ? ['--json'] : [])]);
    } else {
      // Show connector details
      await executeCommand(['connectors', 'show', '--id', context.connector, ...(isJson ? ['--json'] : [])]);
    }
    return;
  }

  // Session level
  if (!context.session) {
    printError('No session in context');
    return;
  }

  if (target) {
    // Show RPC details
    await executeCommand(['rpc', 'show', '--session', context.session, '--id', target, ...(isJson ? ['--json'] : [])]);
  } else {
    // Show session details
    await executeCommand(['sessions', 'show', '--id', context.session, ...(isJson ? ['--json'] : [])]);
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
