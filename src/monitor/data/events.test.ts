/**
 * Tests for Events data queries (Issue #59)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { closeAllDbs } from '../../db/connection.js';
import { EVENTS_DB_SCHEMA, EVENTS_DB_VERSION } from '../../db/schema.js';
import { getEventsBySession, getEventDetail, getEventCountsByKind } from './events.js';

describe('Events data queries', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    // Structure: testDir/proofscan.yaml + testDir/events.db
    // Note: getEventsDb(configDir) uses configDir directly (no .pfscan subdir)
    tempDir = join(
      tmpdir(),
      `proofscan-events-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });

    // Create minimal config file
    configPath = join(tempDir, 'proofscan.yaml');
    writeFileSync(configPath, 'connectors: []\n');

    // Setup test database with schema
    // DB is at configDir/events.db (same directory as config file)
    const dbPath = join(tempDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma(`user_version = ${EVENTS_DB_VERSION}`);

    // Insert test session
    db.prepare(`
      INSERT INTO sessions (session_id, connector_id, started_at, ended_at, exit_reason, protected, created_at, secret_ref_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess-001', 'test-connector', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'normal', 0, '2024-01-01T10:00:00Z', 0);

    // Insert test RPC calls
    db.prepare(`
      INSERT INTO rpc_calls (rpc_id, session_id, method, request_ts, response_ts, success, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('rpc-001', 'sess-001', 'initialize', '2024-01-01T10:00:01Z', '2024-01-01T10:00:02Z', 1, null);

    db.prepare(`
      INSERT INTO rpc_calls (rpc_id, session_id, method, request_ts, response_ts, success, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('rpc-002', 'sess-001', 'tools/list', '2024-01-01T10:00:03Z', '2024-01-01T10:00:04Z', 1, null);

    // Insert test events (request/response pairs + notification)
    const insertEvent = db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, seq, summary, payload_hash, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // initialize request
    insertEvent.run('evt-001', 'sess-001', 'rpc-001', 'client_to_server', 'request', '2024-01-01T10:00:01Z', 1, 'initialize request', 'hash1', JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }));

    // initialize response
    insertEvent.run('evt-002', 'sess-001', 'rpc-001', 'server_to_client', 'response', '2024-01-01T10:00:02Z', 2, 'initialize response', 'hash2', JSON.stringify({ jsonrpc: '2.0', result: { capabilities: {} }, id: 1 }));

    // notification from server
    insertEvent.run('evt-003', 'sess-001', null, 'server_to_client', 'notification', '2024-01-01T10:00:02.5Z', 3, 'initialized', 'hash3', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));

    // tools/list request
    insertEvent.run('evt-004', 'sess-001', 'rpc-002', 'client_to_server', 'request', '2024-01-01T10:00:03Z', 4, 'tools/list request', 'hash4', JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }));

    // tools/list response
    insertEvent.run('evt-005', 'sess-001', 'rpc-002', 'server_to_client', 'response', '2024-01-01T10:00:04Z', 5, 'tools/list response', 'hash5', JSON.stringify({ jsonrpc: '2.0', result: { tools: [] }, id: 2 }));

    // transport_event (connection closed)
    insertEvent.run('evt-006', 'sess-001', null, 'server_to_client', 'transport_event', '2024-01-01T10:05:00Z', 6, 'connection closed', null, null);

    db.close();
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getEventsBySession', () => {
    it('should return all events for a session in chronological order', () => {
      const events = getEventsBySession(configPath, 'sess-001');

      expect(events).toHaveLength(6);
      expect(events[0].event_id).toBe('evt-001');
      expect(events[5].event_id).toBe('evt-006');
    });

    it('should return correct event structure', () => {
      const events = getEventsBySession(configPath, 'sess-001');
      const requestEvent = events[0];

      expect(requestEvent).toMatchObject({
        event_id: 'evt-001',
        session_id: 'sess-001',
        rpc_id: 'rpc-001',
        direction: 'client_to_server',
        kind: 'request',
        seq: 1,
        summary: 'initialize request',
        method: 'initialize',
        has_payload: true,
      });
    });

    it('should extract method from raw_json for notifications', () => {
      const events = getEventsBySession(configPath, 'sess-001');
      const notification = events.find((e) => e.kind === 'notification');

      expect(notification).toBeDefined();
      expect(notification!.method).toBe('notifications/initialized');
      expect(notification!.rpc_id).toBeNull();
    });

    it('should handle transport_event without payload', () => {
      const events = getEventsBySession(configPath, 'sess-001');
      const transportEvent = events.find((e) => e.kind === 'transport_event');

      expect(transportEvent).toBeDefined();
      expect(transportEvent!.has_payload).toBe(false);
      expect(transportEvent!.summary).toBe('connection closed');
    });

    it('should return empty array for non-existent session', () => {
      const events = getEventsBySession(configPath, 'non-existent');
      expect(events).toHaveLength(0);
    });

    it('should respect limit option', () => {
      const events = getEventsBySession(configPath, 'sess-001', { limit: 3 });
      expect(events).toHaveLength(3);
    });
  });

  describe('getEventDetail', () => {
    it('should return event with raw_json', () => {
      const event = getEventDetail(configPath, 'evt-001');

      expect(event).toBeDefined();
      expect(event!.event_id).toBe('evt-001');
      expect(event!.raw_json).toBeDefined();
      const parsed = JSON.parse(event!.raw_json!);
      expect(parsed.method).toBe('initialize');
    });

    it('should return null for non-existent event', () => {
      const event = getEventDetail(configPath, 'non-existent');
      expect(event).toBeNull();
    });

    it('should handle event without raw_json', () => {
      const event = getEventDetail(configPath, 'evt-006');

      expect(event).toBeDefined();
      expect(event!.raw_json).toBeNull();
      expect(event!.has_payload).toBe(false);
    });
  });

  describe('getEventCountsByKind', () => {
    it('should return correct counts by kind', () => {
      const counts = getEventCountsByKind(configPath, 'sess-001');

      expect(counts).toEqual({
        request: 2,
        response: 2,
        notification: 1,
        transport_event: 1,
      });
    });

    it('should return zeros for session with no events', () => {
      const counts = getEventCountsByKind(configPath, 'non-existent');

      expect(counts).toEqual({
        request: 0,
        response: 0,
        notification: 0,
        transport_event: 0,
      });
    });
  });
});
