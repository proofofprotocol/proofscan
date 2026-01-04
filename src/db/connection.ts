/**
 * Database connection management
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, statSync } from 'fs';
import { EVENTS_DB_SCHEMA, PROOFS_DB_SCHEMA, EVENTS_DB_VERSION, PROOFS_DB_VERSION, EVENTS_DB_MIGRATION_1_TO_2, EVENTS_DB_MIGRATION_2_TO_3, EVENTS_DB_MIGRATION_3_TO_4, EVENTS_DB_MIGRATION_4_TO_5 } from './schema.js';
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
 * Print helpful error message for DB failures
 */
function printDbError(dbPath: string, err: unknown, operation: 'open' | 'migrate'): void {
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error(`  Database ${operation} failed`);
  console.error('═══════════════════════════════════════════════════════════');
  console.error(`  Path: ${dbPath}`);
  if (err instanceof Error) {
    console.error(`  Error: ${err.message}`);
  }
  console.error('');
  console.error('  Recovery options:');
  console.error('');
  console.error('  1. Backup and recreate (loses existing data):');
  console.error(`     mv "${dbPath}" "${dbPath}.bak"`);
  console.error('     pfscan status   # will recreate fresh DB');
  console.error('');
  console.error('  2. Run diagnostics:');
  console.error('     pfscan doctor');
  console.error('');
  console.error('  3. Try manual repair:');
  console.error('     pfscan doctor --fix');
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');
}

/**
 * Initialize events.db with migrations
 */
function initEventsDb(dir: string): Database.Database {
  const dbPath = join(dir, 'events.db');

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (err) {
    printDbError(dbPath, err, 'open');
    throw err;
  }

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Check version
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  try {
    if (currentVersion === 0) {
      // Fresh database - create full schema
      db.exec(EVENTS_DB_SCHEMA);
      db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
    } else if (currentVersion < EVENTS_DB_VERSION) {
      // Run incremental migrations
      runEventsMigrations(db, currentVersion);
      db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
    }
  } catch (err) {
    // Close DB before re-throwing to prevent resource leak
    db.close();
    printDbError(dbPath, err, 'migrate');
    throw err;
  }

  return db;
}

/**
 * Ensure critical tables exist (guard against partial migrations)
 * This runs BEFORE version-based migrations to handle edge cases
 */
function ensureCriticalTables(db: Database.Database): void {
  // Phase 3.4: Ensure actors table exists (may be missing if migration failed partway)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_actors_kind ON actors(kind);
      CREATE INDEX IF NOT EXISTS idx_actors_revoked ON actors(revoked_at);
    `);
  } catch (err) {
    // Only ignore "table already exists" errors - warn on other errors
    if (err instanceof Error && !err.message.includes('already exists')) {
      console.warn('Warning: Failed to create critical tables:', err.message);
    }
  }

  // Phase 4.1: Ensure user_refs table exists (with popl kind support)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_refs (
        name TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
        connector TEXT,
        session TEXT,
        rpc TEXT,
        proto TEXT,
        level TEXT,
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);
      CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
    `);
  } catch (err) {
    // Only ignore "table already exists" errors - warn on other errors
    if (err instanceof Error && !err.message.includes('already exists')) {
      console.warn('Warning: Failed to create user_refs table:', err.message);
    }
  }
}

/**
 * Run incremental migrations for events.db
 */
function runEventsMigrations(db: Database.Database, fromVersion: number): void {
  // Guard: Ensure critical tables exist before running migrations
  ensureCriticalTables(db);

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

  // Migration 2 → 3: Add actor columns, secret_ref_count, actors table (Phase 3.4)
  if (fromVersion < 3) {
    try {
      db.exec('BEGIN TRANSACTION');

      const statements = EVENTS_DB_MIGRATION_2_TO_3
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (err) {
          // Ignore "duplicate column" and "table already exists" errors
          if (err instanceof Error &&
              !err.message.includes('duplicate column') &&
              !err.message.includes('already exists')) {
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

  // Migration 3 → 4: Add user_refs table (Phase 4.1)
  if (fromVersion < 4) {
    try {
      db.exec('BEGIN TRANSACTION');

      const statements = EVENTS_DB_MIGRATION_3_TO_4
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (err) {
          // Ignore "table already exists" errors
          if (err instanceof Error &&
              !err.message.includes('already exists')) {
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

  // Migration 4 → 5: Add 'popl' to user_refs kind constraint (Phase 6.0)
  if (fromVersion < 5) {
    try {
      db.exec('BEGIN TRANSACTION');

      const statements = EVENTS_DB_MIGRATION_4_TO_5
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (err) {
          // Ignore "table already exists" errors
          if (err instanceof Error &&
              !err.message.includes('already exists')) {
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

/**
 * Get database paths
 */
export function getDbPaths(configDir?: string): { events: string; proofs: string } {
  const dir = getDbDir(configDir);
  return {
    events: join(dir, 'events.db'),
    proofs: join(dir, 'proofs.db'),
  };
}

/**
 * Database diagnostic result
 */
export interface DbDiagnostic {
  path: string;
  exists: boolean;
  readable: boolean;
  userVersion: number | null;
  tables: string[];
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
  error?: string;
}

/**
 * Run diagnostics on events.db without modifying it
 */
export function diagnoseEventsDb(configDir?: string): DbDiagnostic {
  const dir = getDbDir(configDir);
  const dbPath = join(dir, 'events.db');

  const result: DbDiagnostic = {
    path: dbPath,
    exists: false,
    readable: false,
    userVersion: null,
    tables: [],
    missingTables: [],
    missingColumns: [],
  };

  // Check if file exists
  try {
    statSync(dbPath);
    result.exists = true;
  } catch {
    return result;
  }

  // Try to open and read
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    result.readable = true;

    // Get user_version
    result.userVersion = db.pragma('user_version', { simple: true }) as number;

    // Get existing tables
    const tablesResult = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];
    result.tables = tablesResult.map(t => t.name).sort();

    // Check for required tables (Phase 4.1: added user_refs)
    const requiredTables = ['sessions', 'rpc_calls', 'events', 'actors', 'user_refs'];
    result.missingTables = requiredTables.filter(t => !result.tables.includes(t));

    // Check for required columns in sessions table (Phase 3.4)
    if (result.tables.includes('sessions')) {
      const columnsResult = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      const existingColumns = new Set(columnsResult.map(c => c.name));
      const requiredSessionColumns = ['actor_id', 'actor_kind', 'actor_label', 'secret_ref_count'];
      for (const col of requiredSessionColumns) {
        if (!existingColumns.has(col)) {
          result.missingColumns.push({ table: 'sessions', column: col });
        }
      }
    }

    // Check if user_refs table needs 'popl' kind constraint update (Phase 6.0)
    if (result.tables.includes('user_refs')) {
      const tableInfo = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_refs'"
      ).get() as { sql: string } | undefined;

      if (tableInfo?.sql && !tableInfo.sql.includes("'popl'")) {
        result.missingColumns.push({ table: 'user_refs', column: 'kind:popl' });
      }
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    db?.close();
  }

  return result;
}

/** Valid column names for sessions table (Phase 3.4) - security: prevent SQL injection */
const VALID_SESSION_COLUMNS = new Map<string, string>([
  ['actor_id', 'TEXT'],
  ['actor_kind', 'TEXT'],
  ['actor_label', 'TEXT'],
  ['secret_ref_count', 'INTEGER NOT NULL DEFAULT 0'],
]);

/**
 * Attempt to fix missing tables and columns in events.db
 *
 * @param configDir - Optional config directory path
 * @returns Object with success status, list of fixed items, and optional error
 */
export function fixEventsDb(configDir?: string): { success: boolean; fixed: string[]; error?: string } {
  const dir = getDbDir(configDir);
  const dbPath = join(dir, 'events.db');
  const fixed: string[] = [];

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath);

    // Wrap all fix operations in a transaction to prevent partial fixes
    db.exec('BEGIN TRANSACTION');

    try {
      // Check if actors table exists before trying to create
      const actorsExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='actors'"
      ).get();

      if (!actorsExists) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS actors (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            revoked_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_actors_kind ON actors(kind);
          CREATE INDEX IF NOT EXISTS idx_actors_revoked ON actors(revoked_at);
        `);
        fixed.push('table:actors');
      }

      // Phase 4.1: Check if user_refs table exists before trying to create
      const userRefsExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_refs'"
      ).get();

      if (!userRefsExists) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS user_refs (
            name TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
            connector TEXT,
            session TEXT,
            rpc TEXT,
            proto TEXT,
            level TEXT,
            captured_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);
          CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
        `);
        fixed.push('table:user_refs');
      } else {
        // Phase 6.0: Check if user_refs table needs 'popl' kind constraint update
        const tableInfo = db.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_refs'"
        ).get() as { sql: string } | undefined;

        if (tableInfo?.sql && !tableInfo.sql.includes("'popl'")) {
          // Recreate table with updated constraint (SQLite doesn't support ALTER CONSTRAINT)
          db.exec(`
            CREATE TABLE user_refs_new (
              name TEXT PRIMARY KEY,
              kind TEXT NOT NULL CHECK(kind IN ('connector', 'session', 'rpc', 'tool_call', 'context', 'popl')),
              connector TEXT,
              session TEXT,
              rpc TEXT,
              proto TEXT,
              level TEXT,
              captured_at TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            INSERT INTO user_refs_new SELECT * FROM user_refs;
            DROP TABLE user_refs;
            ALTER TABLE user_refs_new RENAME TO user_refs;
            CREATE INDEX IF NOT EXISTS idx_user_refs_kind ON user_refs(kind);
            CREATE INDEX IF NOT EXISTS idx_user_refs_created ON user_refs(created_at);
          `);
          fixed.push('constraint:user_refs.kind:popl');
        }
      }

      // Check if sessions table exists before trying to add columns
      const sessionsExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
      ).get();

      if (sessionsExists) {
        // Add missing columns to sessions table (Phase 3.4)
        const columnsResult = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
        const existingColumns = new Set(columnsResult.map(c => c.name));

        for (const [colName, colDef] of VALID_SESSION_COLUMNS) {
          if (!existingColumns.has(colName)) {
            // Security: column names validated against VALID_SESSION_COLUMNS whitelist
            db.exec(`ALTER TABLE sessions ADD COLUMN ${colName} ${colDef}`);
            fixed.push(`column:sessions.${colName}`);
          }
        }
      }

      db.exec('COMMIT');
      return { success: true, fixed };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    return {
      success: false,
      fixed: [], // On rollback, nothing was actually fixed
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    db?.close();
  }
}
