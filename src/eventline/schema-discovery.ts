/**
 * Database schema discovery - auto-detect table structure
 *
 * This allows the EventLine normalization to work even if the schema
 * changes slightly, by discovering available columns at runtime.
 */

import type Database from 'better-sqlite3';

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface SchemaInfo {
  tables: Map<string, TableInfo>;
  version: number;
}

/**
 * Discover database schema using PRAGMA commands
 */
export function discoverSchema(db: Database.Database): SchemaInfo {
  const tables = new Map<string, TableInfo>();

  // Get all tables
  const tableList = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string }>;

  for (const { name } of tableList) {
    const columns = db.prepare(`PRAGMA table_info('${name}')`).all() as ColumnInfo[];
    tables.set(name, { name, columns });
  }

  // Get user_version
  const version = db.pragma('user_version', { simple: true }) as number;

  return { tables, version };
}

/**
 * Check if a table has a specific column
 */
export function hasColumn(schema: SchemaInfo, tableName: string, columnName: string): boolean {
  const table = schema.tables.get(tableName);
  if (!table) return false;
  return table.columns.some(c => c.name === columnName);
}

/**
 * Get column names for a table
 */
export function getColumnNames(schema: SchemaInfo, tableName: string): string[] {
  const table = schema.tables.get(tableName);
  if (!table) return [];
  return table.columns.map(c => c.name);
}

/**
 * Find timestamp column - tries common naming patterns
 */
export function findTimestampColumn(schema: SchemaInfo, tableName: string): string | null {
  const candidates = ['ts_ms', 'ts', 'timestamp', 'created_at', 'started_at', 'time'];
  const table = schema.tables.get(tableName);
  if (!table) return null;

  for (const candidate of candidates) {
    if (table.columns.some(c => c.name === candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find direction column - tries common naming patterns
 */
export function findDirectionColumn(schema: SchemaInfo, tableName: string): string | null {
  const candidates = ['direction', 'dir', 'flow'];
  const table = schema.tables.get(tableName);
  if (!table) return null;

  for (const candidate of candidates) {
    if (table.columns.some(c => c.name === candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find kind column - tries common naming patterns
 */
export function findKindColumn(schema: SchemaInfo, tableName: string): string | null {
  const candidates = ['kind', 'type', 'event_type', 'msg_type'];
  const table = schema.tables.get(tableName);
  if (!table) return null;

  for (const candidate of candidates) {
    if (table.columns.some(c => c.name === candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find raw JSON column
 */
export function findRawJsonColumn(schema: SchemaInfo, tableName: string): string | null {
  const candidates = ['raw_json', 'raw', 'payload', 'data', 'body', 'content'];
  const table = schema.tables.get(tableName);
  if (!table) return null;

  for (const candidate of candidates) {
    if (table.columns.some(c => c.name === candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Column mapping for known schema versions
 */
export interface ColumnMapping {
  timestamp: string;
  direction?: string;
  kind?: string;
  rawJson?: string;
  sessionId?: string;
  connectorId?: string;
  rpcId?: string;
  method?: string;
  success?: string;
  errorCode?: string;
}

/**
 * Build column mapping for events table
 */
export function buildEventsMapping(schema: SchemaInfo): ColumnMapping | null {
  const tableName = 'events';
  const table = schema.tables.get(tableName);
  if (!table) return null;

  const cols = getColumnNames(schema, tableName);

  return {
    timestamp: cols.includes('ts') ? 'ts' : (findTimestampColumn(schema, tableName) || 'ts'),
    direction: cols.includes('direction') ? 'direction' : findDirectionColumn(schema, tableName) || undefined,
    kind: cols.includes('kind') ? 'kind' : findKindColumn(schema, tableName) || undefined,
    rawJson: cols.includes('raw_json') ? 'raw_json' : findRawJsonColumn(schema, tableName) || undefined,
    sessionId: cols.includes('session_id') ? 'session_id' : undefined,
    rpcId: cols.includes('rpc_id') ? 'rpc_id' : undefined,
  };
}

/**
 * Build column mapping for sessions table
 */
export function buildSessionsMapping(schema: SchemaInfo): ColumnMapping | null {
  const tableName = 'sessions';
  const table = schema.tables.get(tableName);
  if (!table) return null;

  const cols = getColumnNames(schema, tableName);

  return {
    timestamp: cols.includes('started_at') ? 'started_at' : (findTimestampColumn(schema, tableName) || 'created_at'),
    connectorId: cols.includes('connector_id') ? 'connector_id' : undefined,
    sessionId: cols.includes('session_id') ? 'session_id' : undefined,
  };
}

/**
 * Build column mapping for rpc_calls table
 */
export function buildRpcCallsMapping(schema: SchemaInfo): ColumnMapping | null {
  const tableName = 'rpc_calls';
  const table = schema.tables.get(tableName);
  if (!table) return null;

  const cols = getColumnNames(schema, tableName);

  return {
    timestamp: cols.includes('request_ts') ? 'request_ts' : (findTimestampColumn(schema, tableName) || 'ts'),
    sessionId: cols.includes('session_id') ? 'session_id' : undefined,
    rpcId: cols.includes('rpc_id') ? 'rpc_id' : undefined,
    method: cols.includes('method') ? 'method' : undefined,
    success: cols.includes('success') ? 'success' : undefined,
    errorCode: cols.includes('error_code') ? 'error_code' : undefined,
  };
}
