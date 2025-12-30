/**
 * Events database store - manages sessions, events, and rpc_calls
 */

import { randomUUID } from 'crypto';
import { getEventsDb } from './connection.js';
import type {
  Session,
  Event,
  RpcCall,
  ExitReason,
  EventDirection,
  EventKind,
  SessionWithStats,
  PruneCandidate,
} from './types.js';

export class EventsStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getEventsDb(this.configDir);
  }

  // ==================== Sessions ====================

  createSession(connectorId: string, options?: {
    actorId?: string;
    actorKind?: string;
    actorLabel?: string;
  }): Session {
    const session: Session = {
      session_id: randomUUID(),
      connector_id: connectorId,
      started_at: new Date().toISOString(),
      ended_at: null,
      exit_reason: null,
      protected: 0,
      created_at: new Date().toISOString(),
      actor_id: options?.actorId || null,
      actor_kind: options?.actorKind || null,
      actor_label: options?.actorLabel || null,
      secret_ref_count: 0,
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, connector_id, started_at, ended_at, exit_reason, protected, created_at, actor_id, actor_kind, actor_label, secret_ref_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.session_id,
      session.connector_id,
      session.started_at,
      session.ended_at,
      session.exit_reason,
      session.protected,
      session.created_at,
      session.actor_id,
      session.actor_kind,
      session.actor_label,
      session.secret_ref_count
    );

    return session;
  }

  endSession(sessionId: string, exitReason: ExitReason): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET ended_at = ?, exit_reason = ? WHERE session_id = ?
    `);
    stmt.run(new Date().toISOString(), exitReason, sessionId);
  }

  getSession(sessionId: string): Session | null {
    const stmt = this.db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
    return stmt.get(sessionId) as Session | null;
  }

  getSessionsByConnector(connectorId: string, limit?: number): SessionWithStats[] {
    let sql = `
      SELECT s.*,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
        (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count
      FROM sessions s
      WHERE s.connector_id = ?
      ORDER BY s.started_at DESC
    `;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(connectorId) as SessionWithStats[];
  }

  getAllSessions(limit?: number): SessionWithStats[] {
    let sql = `
      SELECT s.*,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
        (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count
      FROM sessions s
      ORDER BY s.started_at DESC
    `;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all() as SessionWithStats[];
  }

  protectSession(sessionId: string): void {
    const stmt = this.db.prepare(`UPDATE sessions SET protected = 1 WHERE session_id = ?`);
    stmt.run(sessionId);
  }

  /**
   * Increment secret_ref_count for a session (Phase 3.4)
   */
  incrementSecretRefCount(sessionId: string, count: number): void {
    if (count <= 0) return;
    const stmt = this.db.prepare(`UPDATE sessions SET secret_ref_count = secret_ref_count + ? WHERE session_id = ?`);
    stmt.run(count, sessionId);
  }

  /**
   * Update actor info for a session (Phase 3.4)
   */
  updateSessionActor(sessionId: string, actor: { id: string; kind: string; label: string }): void {
    const stmt = this.db.prepare(`UPDATE sessions SET actor_id = ?, actor_kind = ?, actor_label = ? WHERE session_id = ?`);
    stmt.run(actor.id, actor.kind, actor.label, sessionId);
  }

  // ==================== Events ====================

  saveEvent(
    sessionId: string,
    direction: EventDirection,
    kind: EventKind,
    options: {
      rpcId?: string;
      rawJson?: string;
      seq?: number;
      summary?: string;
      payloadHash?: string;
    } = {}
  ): Event {
    const event: Event = {
      event_id: randomUUID(),
      session_id: sessionId,
      rpc_id: options.rpcId || null,
      direction,
      kind,
      ts: new Date().toISOString(),
      seq: options.seq || null,
      summary: options.summary || null,
      payload_hash: options.payloadHash || null,
      raw_json: options.rawJson || null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, seq, summary, payload_hash, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.session_id,
      event.rpc_id,
      event.direction,
      event.kind,
      event.ts,
      event.seq,
      event.summary,
      event.payload_hash,
      event.raw_json
    );

    return event;
  }

  getEventsBySession(sessionId: string, limit?: number): Event[] {
    let sql = `SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC`;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(sessionId) as Event[];
  }

  getRecentEventsByConnector(connectorId: string, limit: number = 20): Event[] {
    const stmt = this.db.prepare(`
      SELECT e.* FROM events e
      JOIN sessions s ON e.session_id = s.session_id
      WHERE s.connector_id = ?
      ORDER BY e.ts DESC
      LIMIT ?
    `);
    const events = stmt.all(connectorId, limit) as Event[];
    return events.reverse(); // Return in chronological order
  }

  // ==================== RPC Calls ====================

  saveRpcCall(
    sessionId: string,
    rpcId: string,
    method: string
  ): RpcCall {
    const rpcCall: RpcCall = {
      rpc_id: rpcId,
      session_id: sessionId,
      method,
      request_ts: new Date().toISOString(),
      response_ts: null,
      success: null,
      error_code: null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO rpc_calls (rpc_id, session_id, method, request_ts, response_ts, success, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      rpcCall.rpc_id,
      rpcCall.session_id,
      rpcCall.method,
      rpcCall.request_ts,
      rpcCall.response_ts,
      rpcCall.success,
      rpcCall.error_code
    );

    return rpcCall;
  }

  completeRpcCall(
    sessionId: string,
    rpcId: string,
    success: boolean,
    errorCode?: number
  ): void {
    const stmt = this.db.prepare(`
      UPDATE rpc_calls
      SET response_ts = ?, success = ?, error_code = ?
      WHERE session_id = ? AND rpc_id = ?
    `);
    stmt.run(
      new Date().toISOString(),
      success ? 1 : 0,
      errorCode || null,
      sessionId,
      rpcId
    );
  }

  getRpcCallsBySession(sessionId: string): RpcCall[] {
    const stmt = this.db.prepare(`
      SELECT * FROM rpc_calls WHERE session_id = ? ORDER BY request_ts ASC
    `);
    return stmt.all(sessionId) as RpcCall[];
  }

  // ==================== Prune / Archive ====================

  /**
   * Get sessions that can be pruned (not protected)
   */
  getPruneCandidates(options: {
    keepLast?: number;
    before?: string; // ISO date
    connectorId?: string;
  } = {}): PruneCandidate[] {
    const { keepLast, before, connectorId } = options;
    const candidates: PruneCandidate[] = [];

    // Get all unprotected sessions
    let sql = `
      SELECT s.session_id, s.connector_id, s.started_at, s.protected,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count
      FROM sessions s
      WHERE s.protected = 0
    `;
    const params: unknown[] = [];

    if (connectorId) {
      sql += ` AND s.connector_id = ?`;
      params.push(connectorId);
    }

    if (before) {
      sql += ` AND s.started_at < ?`;
      params.push(before);
    }

    sql += ` ORDER BY s.started_at DESC`;

    const stmt = this.db.prepare(sql);
    const sessions = stmt.all(...params) as Array<{
      session_id: string;
      connector_id: string;
      started_at: string;
      event_count: number;
      protected: number;
    }>;

    // Apply keepLast logic per connector
    if (keepLast !== undefined) {
      const byConnector = new Map<string, typeof sessions>();
      for (const s of sessions) {
        if (!byConnector.has(s.connector_id)) {
          byConnector.set(s.connector_id, []);
        }
        byConnector.get(s.connector_id)!.push(s);
      }

      for (const [, connectorSessions] of byConnector) {
        // Skip the first N (most recent) sessions
        for (let i = keepLast; i < connectorSessions.length; i++) {
          const s = connectorSessions[i];
          candidates.push({
            ...s,
            reason: `Exceeds keep_last_sessions (${keepLast})`,
          });
        }
      }
    } else {
      // If no keepLast, all matched sessions are candidates
      for (const s of sessions) {
        candidates.push({
          ...s,
          reason: before ? `Before ${before}` : 'Manual selection',
        });
      }
    }

    return candidates;
  }

  /**
   * Delete sessions and all related data
   */
  deleteSessions(sessionIds: string[]): number {
    if (sessionIds.length === 0) return 0;

    const transaction = this.db.transaction((ids: string[]) => {
      // With CASCADE, deleting sessions will delete events and rpc_calls
      const placeholders = ids.map(() => '?').join(',');
      const stmt = this.db.prepare(`DELETE FROM sessions WHERE session_id IN (${placeholders}) AND protected = 0`);
      const result = stmt.run(...ids);
      return result.changes;
    });

    return transaction(sessionIds);
  }

  /**
   * Clear raw_json from old events (keep metadata)
   */
  clearRawJson(options: {
    beforeDays?: number;
    sessionIds?: string[];
  }): number {
    let sql = `UPDATE events SET raw_json = NULL WHERE raw_json IS NOT NULL`;
    const params: unknown[] = [];

    if (options.beforeDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.beforeDays);
      sql += ` AND ts < ?`;
      params.push(cutoff.toISOString());
    }

    if (options.sessionIds && options.sessionIds.length > 0) {
      const placeholders = options.sessionIds.map(() => '?').join(',');
      sql += ` AND session_id IN (${placeholders})`;
      params.push(...options.sessionIds);
    }

    // Exclude protected sessions
    sql += ` AND session_id NOT IN (SELECT session_id FROM sessions WHERE protected = 1)`;

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes;
  }

  /**
   * Get count of events with raw_json that can be cleared
   */
  countClearableRawJson(beforeDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - beforeDays);

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE raw_json IS NOT NULL
        AND ts < ?
        AND session_id NOT IN (SELECT session_id FROM sessions WHERE protected = 1)
    `);
    const result = stmt.get(cutoff.toISOString()) as { count: number };
    return result.count;
  }

  /**
   * Get total size of raw_json data
   */
  getRawJsonSize(): number {
    const stmt = this.db.prepare(`SELECT SUM(LENGTH(raw_json)) as size FROM events WHERE raw_json IS NOT NULL`);
    const result = stmt.get() as { size: number | null };
    return result.size || 0;
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    this.db.exec('VACUUM');
  }
}
