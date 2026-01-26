/**
 * Targets database store - manages targets (unified connector/agent)
 * Phase 7.0
 */

import { randomUUID } from 'crypto';
import { getEventsDb } from './connection.js';
import type { Target, TargetType, TargetProtocol } from './types.js';

/**
 * Target interface with parsed config (for external use)
 */
export interface TargetWithConfig {
  id: string;
  type: TargetType;
  protocol: TargetProtocol;
  name?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
  config: unknown; // Parsed JSON object
}

export class TargetsStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getEventsDb(this.configDir);
  }

  /**
   * Add a new target
   * @param target - Target data (createdAt will be generated)
   * @param options.id - Optional explicit ID (if not provided, UUID will be generated)
   * @returns The created target with generated ID and createdAt
   */
  add(target: Omit<TargetWithConfig, 'id' | 'createdAt'>, options?: { id?: string }): TargetWithConfig {
    const now = new Date().toISOString();
    const id = options?.id || randomUUID();

    // Validate type/protocol combination
    if (target.type === 'connector' && target.protocol !== 'mcp') {
      throw new Error('Invalid combination: connector must use mcp protocol');
    }
    if (target.type === 'agent' && target.protocol !== 'a2a') {
      throw new Error('Invalid combination: agent must use a2a protocol');
    }

    const targetRecord: Target = {
      id,
      type: target.type,
      protocol: target.protocol,
      name: target.name || null,
      enabled: target.enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
      config_json: JSON.stringify(target.config),
    };

    const stmt = this.db.prepare(`
      INSERT INTO targets (id, type, protocol, name, enabled, created_at, updated_at, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      targetRecord.id,
      targetRecord.type,
      targetRecord.protocol,
      targetRecord.name,
      targetRecord.enabled,
      targetRecord.created_at,
      targetRecord.updated_at,
      targetRecord.config_json
    );

    return this.targetToExternal(targetRecord);
  }

  /**
   * Get a target by ID
   * @param id - Target ID
   * @returns The target with parsed config, or undefined if not found
   */
  get(id: string): TargetWithConfig | undefined {
    const stmt = this.db.prepare(`SELECT * FROM targets WHERE id = ?`);
    const row = stmt.get(id) as Target | undefined;
    if (!row) return undefined;
    return this.targetToExternal(row);
  }

  /**
   * List targets with optional filtering
   * @param options - Filter options (type, enabled)
   * @returns Array of targets with parsed configs
   */
  list(options?: { type?: TargetType; enabled?: boolean }): TargetWithConfig[] {
    let sql = `SELECT * FROM targets WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    if (options?.enabled !== undefined) {
      sql += ` AND enabled = ?`;
      params.push(options.enabled ? 1 : 0);
    }

    sql += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Target[];
    return rows.map(row => this.targetToExternal(row));
  }

  /**
   * Update the enabled status of a target
   * @param id - Target ID
   * @param enabled - New enabled status
   * @returns true if the target was found and updated, false otherwise
   */
  updateEnabled(id: string, enabled: boolean): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE targets SET enabled = ?, updated_at = ? WHERE id = ?
    `);
    const result = stmt.run(enabled ? 1 : 0, now, id);
    return result.changes > 0;
  }

  /**
   * Update a target's config
   * @param id - Target ID
   * @param config - New config object
   * @returns true if the target was found and updated, false otherwise
   */
  updateConfig(id: string, config: unknown): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE targets SET config_json = ?, updated_at = ? WHERE id = ?
    `);
    const result = stmt.run(JSON.stringify(config), now, id);
    return result.changes > 0;
  }

  /**
   * Remove a target by ID
   * @param id - Target ID
   * @returns true if the target was found and removed, false otherwise
   * @note This will also cascade-delete related agent_cache entries
   */
  remove(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM targets WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get target by connector_id (for migration from old sessions)
   * @param connectorId - Legacy connector ID
   * @returns The target if found, undefined otherwise
   */
  getByConnectorId(connectorId: string): TargetWithConfig | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM targets WHERE type = 'connector' AND id = ?
    `);
    const row = stmt.get(connectorId) as Target | undefined;
    if (!row) return undefined;
    return this.targetToExternal(row);
  }

  /**
   * Convert internal Target record to external TargetWithConfig interface
   */
  private targetToExternal(row: Target): TargetWithConfig {
    return {
      id: row.id,
      type: row.type,
      protocol: row.protocol,
      name: row.name || undefined,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at || undefined,
      config: JSON.parse(row.config_json),
    };
  }
}
