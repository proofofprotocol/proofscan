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
  TaskStatus,
  TaskEventKind,
  TaskEventPayload,
  TaskEvent,
  A2AMessage,
  TaskArtifact,
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

  createSession(targetId: string, options?: {
    /** @deprecated Use targetId instead */
    connectorId?: string;
    actorId?: string;
    actorKind?: string;
    actorLabel?: string;
  }): Session {
    // Support legacy connectorId for backward compatibility
    const connectorId = options?.connectorId || targetId;
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

  getSessionsByTarget(targetId: string, limit?: number): SessionWithStats[] {
    let sql = `
      SELECT s.*,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
        (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count
      FROM sessions s
      WHERE s.target_id = ?
      ORDER BY s.started_at DESC
    `;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(targetId) as SessionWithStats[];
  }

  /**
   * @deprecated Use getSessionsByTarget instead
   */
  getSessionsByConnector(connectorId: string, limit?: number): SessionWithStats[] {
    return this.getSessionsByTarget(connectorId, limit);
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

  /**
   * Get events with pagination support (Phase 6.2)
   *
   * @param sessionId - Session ID
   * @param options - Pagination options
   * @param options.limit - Maximum number of events to return (default: 50, max: 200)
   * @param options.before - Event ID for pagination cursor (exclusive)
   * @returns Events in descending order (newest first)
   */
  getEvents(sessionId: string, options: {
    limit?: number;
    before?: string;
  } = {}): Event[] {
    // Enforce max limit of 200
    let limit = options.limit ?? 50;
    if (limit > 200) {
      limit = 200;
    }

    let sql = `SELECT * FROM events WHERE session_id = ?`;
    const params: unknown[] = [sessionId];

    // Exclusive cursor: get events older than the specified event_id
    // Use composite cursor (ts, event_id) for stable pagination with same-timestamp events
    if (options.before) {
      const cursorStmt = this.db.prepare(
        `SELECT ts, event_id FROM events WHERE event_id = ?`
      );
      const cursorEvent = cursorStmt.get(options.before) as { ts: number; event_id: string } | undefined;
      if (cursorEvent) {
        // Events with earlier timestamp, OR same timestamp but earlier event_id
        sql += ` AND (ts < ? OR (ts = ? AND event_id < ?))`;
        params.push(cursorEvent.ts, cursorEvent.ts, cursorEvent.event_id);
      }
    }

    // Order by ts DESC, event_id DESC for deterministic ordering with same-timestamp events
    sql += ` ORDER BY ts DESC, event_id DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Event[];
  }

  getRecentEventsByTarget(targetId: string, limit: number = 20): Event[] {
    const stmt = this.db.prepare(`
      SELECT e.* FROM events e
      JOIN sessions s ON e.session_id = s.session_id
      WHERE s.target_id = ?
      ORDER BY e.ts DESC
      LIMIT ?
    `);
    const events = stmt.all(targetId, limit) as Event[];
    return events.reverse(); // Return in chronological order
  }

  /**
   * @deprecated Use getRecentEventsByTarget instead
   */
  getRecentEventsByConnector(connectorId: string, limit: number = 20): Event[] {
    return this.getRecentEventsByTarget(connectorId, limit);
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
    targetId?: string;
    /** @deprecated Use targetId instead */
    connectorId?: string;
  } = {}): PruneCandidate[] {
    const { keepLast, before, targetId, connectorId } = options;
    const candidates: PruneCandidate[] = [];

    // Use targetId if provided, otherwise fall back to connectorId
    const filterId = targetId || connectorId;

    // Get all unprotected sessions
    let sql = `
      SELECT s.session_id, s.target_id as connector_id, s.started_at, s.protected,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count
      FROM sessions s
      WHERE s.protected = 0
    `;
    const params: unknown[] = [];

    if (filterId) {
      sql += ` AND s.target_id = ?`;
      params.push(filterId);
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
   * Get latest session (optionally for a specific target)
   * Used by RefResolver
   */
  getLatestSession(targetId?: string): { session_id: string; target_id: string } | null {
    let sql = `SELECT session_id, target_id FROM sessions`;
    const params: unknown[] = [];

    if (targetId) {
      sql += ` WHERE target_id = ?`;
      params.push(targetId);
    }

    sql += ` ORDER BY started_at DESC LIMIT 1`;

    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as { session_id: string; target_id: string } | null;
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
  getSessionByPrefix(prefix: string, targetId?: string): { session_id: string; target_id: string } | null {
    // Try exact match first
    let stmt = this.db.prepare(`SELECT session_id, target_id FROM sessions WHERE session_id = ?`);
    let result = stmt.get(prefix) as { session_id: string; target_id: string } | null;
    if (result) {
      if (targetId && result.target_id !== targetId) {
        return null; // Wrong connector
      }
      return result;
    }

    // Try prefix match (escape SQL wildcards in user input)
    const escapedPrefix = prefix.replace(/[%_]/g, '\\$&');
    let sql = `SELECT session_id, target_id FROM sessions WHERE session_id LIKE ? ESCAPE '\\'`;
    const params: unknown[] = [escapedPrefix + '%'];

    if (targetId) {
      sql += ` AND target_id = ?`;
      params.push(targetId);
    }

    sql += ` ORDER BY started_at DESC LIMIT 1`;

    stmt = this.db.prepare(sql);
    return stmt.get(...params) as { session_id: string; target_id: string } | null;
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

  // ==================== A2A Sessions (Phase 7.0) ====================

  /**
   * Get A2A sessions for a target
   *
   * A2A sessions are sessions with actor_kind = 'agent'
   *
   * @param targetId - Target ID (agent ID)
   * @param limit - Maximum number of sessions to return
   * @returns Array of sessions with message count and last activity
   */
  getA2ASessions(targetId: string, limit = 50): Array<{
    session_id: string;
    message_count: number;
    last_activity: string;
  }> {
    const sql = `
      SELECT
        s.session_id,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id AND (normalized_json LIKE '%"actor":"user"%' OR normalized_json LIKE '%"actor":"assistant"%')) as message_count,
        COALESCE(
          (SELECT ts FROM events WHERE session_id = s.session_id ORDER BY ts DESC LIMIT 1),
          s.started_at
        ) as last_activity
      FROM sessions s
      WHERE s.target_id = ? AND s.actor_kind = 'agent'
      ORDER BY last_activity DESC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all(targetId, limit) as Array<{
      session_id: string;
      message_count: number;
      last_activity: string;
    }>;
  }

  /**
   * Get A2A messages for a session
   *
   * Returns messages with role, content, and timestamp from normalized_json
   *
   * @param sessionId - Session ID
   * @param limit - Maximum number of messages to return
   * @returns Array of A2A messages
   */
  getA2AMessages(sessionId: string, limit = 100): Array<{
    id: number;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    rawJson: string | null;
  }> {
    const sql = `
      SELECT
        e.event_id,
        e.normalized_json,
        e.raw_json,
        e.ts
      FROM events e
      WHERE e.session_id = ?
        AND e.normalized_json IS NOT NULL
        AND (e.normalized_json LIKE '%"actor":"user"%' OR e.normalized_json LIKE '%"actor":"assistant"%')
      ORDER BY e.ts ASC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    const events = stmt.all(sessionId, limit) as Array<{
      event_id: string;
      normalized_json: string | null;
      raw_json: string | null;
      ts: string;
    }>;

    const messages: Array<{
      id: number;
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
      rawJson: string | null;
    }> = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let role: 'user' | 'assistant' = 'user';
      let content = '';

      if (event.normalized_json) {
        try {
          const normalized = JSON.parse(event.normalized_json);
          if (normalized.actor === 'assistant') {
            role = 'assistant';
          }
          if (normalized.content && normalized.content.type === 'text') {
            content = normalized.content.text || '';
          }
        } catch {
          // If parsing fails, try raw_json
          if (event.raw_json) {
            try {
              const raw = JSON.parse(event.raw_json);
              // Raw format: { jsonrpc: '2.0', id: '...', result: { role: '...', parts: [...] } }
              const result = raw.result || raw;
              if (result.role === 'assistant') {
                role = 'assistant';
              }
              if (result.parts && Array.isArray(result.parts)) {
                content = result.parts
                  .filter((p: unknown) => p && typeof p === 'object' && 'text' in p)
                  .map((p: { text: string }) => p.text)
                  .join('');
              }
            } catch {
              // Parsing failed, use summary or empty
              content = '';
            }
          }
        }
      }

      messages.push({
        id: i + 1,
        role,
        content,
        timestamp: event.ts,
        rawJson: event.raw_json,
      });
    }

    return messages;
  }

  /**
   * Get A2A message detail by index
   *
   * @param sessionId - Session ID
   * @param index - Message index (1-based)
   * @returns Message detail or null if not found
   */
  getA2AMessageByIndex(sessionId: string, index: number): {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    rawJson: string | null;
  } | null {
    const messages = this.getA2AMessages(sessionId, index);
    return messages[index - 1] || null;
  }

  /**
   * Get A2A session by session ID (with metadata)
   *
   * @param sessionId - Session ID (or prefix)
   * @param targetId - Optional target ID for filtering
   * @returns Session or null
   */
  getA2ASessionById(sessionId: string, targetId?: string): {
    session_id: string;
    target_id: string;
    started_at: string;
    message_count: number;
    last_activity: string;
  } | null {
    let sql = `
      SELECT
        s.session_id,
        s.target_id,
        s.started_at,
        (SELECT COUNT(*) FROM events WHERE session_id = s.session_id AND (normalized_json LIKE '%"actor":"user"%' OR normalized_json LIKE '%"actor":"assistant"%')) as message_count,
        COALESCE(
          (SELECT ts FROM events WHERE session_id = s.session_id ORDER BY ts DESC LIMIT 1),
          s.started_at
        ) as last_activity
      FROM sessions s
      WHERE s.session_id LIKE ? AND s.actor_kind = 'agent'
    `;
    const params: unknown[] = [sessionId + '%'];

    if (targetId) {
      sql += ` AND s.target_id = ?`;
      params.push(targetId);
    }

    sql += ` ORDER BY s.started_at DESC LIMIT 1`;

    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as {
      session_id: string;
      target_id: string;
      started_at: string;
      message_count: number;
      last_activity: string;
    } | null;
  }

  /**
   * Get A2A messages across all sessions for a target (agent)
   *
   * Phase 2.3.1: Cross-session history search
   *
   * Returns messages in descending timestamp order (newest first)
   *
   * @param targetId - Target ID (agent ID)
   * @param limit - Maximum number of messages to return
   * @returns Array of A2A messages with session ID
   */
  getA2AMessagesForTarget(
    targetId: string,
    limit: number
  ): Array<{
    id: number;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }> {
    const sql = `
      SELECT
        e.session_id,
        e.ts,
        json_extract(e.normalized_json, '$.actor') as role,
        json_extract(e.normalized_json, '$.content.text') as content
      FROM events e
      JOIN sessions s ON e.session_id = s.session_id
      WHERE s.target_id = ?
        AND e.normalized_json IS NOT NULL
        AND (json_extract(e.normalized_json, '$.actor') = 'user'
             OR json_extract(e.normalized_json, '$.actor') = 'assistant')
      ORDER BY e.ts DESC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(targetId, limit) as Array<{
      session_id: string;
      ts: string;
      role: string;
      content: string | null;
    }>;

    const messages: Array<{
      id: number;
      sessionId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      messages.push({
        id: i + 1,
        sessionId: row.session_id,
        role: (row.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: row.content || '',
        timestamp: row.ts,
      });
    }

    // Return in descending order (newest first)
    return messages;
  }

  // ==================== Task Events (Phase 2.4) ====================

  /**
   * Normalize task status string to TaskStatus
   * @private
   */
  private normalizeTaskStatus(status: unknown): TaskStatus {
    if (typeof status !== 'string') return 'pending';

    const validStatuses: TaskStatus[] = [
      'pending',
      'working',
      'input_required',
      'completed',
      'failed',
      'canceled',
      'rejected',
    ];

    if (validStatuses.includes(status as TaskStatus)) {
      return status as TaskStatus;
    }

    return 'pending';
  }

  /**
   * Save a task event
   *
   * @param sessionId - Session ID
   * @param taskEventKind - Task event kind
   * @param payload - Task event payload
   * @returns Task event record
   */
  saveTaskEvent(
    sessionId: string,
    taskEventKind: TaskEventKind,
    payload: TaskEventPayload
  ): TaskEvent {
    const event: TaskEvent = {
      event_id: randomUUID(),
      session_id: sessionId,
      task_id: payload.taskId,
      event_kind: taskEventKind,
      ts: new Date().toISOString(),
      payload_json: JSON.stringify(payload),
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_events (event_id, session_id, task_id, event_kind, ts, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.session_id,
      event.task_id,
      event.event_kind,
      event.ts,
      event.payload_json
    );

    return event;
  }

  /**
   * Get task events for a session
   *
   * @param sessionId - Session ID
   * @param limit - Maximum number of events to return
   * @returns Task events in chronological order
   */
  getTaskEventsBySession(sessionId: string, limit?: number): TaskEvent[] {
    let sql = `SELECT * FROM task_events WHERE session_id = ? ORDER BY ts ASC`;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(sessionId) as TaskEvent[];
  }

  /**
   * Get task events for a specific task
   *
   * @param taskId - Task ID
   * @returns Task events for the task in chronological order
   */
  getTaskEventsByTaskId(taskId: string): TaskEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_events WHERE task_id = ? ORDER BY ts ASC
    `);
    return stmt.all(taskId) as TaskEvent[];
  }

  /**
   * Get recent task events across all sessions
   *
   * @param limit - Maximum number of events to return
   * @returns Task events in descending order (newest first)
   */
  getRecentTaskEvents(limit: number = 20): TaskEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_events ORDER BY ts DESC LIMIT ?
    `);
    const events = stmt.all(limit) as TaskEvent[];
    return events.reverse(); // Return in chronological order (oldest first)
  }

  /**
   * Get all task events for a target (agent)
   *
   * @param targetId - Target ID (agent ID)
   * @param limit - Maximum number of events to return
   * @returns Task events in chronological order
   */
  getTaskEventsByTarget(targetId: string, limit: number = 100): TaskEvent[] {
    const stmt = this.db.prepare(`
      SELECT te.* FROM task_events te
      JOIN sessions s ON te.session_id = s.session_id
      WHERE s.target_id = ?
      ORDER BY te.ts ASC
      LIMIT ?
    `);
    return stmt.all(targetId, limit) as TaskEvent[];
  }

  /**
   * Get the last recorded status for a task
   *
   * @param taskId - Task ID
   * @returns Last task event or null if not found
   */
  getLastTaskEvent(taskId: string): TaskEvent | null {
    const stmt = this.db.prepare(`
      SELECT * FROM task_events
      WHERE task_id = ?
      ORDER BY ts DESC
      LIMIT 1
    `);
    return stmt.get(taskId) as TaskEvent | null;
  }

  /**
   * Record task creation event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param rawStatus - Raw status string from response
   */
  recordTaskCreated(sessionId: string, taskId: string, rawStatus: string): void {
    const status = this.normalizeTaskStatus(rawStatus);
    this.saveTaskEvent(sessionId, 'a2a:task:created', {
      taskId,
      rawStatus,
      status,
    });
  }

  /**
   * Record task status update event
   *
   * Only records if status actually changed (no duplicate status events)
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param rawStatus - New raw status string
   * @returns True if event was recorded, false if status unchanged
   */
  recordTaskUpdated(sessionId: string, taskId: string, rawStatus: string): boolean {
    const status = this.normalizeTaskStatus(rawStatus);

    // Check last recorded status to avoid duplicate events
    const lastEvent = this.getLastTaskEvent(taskId);
    if (lastEvent) {
      const lastPayload = JSON.parse(lastEvent.payload_json) as TaskEventPayload;
      if (lastPayload.status === status) {
        // Status unchanged, don't record
        return false;
      }
    }

    this.saveTaskEvent(sessionId, 'a2a:task:updated', {
      taskId,
      rawStatus,
      status,
      previousStatus: lastEvent
        ? (JSON.parse(lastEvent.payload_json) as TaskEventPayload).status
        : undefined,
    });
    return true;
  }

  /**
   * Record task completion event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param rawStatus - Raw status string
   * @param messages - Messages (optional)
   * @param artifacts - Artifacts (optional)
   */
  recordTaskCompleted(
    sessionId: string,
    taskId: string,
    rawStatus: string,
    messages?: A2AMessage[],
    artifacts?: TaskArtifact[]
  ): void {
    this.saveTaskEvent(sessionId, 'a2a:task:completed', {
      taskId,
      rawStatus,
      status: 'completed',
      messages,
      artifacts,
    });
  }

  /**
   * Record task failure event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param rawStatus - Raw status string
   * @param error - Error message
   */
  recordTaskFailed(sessionId: string, taskId: string, rawStatus: string, error?: string): void {
    this.saveTaskEvent(sessionId, 'a2a:task:failed', {
      taskId,
      rawStatus,
      status: 'failed',
      error,
    });
  }

  /**
   * Record task cancellation event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param rawStatus - Raw status string
   */
  recordTaskCanceled(sessionId: string, taskId: string, rawStatus: string): void {
    this.saveTaskEvent(sessionId, 'a2a:task:canceled', {
      taskId,
      rawStatus,
      status: 'canceled',
    });
  }

  /**
   * Record task wait timeout event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param error - Error message
   */
  recordTaskWaitTimeout(sessionId: string, taskId: string, error?: string): void {
    this.saveTaskEvent(sessionId, 'a2a:task:wait_timeout', {
      taskId,
      rawStatus: 'timeout',
      status: 'failed',
      error: error || 'Task wait timeout',
    });
  }

  /**
   * Record task poll error event
   *
   * @param sessionId - Session ID
   * @param taskId - Task ID
   * @param error - Error message
   */
  recordTaskPollError(sessionId: string, taskId: string, error?: string): void {
    this.saveTaskEvent(sessionId, 'a2a:task:poll_error', {
      taskId,
      rawStatus: 'poll_error',
      status: 'failed',
      error: error || 'Task poll error',
    });
  }

  // ==================== UI Events (Phase 6.2) ====================

  /**
   * Save a UI tool request event
   *
   * @param uiSessionId - UI session ID (derived from sessionToken)
   * @param uiRpcId - UI RPC ID
   * @param correlationId - Correlation ID
   * @param toolCallFingerprint - Tool call fingerprint
   * @param toolName - Tool name
   * @param payload - Event payload (arguments, sessionToken, etc.)
   * @returns UI event record
   */
  saveUiToolRequestEvent(
    uiSessionId: string,
    uiRpcId: string,
    correlationId: string,
    toolCallFingerprint: string,
    toolName: string,
    payload: {
      arguments: Record<string, unknown>;
      sessionToken?: string; // Recorded for audit, but never forwarded to server
    }
  ): {
    event_id: string;
    ts: number;
  } {
    const event = {
      event_id: randomUUID(),
      ui_session_id: uiSessionId,
      ui_rpc_id: uiRpcId,
      correlation_id: correlationId,
      tool_call_fingerprint: toolCallFingerprint,
      event_type: 'ui_tool_request' as const,
      tool_name: toolName,
      ts: Date.now(),
      payload_json: JSON.stringify(payload),
    };

    const stmt = this.db.prepare(`
      INSERT INTO ui_events (event_id, ui_session_id, ui_rpc_id, correlation_id, tool_call_fingerprint, event_type, tool_name, ts, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.ui_session_id,
      event.ui_rpc_id,
      event.correlation_id,
      event.tool_call_fingerprint,
      event.event_type,
      event.tool_name,
      event.ts,
      event.payload_json
    );

    return { event_id: event.event_id, ts: event.ts };
  }

  /**
   * Save a UI tool result event
   *
   * @param uiSessionId - UI session ID
   * @param uiRpcId - UI RPC ID
   * @param correlationId - Correlation ID
   * @param toolCallFingerprint - Tool call fingerprint
   * @param payload - Event payload (result, duration_ms, etc.)
   * @returns UI event record
   */
  saveUiToolResultEvent(
    uiSessionId: string,
    uiRpcId: string,
    correlationId: string,
    toolCallFingerprint: string,
    payload: {
      result: unknown;
      duration_ms: number;
    }
  ): {
    event_id: string;
    ts: number;
  } {
    const event = {
      event_id: randomUUID(),
      ui_session_id: uiSessionId,
      ui_rpc_id: uiRpcId,
      correlation_id: correlationId,
      tool_call_fingerprint: toolCallFingerprint,
      event_type: 'ui_tool_result' as const,
      tool_name: null,
      ts: Date.now(),
      payload_json: JSON.stringify(payload),
    };

    const stmt = this.db.prepare(`
      INSERT INTO ui_events (event_id, ui_session_id, ui_rpc_id, correlation_id, tool_call_fingerprint, event_type, tool_name, ts, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.ui_session_id,
      event.ui_rpc_id,
      event.correlation_id,
      event.tool_call_fingerprint,
      event.event_type,
      event.tool_name,
      event.ts,
      event.payload_json
    );

    return { event_id: event.event_id, ts: event.ts };
  }

  /**
   * Save a UI tool delivered event (sent to UI)
   *
   * @param uiSessionId - UI session ID
   * @param uiRpcId - UI RPC ID
   * @param correlationId - Correlation ID
   * @param toolCallFingerprint - Tool call fingerprint
   * @param payload - Event payload (result)
   * @returns UI event record
   */
  saveUiToolDeliveredEvent(
    uiSessionId: string,
    uiRpcId: string,
    correlationId: string,
    toolCallFingerprint: string,
    payload: { result: unknown }
  ): {
    event_id: string;
    ts: number;
  } {
    const event = {
      event_id: randomUUID(),
      ui_session_id: uiSessionId,
      ui_rpc_id: uiRpcId,
      correlation_id: correlationId,
      tool_call_fingerprint: toolCallFingerprint,
      event_type: 'ui_tool_delivered' as const,
      tool_name: null,
      ts: Date.now(),
      payload_json: JSON.stringify(payload),
    };

    const stmt = this.db.prepare(`
      INSERT INTO ui_events (event_id, ui_session_id, ui_rpc_id, correlation_id, tool_call_fingerprint, event_type, tool_name, ts, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.event_id,
      event.ui_session_id,
      event.ui_rpc_id,
      event.correlation_id,
      event.tool_call_fingerprint,
      event.event_type,
      event.tool_name,
      event.ts,
      event.payload_json
    );

    return { event_id: event.event_id, ts: event.ts };
  }

  /**
   * Get UI events by correlation ID
   *
   * @param correlationId - Correlation ID
   * @returns UI events with matching correlation ID
   */
  getUiEventsByCorrelationId(correlationId: string): Array<{
    event_id: string;
    ui_session_id: string;
    ui_rpc_id: string;
    correlation_id: string;
    tool_call_fingerprint: string;
    event_type: string;
    tool_name: string | null;
    ts: number;
    payload_json: string | null;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM ui_events WHERE correlation_id = ? ORDER BY ts ASC
    `);
    return stmt.all(correlationId) as Array<{
      event_id: string;
      ui_session_id: string;
      ui_rpc_id: string;
      correlation_id: string;
      tool_call_fingerprint: string;
      event_type: string;
      tool_name: string | null;
      ts: number;
      payload_json: string | null;
    }>;
  }

  /**
   * Get UI events by session ID
   *
   * @param uiSessionId - UI session ID
   * @param limit - Maximum number of events to return
   * @returns UI events for the session
   */
  getUiEventsBySession(uiSessionId: string, limit = 100): Array<{
    event_id: string;
    ui_session_id: string;
    ui_rpc_id: string;
    correlation_id: string;
    tool_call_fingerprint: string;
    event_type: string;
    tool_name: string | null;
    ts: number;
    payload_json: string | null;
  }> {
    const sql = `
      SELECT * FROM ui_events
      WHERE ui_session_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all(uiSessionId, limit) as Array<{
      event_id: string;
      ui_session_id: string;
      ui_rpc_id: string;
      correlation_id: string;
      tool_call_fingerprint: string;
      event_type: string;
      tool_name: string | null;
      ts: number;
      payload_json: string | null;
    }>;
  }

  // ==================== Gateway Audit Events (Phase 8.5) ====================

  /**
   * Save a gateway audit event
   *
   * @param options - Gateway event options
   * @returns Event ID of the saved event
   */
  saveGatewayEvent(options: {
    requestId: string;
    traceId: string | null;
    clientId: string;
    eventKind: import('./types.js').GatewayEventKind;
    targetId: string | null;
    method: string | null;
    latencyMs: number | null;
    upstreamLatencyMs: number | null;
    decision: string | null;
    denyReason: string | null;
    error: string | null;
    statusCode: number | null;
    metadata: Record<string, unknown> | null;
  }): string {
    const eventId = randomUUID();
    const ts = new Date().toISOString();
    const metadataJson = options.metadata ? JSON.stringify(options.metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO gateway_events (
        event_id, request_id, trace_id, client_id, event_kind, target_id, method,
        ts, latency_ms, upstream_latency_ms, decision, deny_reason, error, status_code, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      eventId,
      options.requestId,
      options.traceId,
      options.clientId,
      options.eventKind,
      options.targetId,
      options.method,
      ts,
      options.latencyMs,
      options.upstreamLatencyMs,
      options.decision,
      options.denyReason,
      options.error,
      options.statusCode,
      metadataJson
    );

    return eventId;
  }

  /**
   * Get gateway events by request ID
   *
   * @param requestId - Request ID
   * @returns Gateway events for the request
   */
  getGatewayEventsByRequestId(requestId: string): import('./types.js').GatewayEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM gateway_events WHERE request_id = ? ORDER BY ts ASC
    `);
    return stmt.all(requestId) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get gateway events by client ID
   *
   * @param clientId - Client ID
   * @param limit - Maximum number of events to return
   * @returns Gateway events for the client
   */
  getGatewayEventsByClientId(clientId: string, limit = 100): import('./types.js').GatewayEvent[] {
    const sql = `
      SELECT * FROM gateway_events
      WHERE client_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all(clientId, limit) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get gateway events by target ID
   *
   * @param targetId - Target ID (connector or agent)
   * @param limit - Maximum number of events to return
   * @returns Gateway events for the target
   */
  getGatewayEventsByTargetId(targetId: string, limit = 100): import('./types.js').GatewayEvent[] {
    const sql = `
      SELECT * FROM gateway_events
      WHERE target_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all(targetId, limit) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get recent gateway events
   *
   * @param limit - Maximum number of events to return
   * @param eventKind - Optional filter by event kind
   * @returns Recent gateway events
   */
  getRecentGatewayEvents(
    limit = 50,
    eventKind?: import('./types.js').GatewayEventKind
  ): import('./types.js').GatewayEvent[] {
    let sql = `SELECT * FROM gateway_events`;
    const params: unknown[] = [];

    if (eventKind) {
      sql += ` WHERE event_kind = ?`;
      params.push(eventKind);
    }

    sql += ` ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get gateway events by trace ID (for distributed tracing)
   *
   * @param traceId - Trace ID
   * @returns Gateway events with the trace ID
   */
  getGatewayEventsByTraceId(traceId: string): import('./types.js').GatewayEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM gateway_events WHERE trace_id = ? ORDER BY ts ASC
    `);
    return stmt.all(traceId) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get gateway error events
   *
   * @param limit - Maximum number of events to return
   * @param since - Optional ISO8601 timestamp to filter events after
   * @returns Gateway error events
   */
  getGatewayErrors(limit = 50, since?: string): import('./types.js').GatewayEvent[] {
    let sql = `SELECT * FROM gateway_events WHERE event_kind = 'gateway_error'`;
    const params: unknown[] = [];

    if (since) {
      sql += ` AND ts > ?`;
      params.push(since);
    }

    sql += ` ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as import('./types.js').GatewayEvent[];
  }

  /**
   * Get gateway auth failure events
   *
   * @param limit - Maximum number of events to return
   * @param since - Optional ISO8601 timestamp to filter events after
   * @returns Gateway auth failure events
   */
  getGatewayAuthFailures(limit = 50, since?: string): import('./types.js').GatewayEvent[] {
    let sql = `SELECT * FROM gateway_events WHERE event_kind = 'gateway_auth_failure'`;
    const params: unknown[] = [];

    if (since) {
      sql += ` AND ts > ?`;
      params.push(since);
    }

    sql += ` ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as import('./types.js').GatewayEvent[];
  }
}
