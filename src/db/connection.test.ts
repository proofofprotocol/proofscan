/**
 * Tests for database connection and diagnostics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { diagnoseEventsDb, fixEventsDb, getDbPaths, DbDiagnostic } from './connection.js';

describe('diagnoseEventsDb', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should report non-existent database', () => {
    const result = diagnoseEventsDb(testDir);

    expect(result.exists).toBe(false);
    expect(result.readable).toBe(false);
    expect(result.userVersion).toBeNull();
    expect(result.tables).toEqual([]);
    expect(result.missingTables).toEqual([]);
  });

  it('should detect missing tables in empty database', () => {
    // Create empty database
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.close();

    const result = diagnoseEventsDb(testDir);

    expect(result.exists).toBe(true);
    expect(result.readable).toBe(true);
    expect(result.userVersion).toBe(0);
    expect(result.tables).toEqual([]);
    expect(result.missingTables).toContain('sessions');
    expect(result.missingTables).toContain('rpc_calls');
    expect(result.missingTables).toContain('events');
    expect(result.missingTables).toContain('actors');
  });

  it('should detect missing columns in sessions table', () => {
    // Create database with sessions table but missing columns
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE rpc_calls (id TEXT PRIMARY KEY);
      CREATE TABLE events (id TEXT PRIMARY KEY);
      CREATE TABLE actors (id TEXT PRIMARY KEY);
    `);
    db.pragma('user_version = 3');
    db.close();

    const result = diagnoseEventsDb(testDir);

    expect(result.exists).toBe(true);
    expect(result.readable).toBe(true);
    expect(result.userVersion).toBe(3);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toContainEqual({ table: 'sessions', column: 'actor_id' });
    expect(result.missingColumns).toContainEqual({ table: 'sessions', column: 'actor_kind' });
    expect(result.missingColumns).toContainEqual({ table: 'sessions', column: 'actor_label' });
    expect(result.missingColumns).toContainEqual({ table: 'sessions', column: 'secret_ref_count' });
  });

  it('should report no issues for complete database', () => {
    // Create complete database
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        actor_id TEXT,
        actor_kind TEXT,
        actor_label TEXT,
        secret_ref_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE rpc_calls (id TEXT PRIMARY KEY);
      CREATE TABLE events (id TEXT PRIMARY KEY);
      CREATE TABLE actors (id TEXT PRIMARY KEY);
    `);
    db.pragma('user_version = 3');
    db.close();

    const result = diagnoseEventsDb(testDir);

    expect(result.exists).toBe(true);
    expect(result.readable).toBe(true);
    expect(result.userVersion).toBe(3);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toEqual([]);
  });

  it('should handle corrupted database file', () => {
    // Create invalid database file with wrong header
    const dbPath = join(testDir, 'events.db');
    // SQLite header starts with "SQLite format 3\000" - we corrupt it
    writeFileSync(dbPath, 'corrupted sqlite header data that is long enough');

    const result = diagnoseEventsDb(testDir);

    expect(result.exists).toBe(true);
    // Note: better-sqlite3 may still open some corrupted files
    // but will fail on operations. Check for either case.
    if (!result.readable) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('fixEventsDb', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create missing actors table', () => {
    // Create database without actors table
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        actor_id TEXT,
        actor_kind TEXT,
        actor_label TEXT,
        secret_ref_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.close();

    const result = fixEventsDb(testDir);

    expect(result.success).toBe(true);
    expect(result.fixed).toContain('table:actors');

    // Verify table was created
    const diagnostic = diagnoseEventsDb(testDir);
    expect(diagnostic.tables).toContain('actors');
  });

  it('should add missing columns to sessions table', () => {
    // Create database with sessions table missing columns
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE actors (id TEXT PRIMARY KEY);
    `);
    db.close();

    const result = fixEventsDb(testDir);

    expect(result.success).toBe(true);
    expect(result.fixed).toContain('column:sessions.actor_id');
    expect(result.fixed).toContain('column:sessions.actor_kind');
    expect(result.fixed).toContain('column:sessions.actor_label');
    expect(result.fixed).toContain('column:sessions.secret_ref_count');

    // Verify columns were added
    const diagnostic = diagnoseEventsDb(testDir);
    expect(diagnostic.missingColumns).toEqual([]);
  });

  it('should not report fixes for already complete database', () => {
    // Create complete database
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        actor_id TEXT,
        actor_kind TEXT,
        actor_label TEXT,
        secret_ref_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE actors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `);
    db.close();

    const result = fixEventsDb(testDir);

    expect(result.success).toBe(true);
    expect(result.fixed).toEqual([]);
  });

  it('should handle non-existent database directory gracefully', () => {
    // Use a directory that doesn't exist
    const nonExistentDir = join(testDir, 'nonexistent', 'deep', 'path');
    const result = fixEventsDb(nonExistentDir);

    // better-sqlite3 will fail to create file in non-existent directory
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle missing sessions table gracefully', () => {
    // Create database with only actors table (no sessions)
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE actors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `);
    db.close();

    const result = fixEventsDb(testDir);

    // Should succeed without trying to add columns to non-existent sessions table
    expect(result.success).toBe(true);
    // Should not include any column fixes since sessions doesn't exist
    expect(result.fixed.filter(f => f.startsWith('column:'))).toEqual([]);
  });
});

describe('getDbPaths', () => {
  it('should return correct paths for config directory', () => {
    const testDir = '/test/config/dir';
    const paths = getDbPaths(testDir);

    expect(paths.events).toBe('/test/config/dir/events.db');
    expect(paths.proofs).toBe('/test/config/dir/proofs.db');
  });
});
