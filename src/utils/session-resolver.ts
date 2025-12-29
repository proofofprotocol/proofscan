/**
 * Session Resolver - Unified session resolution logic
 *
 * Priority:
 * 1. CLI option --session <id> (if provided)
 * 2. --latest flag (latest session, optionally filtered by --connector)
 * 3. Current session (from state file)
 * 4. Error with helpful hints
 */

import { getEventsDb } from '../db/connection.js';
import { getCurrentSession } from './state.js';
import type { Session } from '../db/types.js';

export interface ResolveSessionOptions {
  /** Session ID from CLI option (partial match supported) */
  sessionId?: string;

  /** Use latest session */
  latest?: boolean;

  /** Filter by connector ID */
  connectorId?: string;

  /** Config directory for database access */
  configDir: string;
}

export interface ResolvedSession {
  /** Full session ID */
  sessionId: string;

  /** Connector ID */
  connectorId: string;

  /** How the session was resolved */
  resolvedBy: 'option' | 'latest' | 'current';
}

export interface SessionResolutionError {
  message: string;
  hints: string[];
}

/**
 * Resolve session based on options and fallbacks
 */
export function resolveSession(options: ResolveSessionOptions): ResolvedSession | SessionResolutionError {
  const db = getEventsDb(options.configDir);

  // Priority 1: Explicit --session option
  if (options.sessionId) {
    const session = findSessionByPartialId(db, options.sessionId);
    if (session) {
      return {
        sessionId: session.session_id,
        connectorId: session.connector_id,
        resolvedBy: 'option',
      };
    }
    return {
      message: `Session not found: ${options.sessionId}`,
      hints: [
        'pfscan sessions list',
        'pfscan view --pairs',
      ],
    };
  }

  // Priority 2: --latest flag
  if (options.latest) {
    const session = findLatestSession(db, options.connectorId);
    if (session) {
      return {
        sessionId: session.session_id,
        connectorId: session.connector_id,
        resolvedBy: 'latest',
      };
    }
    const connectorHint = options.connectorId ? ` for connector '${options.connectorId}'` : '';
    return {
      message: `No sessions found${connectorHint}`,
      hints: [
        'pfscan scan start --id <connector>',
        'pfscan connectors list',
      ],
    };
  }

  // Priority 3: Current session from state file
  const currentState = getCurrentSession();
  if (currentState?.sessionId) {
    // Verify session still exists in database
    const session = findSessionByPartialId(db, currentState.sessionId);
    if (session) {
      return {
        sessionId: session.session_id,
        connectorId: session.connector_id,
        resolvedBy: 'current',
      };
    }
    // Current session was deleted, fall through to error
  }

  // Priority 4: Error with hints
  return {
    message: 'No session specified or resolved.',
    hints: [
      'pfscan sessions list',
      'pfscan rpc list --latest',
      'pfscan rpc list --session <id>',
    ],
  };
}

/**
 * Check if a result is an error
 */
export function isSessionError(result: ResolvedSession | SessionResolutionError): result is SessionResolutionError {
  return 'hints' in result;
}

/**
 * Format error for CLI output
 */
export function formatSessionError(error: SessionResolutionError): string {
  const lines = [error.message, '', 'Try one of:'];
  for (const hint of error.hints) {
    lines.push(`  ${hint}`);
  }
  return lines.join('\n');
}

/**
 * Find session by partial ID match
 */
function findSessionByPartialId(db: ReturnType<typeof getEventsDb>, partialId: string): Session | null {
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE session_id LIKE ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(partialId + '%') as Session | undefined;

  return session || null;
}

/**
 * Find latest session, optionally filtered by connector
 */
function findLatestSession(db: ReturnType<typeof getEventsDb>, connectorId?: string): Session | null {
  let session: Session | undefined;

  if (connectorId) {
    session = db.prepare(`
      SELECT * FROM sessions
      WHERE connector_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(connectorId) as Session | undefined;
  } else {
    session = db.prepare(`
      SELECT * FROM sessions
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as Session | undefined;
  }

  return session || null;
}
