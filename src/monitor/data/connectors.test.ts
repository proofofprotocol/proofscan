/**
 * Tests for monitor connector data queries
 *
 * Critical: Tests cross-connector data isolation to prevent data leakage
 * when rpc_id values collide across different sessions/connectors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { getHomeData, getConnectorDetail } from './connectors.js';
import { EVENTS_DB_SCHEMA, EVENTS_DB_VERSION } from '../../db/schema.js';

describe('Cross-connector data isolation', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    // Structure: testDir/proofscan.yaml + testDir/events.db
    // Note: getEventsDb(configDir) uses configDir directly (no .pfscan subdir)
    testDir = join(
      tmpdir(),
      `proofscan-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Create minimal config file
    // Note: connectors array can be empty because we test with "orphan" connectors
    // that exist only in DB (not in config) to avoid ConfigManager YAML parsing issues
    configPath = join(testDir, 'proofscan.yaml');
    writeFileSync(configPath, 'connectors: []\n');

    // Setup test database with schema
    // DB is at configDir/events.db (same directory as config file)
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma(`user_version = ${EVENTS_DB_VERSION}`);

    // Insert test data with SAME rpc_id values in different sessions
    // This is the critical scenario that caused the bug
    const now = new Date().toISOString();

    // Session A for connector-a
    db.prepare(`
      INSERT INTO sessions (session_id, connector_id, started_at, created_at)
      VALUES ('session-a', 'connector-a', ?, ?)
    `).run(now, now);

    // Session B for connector-b
    db.prepare(`
      INSERT INTO sessions (session_id, connector_id, started_at, created_at)
      VALUES ('session-b', 'connector-b', ?, ?)
    `).run(now, now);

    // RPC calls with SAME rpc_id "1" in both sessions (different content)
    // This simulates the real-world scenario where JSON-RPC id values collide
    db.prepare(`
      INSERT INTO rpc_calls (rpc_id, session_id, method, request_ts, response_ts, success)
      VALUES ('1', 'session-a', 'initialize', ?, ?, 1)
    `).run(now, now);

    db.prepare(`
      INSERT INTO rpc_calls (rpc_id, session_id, method, request_ts, response_ts, success)
      VALUES ('1', 'session-b', 'initialize', ?, ?, 1)
    `).run(now, now);

    // Events with different serverInfo for each connector
    // Connector A: serverInfo.name = "server-alpha"
    db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, raw_json)
      VALUES (
        'event-a-req', 'session-a', '1', 'client_to_server', 'request', ?,
        '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}'
      )
    `).run(now);

    db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, raw_json)
      VALUES (
        'event-a-res', 'session-a', '1', 'server_to_client', 'response', ?,
        '{"jsonrpc":"2.0","id":"1","result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"server-alpha","version":"1.0.0"},"capabilities":{"tools":{}}}}'
      )
    `).run(now);

    // Connector B: serverInfo.name = "server-beta"
    db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, raw_json)
      VALUES (
        'event-b-req', 'session-b', '1', 'client_to_server', 'request', ?,
        '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}'
      )
    `).run(now);

    db.prepare(`
      INSERT INTO events (event_id, session_id, rpc_id, direction, kind, ts, raw_json)
      VALUES (
        'event-b-res', 'session-b', '1', 'server_to_client', 'response', ?,
        '{"jsonrpc":"2.0","id":"1","result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"server-beta","version":"2.0.0"},"capabilities":{"resources":{}}}}'
      )
    `).run(now);

    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return correct serverInfo for connector-a (not connector-b data)', async () => {
    // connector-a exists only in DB (orphan connector) since config has empty connectors array
    const detail = await getConnectorDetail(configPath, 'connector-a');

    expect(detail).not.toBeNull();
    expect(detail?.connector_id).toBe('connector-a');
    // Critical assertion: should see "server-alpha", NOT "server-beta"
    // This verifies the SQL JOIN uses session_id to isolate data
    expect(detail?.package_name).toBe('server-alpha');
    expect(detail?.package_version).toBe('1.0.0');
  });

  it('should return correct serverInfo for connector-b (not connector-a data)', async () => {
    // connector-b exists only in DB (orphan connector)
    const detail = await getConnectorDetail(configPath, 'connector-b');

    expect(detail).not.toBeNull();
    expect(detail?.connector_id).toBe('connector-b');
    // Critical assertion: should see "server-beta", NOT "server-alpha"
    // Without the session_id fix, this would return "server-alpha" due to rpc_id collision
    expect(detail?.package_name).toBe('server-beta');
    expect(detail?.package_version).toBe('2.0.0');
  });

  it('should isolate protocol detection per connector', async () => {
    const detailA = await getConnectorDetail(configPath, 'connector-a');
    const detailB = await getConnectorDetail(configPath, 'connector-b');

    expect(detailA).not.toBeNull();
    expect(detailB).not.toBeNull();

    // Both should be detected as MCP (they have serverInfo in initialize response)
    expect(detailA?.protocol).toBe('MCP');
    expect(detailB?.protocol).toBe('MCP');

    // Verify they have different server names (isolation works)
    expect(detailA?.package_name).not.toBe(detailB?.package_name);
  });

  it('should return isolated data in home page connector list', async () => {
    const homeData = await getHomeData(configPath, new Date().toISOString());

    // Both connectors should appear as orphan connectors (in DB but not config)
    expect(homeData.connectors.length).toBeGreaterThanOrEqual(2);

    const connectorA = homeData.connectors.find((c) => c.connector_id === 'connector-a');
    const connectorB = homeData.connectors.find((c) => c.connector_id === 'connector-b');

    expect(connectorA).toBeDefined();
    expect(connectorB).toBeDefined();

    // Each connector should have its own serverInfo (not the other's)
    expect(connectorA?.package_name).toBe('server-alpha');
    expect(connectorB?.package_name).toBe('server-beta');
    expect(connectorA?.package_version).toBe('1.0.0');
    expect(connectorB?.package_version).toBe('2.0.0');
  });
});

describe('ULID validation', () => {
  it('should accept valid ULID format', () => {
    // ULID regex from the modal script
    const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

    // Valid ULIDs
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(ULID_REGEX.test('01HX1234567890ABCDEFGHJKMN')).toBe(true);
    expect(ULID_REGEX.test('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
  });

  it('should reject invalid ULID formats', () => {
    const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

    // Invalid: wrong length
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // 25 chars
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAVA')).toBe(false); // 27 chars

    // Invalid: contains excluded characters (I, L, O, U)
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQI9G5FAV')).toBe(false); // contains I
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQL9G5FAV')).toBe(false); // contains L
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQO9G5FAV')).toBe(false); // contains O
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQU9G5FAV')).toBe(false); // contains U

    // Invalid: contains special characters
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ6-G5FAV')).toBe(false);
    expect(ULID_REGEX.test('<script>alert(1)</script>')).toBe(false);

    // Invalid: empty or null-ish
    expect(ULID_REGEX.test('')).toBe(false);
  });
});
