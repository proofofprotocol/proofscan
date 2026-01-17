/**
 * ProofScan Web Monitor - Events data queries (Issue #59)
 */

import { getEventsDb } from '../../db/connection.js';
import { ConfigManager } from '../../config/manager.js';
import type { MonitorSessionEvent, EventDirection, EventKind } from '../types.js';

/**
 * Get all events for a session
 */
export function getEventsBySession(
  configPath: string,
  sessionId: string,
  options: { limit?: number } = {}
): MonitorSessionEvent[] {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  const db = getEventsDb(configDir);

  const limit = options.limit ?? 1000;

  const stmt = db.prepare(`
    SELECT
      e.event_id,
      e.session_id,
      e.rpc_id,
      e.direction,
      e.kind,
      e.ts,
      e.seq,
      e.summary,
      e.raw_json,
      r.method
    FROM events e
    LEFT JOIN rpc_calls r ON e.rpc_id = r.rpc_id AND e.session_id = r.session_id
    WHERE e.session_id = ?
    ORDER BY e.ts ASC, e.seq ASC
    LIMIT ?
  `);

  const rows = stmt.all(sessionId, limit) as Array<{
    event_id: string;
    session_id: string;
    rpc_id: string | null;
    direction: string;
    kind: string;
    ts: string;
    seq: number | null;
    summary: string | null;
    raw_json: string | null;
    method: string | null;
  }>;

  return rows.map((row) => {
    // Try to extract method from raw_json if not available from rpc_calls
    let method = row.method;
    if (!method && row.raw_json) {
      try {
        const json = JSON.parse(row.raw_json);
        method = json.method ?? null;
      } catch {
        // Ignore parse errors
      }
    }

    return {
      event_id: row.event_id,
      session_id: row.session_id,
      rpc_id: row.rpc_id,
      direction: row.direction as EventDirection,
      kind: row.kind as EventKind,
      ts: row.ts,
      seq: row.seq,
      summary: row.summary,
      method,
      has_payload: !!row.raw_json,
    };
  });
}

/**
 * Get event detail with raw JSON payload
 */
export function getEventDetail(
  configPath: string,
  eventId: string
): (MonitorSessionEvent & { raw_json: string | null }) | null {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  const db = getEventsDb(configDir);

  const stmt = db.prepare(`
    SELECT
      e.event_id,
      e.session_id,
      e.rpc_id,
      e.direction,
      e.kind,
      e.ts,
      e.seq,
      e.summary,
      e.raw_json,
      r.method
    FROM events e
    LEFT JOIN rpc_calls r ON e.rpc_id = r.rpc_id AND e.session_id = r.session_id
    WHERE e.event_id = ?
  `);

  const row = stmt.get(eventId) as {
    event_id: string;
    session_id: string;
    rpc_id: string | null;
    direction: string;
    kind: string;
    ts: string;
    seq: number | null;
    summary: string | null;
    raw_json: string | null;
    method: string | null;
  } | undefined;

  if (!row) return null;

  // Try to extract method from raw_json if not available
  let method = row.method;
  if (!method && row.raw_json) {
    try {
      const json = JSON.parse(row.raw_json);
      method = json.method ?? null;
    } catch {
      // Ignore parse errors
    }
  }

  return {
    event_id: row.event_id,
    session_id: row.session_id,
    rpc_id: row.rpc_id,
    direction: row.direction as EventDirection,
    kind: row.kind as EventKind,
    ts: row.ts,
    seq: row.seq,
    summary: row.summary,
    method,
    has_payload: !!row.raw_json,
    raw_json: row.raw_json,
  };
}

/**
 * Get event counts by kind for a session
 */
export function getEventCountsByKind(
  configPath: string,
  sessionId: string
): Record<EventKind, number> {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  const db = getEventsDb(configDir);

  const stmt = db.prepare(`
    SELECT kind, COUNT(*) as count
    FROM events
    WHERE session_id = ?
    GROUP BY kind
  `);

  const rows = stmt.all(sessionId) as Array<{ kind: string; count: number }>;

  const counts: Record<EventKind, number> = {
    request: 0,
    response: 0,
    notification: 0,
    transport_event: 0,
  };

  for (const row of rows) {
    counts[row.kind as EventKind] = row.count;
  }

  return counts;
}
