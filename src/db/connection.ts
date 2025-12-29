/**
 * Database connection management
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, statSync } from 'fs';
import { EVENTS_DB_SCHEMA, PROOFS_DB_SCHEMA, EVENTS_DB_VERSION, PROOFS_DB_VERSION, EVENTS_DB_MIGRATION_1_TO_2 } from './schema.js';
import { getDefaultConfigDir } from '../utils/config-path.js';

let eventsDb: Database.Database | null = null;
let proofsDb: Database.Database | null = null;
let dbDir: string | null = null;

/**
 * Get the database directory
 */
export function getDbDir(configDir?: string): string {
  return configDir || getDefaultConfigDir();
}

/**
 * Initialize events.db with migrations
 */
function initEventsDb(dir: string): Database.Database {
  const dbPath = join(dir, 'events.db');
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Check version
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion === 0) {
    // Fresh database - create full schema
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
  } else if (currentVersion < EVENTS_DB_VERSION) {
    // Run incremental migrations
    runEventsMigrations(db, currentVersion);
    db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
  }

  return db;
}

/**
 * Run incremental migrations for events.db
 */
function runEventsMigrations(db: Database.Database, fromVersion: number): void {
  // Migration 1 → 2: Add seq, summary, payload_hash columns
  if (fromVersion < 2) {
    try {
      // Run migration in a transaction
      db.exec('BEGIN TRANSACTION');

      // SQLite doesn't support multiple ALTER TABLE in one exec
      // Split the migration into individual statements
      const statements = EVENTS_DB_MIGRATION_1_TO_2
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (err) {
          // Ignore "duplicate column" errors (column already exists)
          if (err instanceof Error && !err.message.includes('duplicate column')) {
            throw err;
          }
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Future migrations go here:
  // if (fromVersion < 3) { ... }
}

/**
 * Initialize proofs.db
 */
function initProofsDb(dir: string): Database.Database {
  const dbPath = join(dir, 'proofs.db');
  const db = new Database(dbPath);

  // Check version
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion < PROOFS_DB_VERSION) {
    // Run migrations
    db.exec(PROOFS_DB_SCHEMA);
    db.pragma(`user_version = ${PROOFS_DB_VERSION}`);
  }

  return db;
}

/**
 * Get or create events database connection
 */
export function getEventsDb(configDir?: string): Database.Database {
  const dir = getDbDir(configDir);

  if (eventsDb && dbDir === dir) {
    return eventsDb;
  }

  // Ensure directory exists
  mkdirSync(dir, { recursive: true });

  // Close existing connection if different dir
  if (eventsDb) {
    eventsDb.close();
  }

  dbDir = dir;
  eventsDb = initEventsDb(dir);
  return eventsDb;
}

/**
 * Get or create proofs database connection
 */
export function getProofsDb(configDir?: string): Database.Database {
  const dir = getDbDir(configDir);

  if (proofsDb && dbDir === dir) {
    return proofsDb;
  }

  // Ensure directory exists
  mkdirSync(dir, { recursive: true });

  // Close existing connection if different dir
  if (proofsDb) {
    proofsDb.close();
  }

  dbDir = dir;
  proofsDb = initProofsDb(dir);
  return proofsDb;
}

/**
 * Close all database connections
 */
export function closeAllDbs(): void {
  if (eventsDb) {
    eventsDb.close();
    eventsDb = null;
  }
  if (proofsDb) {
    proofsDb.close();
    proofsDb = null;
  }
  dbDir = null;
}

/**
 * Get database file sizes in bytes
 */
export function getDbSizes(configDir?: string): { events: number; proofs: number } {
  const dir = getDbDir(configDir);

  let eventsSize = 0;
  let proofsSize = 0;

  try {
    const eventsPath = join(dir, 'events.db');
    eventsSize = statSync(eventsPath).size;
  } catch {
    // File doesn't exist yet
  }

  try {
    const proofsPath = join(dir, 'proofs.db');
    proofsSize = statSync(proofsPath).size;
  } catch {
    // File doesn't exist yet
  }

  return { events: eventsSize, proofs: proofsSize };
}
