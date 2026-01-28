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
  UserRef,
  RefKind,
} from './types.js';
import { normalizeMcpEvent, normalizeA2aEvent } from '../a2a/normalizer.js';

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
    targetId?: string;
    actorId?: string;
    actorKind?: string;
    actorLabel?: string;
  }): Session {
    const targetId = options?.targetId || connectorId;
    const session: Session = {
      session_id: randomUUID(),
      connector_id: connectorId,
      target_id: targetId,
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
      INSERT INTO sessions (session_id, connector_id, target_id, started_at, ended_at, exit_reason, protected, created_at, actor_id, actor_kind, actor_label, secret_ref_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.session_id,
      session.connector_id,
      session.target_id,
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

  /**
   * Save an event with optional normalization
   * @param sessionId - Session ID
   * @param direction - Event direction
   * @param kind - Event kind
   * @param options - Event options
   * @param options.rpcId - Optional RPC ID
   * @param options.rawJson - Raw JSON payload
   * @param options.seq - Sequence number
   * @param options.summary - Human-readable summary
   * @param options.payloadHash - Payload hash
   * @param options.protocol - Protocol for normalization ('mcp' | 'a2a')
   */
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
      protocol?: 'mcp' | 'a2a';
    } = {}
  ): Event {
    // Phase 6: Normalize event if protocol is specified
    let normalizedJson: string | null = null;
    if (options.protocol && options.rawJson) {
      try {
        const raw = JSON.parse(options.rawJson);
        const normalized = options.protocol === 'mcp'
          ? normalizeMcpEvent(raw)
          : normalizeA2aEvent(raw);
        if (normalized) {
          normalizedJson = JSON.stringify(normalized);
        }
      } catch {
        // Silently fail if JSON parsing or normalization fails
        // normalized_json remains null
      }
    }

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
      normalized_json: normalizedJson,
    };

    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, seq, summary, payload_hash, raw_json, normalized_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      event.raw_json,
      normalizedJson
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

  // ==================== User Refs (Phase 4.1) ====================

  /**
   * Save or update a user-defined reference
   *
   * For popl kind refs:
   * - entry_id is stored in connector field
   * - target is stored in session field
   * This avoids DB schema changes while maintaining backwards compatibility.
   */
  saveUserRef(
    name: string,
    ref: {
      kind: RefKind;
      connector?: string;
      session?: string;
      rpc?: string;
      proto?: string;
      level?: string;
      captured_at?: string;
      /** For popl kind: POPL entry ID */
      entry_id?: string;
      /** For popl kind: target path (e.g., 'popl/<entry_id>') */
      target?: string;
    }
  ): UserRef {
    // For popl kind, store entry_id in connector and target in session
    // Use nullish coalescing (??) to preserve empty strings if explicitly set
    const connector = ref.kind === 'popl' ? (ref.entry_id ?? null) : (ref.connector ?? null);
    const session = ref.kind === 'popl' ? (ref.target ?? null) : (ref.session ?? null);

    const userRef: UserRef = {
      name,
      kind: ref.kind,
      connector,
      session,
      rpc: ref.rpc ?? null,
      proto: ref.proto ?? null,
      level: ref.level ?? null,
      captured_at: ref.captured_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
      // Virtual fields for popl kind (reconstructed in getUserRef)
      target: ref.kind === 'popl' ? (ref.target ?? null) : null,
      entry_id: ref.kind === 'popl' ? (ref.entry_id ?? null) : null,
    };

    // Use INSERT ... ON CONFLICT: created_at NOT in UPDATE SET, so original is preserved on conflict
    const stmt = this.db.prepare(`
      INSERT INTO user_refs (name, kind, connector, session, rpc, proto, level, captured_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        kind = excluded.kind,
        connector = excluded.connector,
        session = excluded.session,
        rpc = excluded.rpc,
        proto = excluded.proto,
        level = excluded.level,
        captured_at = excluded.captured_at
    `);

    stmt.run(
      userRef.name,
      userRef.kind,
      connector,
      session,
      userRef.rpc,
      userRef.proto,
      userRef.level,
      userRef.captured_at,
      userRef.created_at
    );

    return userRef;
  }

  /**
   * Get a user-defined reference by name
   *
   * For popl kind refs, reconstructs entry_id and target from stored fields:
   * - entry_id from connector field
   * - target from session field
   */
  getUserRef(name: string): UserRef | null {
    const stmt = this.db.prepare(`SELECT * FROM user_refs WHERE name = ?`);
    const row = stmt.get(name) as UserRef | null;
    if (!row) return null;

    // For popl kind, restore entry_id and target
    if (row.kind === 'popl') {
      return {
        ...row,
        entry_id: row.connector, // entry_id was stored in connector
        target: row.session,     // target was stored in session
        connector: null,         // Clear connector for popl refs
        session: null,           // Clear session for popl refs
      };
    }

    // For non-popl refs, add null entry_id and target
    return {
      ...row,
      entry_id: null,
      target: null,
    };
  }

  /**
   * Delete a user-defined reference
   */
  deleteUserRef(name: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM user_refs WHERE name = ?`);
    const result = stmt.run(name);
    return result.changes > 0;
  }

  /**
   * List all user-defined references
   *
   * For popl kind refs, reconstructs entry_id and target from stored fields.
   */
  listUserRefs(): UserRef[] {
    const stmt = this.db.prepare(`SELECT * FROM user_refs ORDER BY created_at DESC`);
    const rows = stmt.all() as UserRef[];

    return rows.map(row => {
      if (row.kind === 'popl') {
        return {
          ...row,
          entry_id: row.connector,
          target: row.session,
          connector: null,
          session: null,
        };
      }
      return {
        ...row,
        entry_id: null,
        target: null,
      };
    });
  }

  /**
   * Get latest session (optionally for a specific connector)
   * Used by RefResolver
   */
  getLatestSession(connectorId?: string): { session_id: string; connector_id: string } | null {
    let sql = `SELECT session_id, connector_id FROM sessions`;
    const params: unknown[] = [];

    if (connectorId) {
      sql += ` WHERE connector_id = ?`;
      params.push(connectorId);
    }

    sql += ` ORDER BY started_at DESC LIMIT 1`;

    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as { session_id: string; connector_id: string } | null;
  }

  /**
   * Get latest RPC for a session
   * Used by RefResolver
   */
  getLatestRpc(sessionId: string): { rpc_id: string; method: string } | null {
    const stmt = this.db.prepare(`
      SELECT rpc_id, method FROM rpc_calls
      WHERE session_id = ?
      ORDER BY request_ts DESC
      LIMIT 1
    `);
    return stmt.get(sessionId) as { rpc_id: string; method: string } | null;
  }

  /**
   * Get RPC by ID (optionally within a session)
   * Used by RefResolver
   */
  getRpcById(rpcId: string, sessionId?: string): { rpc_id: string; session_id: string; method: string } | null {
    let sql = `SELECT rpc_id, session_id, method FROM rpc_calls WHERE rpc_id = ?`;
    const params: unknown[] = [rpcId];

    if (sessionId) {
      sql += ` AND session_id = ?`;
      params.push(sessionId);
    }

    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as { rpc_id: string; session_id: string; method: string } | null;
  }

  /**
   * Get session by ID or prefix
   * Used by RefResolver
   */
  getSessionByPrefix(prefix: string, connectorId?: string): { session_id: string; connector_id: string } | null {
    // Try exact match first
    let stmt = this.db.prepare(`SELECT session_id, connector_id FROM sessions WHERE session_id = ?`);
    let result = stmt.get(prefix) as { session_id: string; connector_id: string } | null;
    if (result) {
      if (connectorId && result.connector_id !== connectorId) {
        return null; // Wrong connector
      }
      return result;
    }

    // Try prefix match (escape SQL wildcards in user input)
    const escapedPrefix = prefix.replace(/[%_]/g, '\\$&');
    let sql = `SELECT session_id, connector_id FROM sessions WHERE session_id LIKE ? ESCAPE '\\'`;
    const params: unknown[] = [escapedPrefix + '%'];

    if (connectorId) {
      sql += ` AND connector_id = ?`;
      params.push(connectorId);
    }

    sql += ` ORDER BY started_at DESC LIMIT 1`;

    stmt = this.db.prepare(sql);
    return stmt.get(...params) as { session_id: string; connector_id: string } | null;
  }

  /**
   * Get RPC call with request/response events for replay
   * Used for send @last / send @rpc:<id>
   *
   * @param rpcId - RPC ID to look up
   * @param sessionId - Optional session ID to narrow search (required when rpc_id is not globally unique)
   */
  getRpcWithEvents(rpcId: string, sessionId?: string): {
    rpc: RpcCall;
    request?: Event;
    response?: Event;
  } | null {
    // Get RPC call - use session_id if provided to avoid ambiguity
    let rpc: RpcCall | null;
    if (sessionId) {
      const rpcStmt = this.db.prepare(`SELECT * FROM rpc_calls WHERE rpc_id = ? AND session_id = ?`);
      rpc = rpcStmt.get(rpcId, sessionId) as RpcCall | null;
    } else {
      const rpcStmt = this.db.prepare(`SELECT * FROM rpc_calls WHERE rpc_id = ?`);
      rpc = rpcStmt.get(rpcId) as RpcCall | null;
    }
    if (!rpc) return null;

    // Get request event (tools/call request)
    const reqStmt = this.db.prepare(`
      SELECT * FROM events
      WHERE session_id = ? AND rpc_id = ? AND kind = 'request'
      ORDER BY ts ASC LIMIT 1
    `);
    const request = reqStmt.get(rpc.session_id, rpcId) as Event | null;

    // Get response event
    const respStmt = this.db.prepare(`
      SELECT * FROM events
      WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
      ORDER BY ts ASC LIMIT 1
    `);
    const response = respStmt.get(rpc.session_id, rpcId) as Event | null;

    return {
      rpc,
      request: request || undefined,
      response: response || undefined,
    };
  }
}
