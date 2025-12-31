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
import { ConfigManager } from '../config/index.js';
import { setCurrentSession, clearCurrentSession } from '../utils/state.js';

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
    context.session = matches[0].session_id;
    context.connector = connectorId;
    context.proto = detectProto(store, matches[0].session_id);
    setCurrentSession(matches[0].session_id, connectorId);
    printSuccess(`→ ${connectorId}|${shortenSessionId(matches[0].session_id)}`);
    return true;
  }

  if (canInteract()) {
    printInfo(`Multiple sessions match "${prefix}". Select one:`);
    const selected = await selectSession(
      matches.slice(0, MAX_INTERACTIVE_OPTIONS).map(s => ({ id: s.session_id, connector_id: s.connector_id }))
    );
    if (selected) {
      context.session = selected;
      context.connector = connectorId;
      context.proto = detectProto(store, selected);
      setCurrentSession(selected, connectorId);
      printSuccess(`→ ${connectorId}|${shortenSessionId(selected)}`);
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
    context.connector = undefined;
    context.session = undefined;
    context.proto = undefined;
    clearCurrentSession();
    printSuccess('Context cleared (root)');
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
    context.session = latestSession.session_id;
    context.connector = latestSession.connector_id;
    context.proto = detectProto(store, latestSession.session_id);
    setCurrentSession(latestSession.session_id, latestSession.connector_id);
    printSuccess(`→ ${latestSession.connector_id}|${shortenSessionId(latestSession.session_id)}`);
    return;
  }

  // Parse argument - could be <connector>, <session>, or <connector>|<session>
  const arg = args[0];

  // Check for connector|session format
  if (arg.includes('|')) {
    const [connectorPart, sessionPart] = arg.split('|', 2);

    // Validate pipe-separated format
    if (!connectorPart || !sessionPart) {
      printError(`Invalid format: ${arg}`);
      printInfo('Use: cc <connector>|<session> (e.g., mcp|abc12345)');
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

    context.connector = match.id;
    context.session = undefined;
    context.proto = detectConnectorProto(store, match.id);
    setCurrentSession('', match.id);
    printSuccess(`→ ${match.id}`);
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
    context.session = undefined;
    setCurrentSession('', context.connector);
    printSuccess(`→ ${context.connector}`);
    return;
  }

  if (level === 'connector') {
    context.connector = undefined;
    context.session = undefined;
    clearCurrentSession();
    printSuccess('→ root');
    return;
  }

  printInfo('Already at root');
}

/**
 * Handle 'pwd' command - show current context with copyable path
 */
export function handlePwd(context: ShellContext, configPath: string): void {
  const level = getContextLevel(context);
  const store = getStore(configPath);

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
 * List connectors at root level
 */
async function listConnectors(
  store: EventLineStore,
  isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  const connectors = store.getConnectors();

  if (connectors.length === 0) {
    printInfo('No connectors found');
    return;
  }

  if (isJson) {
    const data = connectors.map(c => ({
      id: c.id,
      proto: detectConnectorProto(store, c.id),
      sessions: c.session_count,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (idsOnly) {
    connectors.forEach(c => console.log(c.id));
    return;
  }

  // Table format
  const isTTY = process.stdout.isTTY;
  const data = connectors.map(c => ({
    id: c.id,
    proto: detectConnectorProto(store, c.id),
    sessions: c.session_count,
  }));

  // Calculate column widths
  const maxId = Math.max(10, ...data.map(d => d.id.length));

  // Header
  if (isLong) {
    console.log();
    console.log(
      'ID'.padEnd(maxId) + '  ' +
      'Proto'.padEnd(5) + '  ' +
      'Sessions'
    );
    console.log('-'.repeat(maxId + 20));
  }

  // Rows
  data.forEach(d => {
    const protoColor = getProtoColor(d.proto, isTTY);

    if (isLong) {
      console.log(
        d.id.padEnd(maxId) + '  ' +
        protoColor.padEnd(isTTY ? 14 : 5) + '  ' +
        String(d.sessions)
      );
    } else {
      console.log(`${d.id}  ${protoColor}`);
    }
  });

  if (isLong) {
    console.log();
  }
}

/**
 * List sessions for a connector
 */
async function listSessions(
  store: EventLineStore,
  connectorId: string,
  isLong: boolean,
  isJson: boolean,
  idsOnly: boolean
): Promise<void> {
  const sessions = store.getSessions(connectorId, 50);

  if (sessions.length === 0) {
    printInfo(`No sessions for connector: ${connectorId}`);
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

  console.log();
  if (isLong) {
    console.log('Session'.padEnd(10) + '  ' + 'Started'.padEnd(20) + '  ' + 'Events');
    console.log('-'.repeat(45));
  }

  sessions.forEach(s => {
    const prefix = shortenSessionId(s.session_id);
    if (isLong) {
      const started = s.started_at ? new Date(s.started_at).toLocaleString() : '-';
      console.log(
        prefix.padEnd(10) + '  ' +
        started.padEnd(20) + '  ' +
        String(s.event_count)
      );
    } else {
      console.log(prefix);
    }
  });

  if (isLong) {
    console.log();
  }
}

/**
 * List RPC calls for a session
 */
async function listRpcs(
  store: EventLineStore,
  sessionId: string,
  isLong: boolean,
  isJson: boolean,
  idsOnly: boolean,
  executeCommand: (tokens: string[]) => Promise<void>
): Promise<void> {
  // Use existing rpc list command
  const args = ['rpc', 'list', '--session', sessionId];
  if (isJson) args.push('--json');
  await executeCommand(args);
}

/**
 * Handle 'show' command - show details at current level
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
 * Get colored proto string for TTY
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
