/**
 * EventLine Store - unified data access layer
 *
 * This provides a higher-level API for fetching EventLine data,
 * abstracting away the underlying database structure.
 */

import { EventsStore } from '../db/events-store.js';
import { ProofsStore } from '../db/proofs-store.js';
import { getEventsDb } from '../db/connection.js';
import {
  normalizeEvent,
  createSessionStartEvent,
  createSessionEndEvent,
  parseTimestamp,
} from './normalizer.js';
import type { EventLine, TreeNode } from './types.js';
import type { Event, SessionWithStats, RpcCall, Proof } from '../db/types.js';
import { discoverSchema, type SchemaInfo } from './schema-discovery.js';

export interface ViewOptions {
  limit?: number;
  since?: string | number; // ISO date, epoch ms, or relative like "24h"
  errors?: boolean;
  method?: string;
  connector?: string;
  session?: string;
  includeSessionEvents?: boolean;
}

export interface TreeOptions {
  sessions?: number;
  rpc?: number;
  session?: string;
  rpcAll?: boolean;
  method?: string;
  status?: 'ok' | 'err' | 'all';
  compact?: boolean;
  idsOnly?: boolean;
  since?: string | number;
}

export class EventLineStore {
  private eventsStore: EventsStore;
  private proofsStore: ProofsStore;
  private configDir: string;
  private schemaInfo?: SchemaInfo;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.eventsStore = new EventsStore(configDir);
    this.proofsStore = new ProofsStore(configDir);
  }

  /**
   * Discover and cache schema info
   */
  getSchema(): SchemaInfo {
    if (!this.schemaInfo) {
      const db = getEventsDb(this.configDir);
      this.schemaInfo = discoverSchema(db);
    }
    return this.schemaInfo;
  }

  /**
   * Parse "since" parameter to epoch ms
   */
  private parseSince(since?: string | number): number | undefined {
    if (!since) return undefined;

    if (typeof since === 'number') return since;

    // Relative time: 24h, 7d, 1w
    const relMatch = since.match(/^(\d+)(h|d|w|m)$/);
    if (relMatch) {
      const [, num, unit] = relMatch;
      const n = parseInt(num, 10);
      const now = Date.now();
      switch (unit) {
        case 'h': return now - n * 60 * 60 * 1000;
        case 'd': return now - n * 24 * 60 * 60 * 1000;
        case 'w': return now - n * 7 * 24 * 60 * 60 * 1000;
        case 'm': return now - n * 30 * 24 * 60 * 60 * 1000;
      }
    }

    // ISO date
    const date = new Date(since);
    return isNaN(date.getTime()) ? undefined : date.getTime();
  }

  /**
   * Get recent events as EventLines (for view command)
   */
  getRecentEvents(options: ViewOptions = {}): EventLine[] {
    const limit = options.limit || 20;
    const sinceMs = this.parseSince(options.since);

    // Get sessions and RPC calls for context
    const sessionsMap = new Map<string, SessionWithStats>();
    const rpcCallsMap = new Map<string, RpcCall>();

    // Get sessions
    let sessions: SessionWithStats[];
    if (options.connector) {
      sessions = this.eventsStore.getSessionsByConnector(options.connector, 100);
    } else {
      sessions = this.eventsStore.getAllSessions(100);
    }

    for (const s of sessions) {
      sessionsMap.set(s.session_id, s);
    }

    // Get events
    const db = getEventsDb(this.configDir);
    let sql = `
      SELECT e.*, s.connector_id
      FROM events e
      JOIN sessions s ON e.session_id = s.session_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (options.connector) {
      sql += ` AND s.connector_id = ?`;
      params.push(options.connector);
    }

    if (options.session) {
      sql += ` AND e.session_id LIKE ?`;
      params.push(options.session + '%');
    }

    if (sinceMs) {
      const sinceIso = new Date(sinceMs).toISOString();
      sql += ` AND e.ts >= ?`;
      params.push(sinceIso);
    }

    sql += ` ORDER BY e.ts DESC LIMIT ?`;
    params.push(limit * 2); // Get more to filter later

    const events = db.prepare(sql).all(...params) as Array<Event & { connector_id: string }>;

    // Get RPC calls for these events
    const sessionIds = new Set(events.map(e => e.session_id));
    for (const sessionId of sessionIds) {
      const rpcs = this.eventsStore.getRpcCallsBySession(sessionId);
      for (const rpc of rpcs) {
        rpcCallsMap.set(`${sessionId}:${rpc.rpc_id}`, rpc);
      }
    }

    // Normalize events
    let eventLines: EventLine[] = [];

    for (const event of events) {
      const session = sessionsMap.get(event.session_id);
      const rpcCall = event.rpc_id ? rpcCallsMap.get(`${event.session_id}:${event.rpc_id}`) : undefined;
      const line = normalizeEvent(event, session, rpcCall);
      line.connector_id = event.connector_id; // Ensure connector_id is set
      eventLines.push(line);
    }

    // Apply filters
    if (options.errors) {
      eventLines = eventLines.filter(e => e.status === 'ERR');
    }

    if (options.method) {
      const pattern = options.method.toLowerCase();
      eventLines = eventLines.filter(e => e.label.toLowerCase().includes(pattern));
    }

    // Add session start/end events if requested
    if (options.includeSessionEvents) {
      const sessionEvents: EventLine[] = [];
      for (const session of sessions) {
        if (sinceMs) {
          const startMs = parseTimestamp(session.started_at);
          if (startMs < sinceMs) continue;
        }
        sessionEvents.push(createSessionStartEvent(session));
        if (session.ended_at) {
          sessionEvents.push(createSessionEndEvent(session));
        }
      }
      eventLines = [...eventLines, ...sessionEvents];
    }

    // Sort by timestamp descending and limit
    eventLines.sort((a, b) => b.ts_ms - a.ts_ms);
    eventLines = eventLines.slice(0, limit);

    // Reverse to chronological order for display
    eventLines.reverse();

    return eventLines;
  }

  /**
   * Build tree structure for connector → session → rpc
   */
  buildTree(options: TreeOptions = {}): TreeNode[] {
    const sessionsLimit = options.sessions || 5;
    const rpcLimit = options.rpc || 10;
    const sinceMs = this.parseSince(options.since);

    // Get connectors (from sessions)
    const db = getEventsDb(this.configDir);
    const connectors = db.prepare(`
      SELECT DISTINCT connector_id FROM sessions ORDER BY connector_id
    `).all() as Array<{ connector_id: string }>;

    const tree: TreeNode[] = [];

    for (const { connector_id } of connectors) {
      // Get sessions for this connector
      let sessionSql = `
        SELECT s.*,
          (SELECT COUNT(*) FROM events WHERE session_id = s.session_id) as event_count,
          (SELECT COUNT(*) FROM rpc_calls WHERE session_id = s.session_id) as rpc_count
        FROM sessions s
        WHERE s.connector_id = ?
      `;
      const sessionParams: unknown[] = [connector_id];

      if (sinceMs) {
        const sinceIso = new Date(sinceMs).toISOString();
        sessionSql += ` AND s.started_at >= ?`;
        sessionParams.push(sinceIso);
      }

      if (options.session) {
        sessionSql += ` AND s.session_id LIKE ?`;
        sessionParams.push(options.session + '%');
      }

      sessionSql += ` ORDER BY s.started_at DESC LIMIT ?`;
      sessionParams.push(sessionsLimit);

      const sessions = db.prepare(sessionSql).all(...sessionParams) as SessionWithStats[];

      if (sessions.length === 0) continue;

      // Build connector node
      const connectorNode: TreeNode = {
        type: 'connector',
        id: connector_id,
        label: connector_id,
        meta: {
          session_count: sessions.length,
        },
        children: [],
      };

      for (const session of sessions) {
        // Get RPC calls for this session
        let rpcSql = `
          SELECT * FROM rpc_calls WHERE session_id = ?
        `;
        const rpcParams: unknown[] = [session.session_id];

        if (options.method) {
          rpcSql += ` AND method LIKE ?`;
          rpcParams.push('%' + options.method + '%');
        }

        if (options.status === 'ok') {
          rpcSql += ` AND success = 1`;
        } else if (options.status === 'err') {
          rpcSql += ` AND (success = 0 OR success IS NULL)`;
        }

        rpcSql += ` ORDER BY request_ts DESC`;

        if (!options.rpcAll) {
          rpcSql += ` LIMIT ?`;
          rpcParams.push(rpcLimit);
        }

        const rpcs = db.prepare(rpcSql).all(...rpcParams) as RpcCall[];

        // Calculate session duration
        let durationMs: number | undefined;
        if (session.ended_at) {
          durationMs = parseTimestamp(session.ended_at) - parseTimestamp(session.started_at);
        }

        // Build session node
        const sessionNode: TreeNode = {
          type: 'session',
          id: session.session_id,
          label: options.idsOnly
            ? session.session_id.slice(0, 8)
            : `${session.session_id.slice(0, 8)}... (${session.rpc_count || 0} rpcs, ${session.event_count || 0} events)`,
          meta: {
            connector_id: session.connector_id,
            started_at: session.started_at,
            ended_at: session.ended_at,
            exit_reason: session.exit_reason,
            duration_ms: durationMs,
            rpc_count: session.rpc_count,
            event_count: session.event_count,
          },
          children: [],
        };

        // Add RPC nodes
        for (const rpc of rpcs) {
          let latencyMs: number | undefined;
          if (rpc.response_ts) {
            latencyMs = parseTimestamp(rpc.response_ts) - parseTimestamp(rpc.request_ts);
          }

          const statusSymbol = rpc.success === 1 ? '✓' : rpc.success === 0 ? '✗' : '?';
          const rpcNode: TreeNode = {
            type: 'rpc',
            id: rpc.rpc_id,
            label: options.idsOnly
              ? `${rpc.method} (${rpc.rpc_id})`
              : `${statusSymbol} ${rpc.method} (id=${rpc.rpc_id}${latencyMs ? `, ${latencyMs}ms` : ''})`,
            meta: {
              method: rpc.method,
              success: rpc.success,
              error_code: rpc.error_code,
              latency_ms: latencyMs,
              request_ts: rpc.request_ts,
              response_ts: rpc.response_ts,
            },
          };

          sessionNode.children!.push(rpcNode);
        }

        // Add proof summary if available
        const proofs = this.proofsStore.getProofsBySession(session.session_id);
        if (proofs.length > 0) {
          sessionNode.children!.push({
            type: 'proof',
            id: 'proofs',
            label: `[${proofs.length} proof(s)]`,
            meta: {
              count: proofs.length,
              latest: proofs[0]?.created_at,
            },
          });
        }

        connectorNode.children!.push(sessionNode);
      }

      tree.push(connectorNode);
    }

    return tree;
  }

  /**
   * Get all connectors
   */
  getConnectors(): Array<{ id: string; session_count: number; latest_session?: string }> {
    const db = getEventsDb(this.configDir);
    const result = db.prepare(`
      SELECT
        connector_id as id,
        COUNT(*) as session_count,
        MAX(started_at) as latest_session
      FROM sessions
      GROUP BY connector_id
      ORDER BY latest_session DESC
    `).all() as Array<{ id: string; session_count: number; latest_session: string }>;

    return result;
  }

  /**
   * Get sessions for a connector
   */
  getSessions(connectorId?: string, limit?: number): SessionWithStats[] {
    if (connectorId) {
      return this.eventsStore.getSessionsByConnector(connectorId, limit);
    }
    return this.eventsStore.getAllSessions(limit);
  }

  /**
   * Get RPC calls for a session
   */
  getRpcCalls(sessionId: string): RpcCall[] {
    return this.eventsStore.getRpcCallsBySession(sessionId);
  }

  /**
   * Get events for a session
   */
  getSessionEvents(sessionId: string, limit?: number): EventLine[] {
    const events = this.eventsStore.getEventsBySession(sessionId, limit);
    const session = this.eventsStore.getSession(sessionId);
    const rpcs = this.eventsStore.getRpcCallsBySession(sessionId);

    const rpcMap = new Map<string, RpcCall>();
    for (const rpc of rpcs) {
      rpcMap.set(`${sessionId}:${rpc.rpc_id}`, rpc);
    }

    const eventLines = events.map(e => {
      const rpcCall = e.rpc_id ? rpcMap.get(`${sessionId}:${e.rpc_id}`) : undefined;
      return normalizeEvent(e, session || undefined, rpcCall);
    });

    return eventLines;
  }

  /**
   * Get raw event details
   */
  getRawEvent(sessionId: string, rpcId: string): { request?: Event; response?: Event } | null {
    const events = this.eventsStore.getEventsBySession(sessionId);

    const request = events.find(e => e.rpc_id === rpcId && e.kind === 'request');
    const response = events.find(e => e.rpc_id === rpcId && e.kind === 'response');

    if (!request && !response) return null;

    return { request, response };
  }

  /**
   * Get proofs for a session
   */
  getProofs(sessionId: string): Proof[] {
    return this.proofsStore.getProofsBySession(sessionId);
  }

  /**
   * Get session by ID (supports partial match)
   */
  findSession(partialId: string): SessionWithStats | null {
    const sessions = this.eventsStore.getAllSessions();
    return sessions.find(s =>
      s.session_id === partialId || s.session_id.startsWith(partialId)
    ) || null;
  }
}
