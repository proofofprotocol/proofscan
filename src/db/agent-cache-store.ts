/**
 * Agent cache database store - manages agent card caching
 * Phase 7.0
 */

import { getEventsDb } from './connection.js';
import type { AgentCache } from './types.js';

/**
 * Agent cache interface with parsed agentCard (for external use)
 */
export interface AgentCacheWithCard {
  targetId: string;
  agentCard?: unknown;
  agentCardHash?: string;
  fetchedAt?: string;
  expiresAt?: string;
}

export class AgentCacheStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getEventsDb(this.configDir);
  }

  /**
   * Get cached agent card for a target
   * @param targetId - Target ID
   * @returns The cache entry with parsed agentCard, or undefined if not found
   */
  get(targetId: string): AgentCacheWithCard | undefined {
    const stmt = this.db.prepare(`SELECT * FROM agent_cache WHERE target_id = ?`);
    const row = stmt.get(targetId) as AgentCache | undefined;
    if (!row) return undefined;
    return this.cacheToExternal(row);
  }

  /**
   * Set or update cache entry for a target
   * @param cache - Cache data (all fields optional except targetId which is inferred from the object)
   */
  set(cache: AgentCacheWithCard): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_cache (target_id, agent_card_json, agent_card_hash, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_id) DO UPDATE SET
        agent_card_json = excluded.agent_card_json,
        agent_card_hash = excluded.agent_card_hash,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `);

    stmt.run(
      cache.targetId,
      cache.agentCard ? JSON.stringify(cache.agentCard) : null,
      cache.agentCardHash || null,
      cache.fetchedAt || null,
      cache.expiresAt || null
    );
  }

  /**
   * Clear cache entry for a target
   * @param targetId - Target ID
   * @returns true if a cache entry was found and cleared, false otherwise
   */
  clear(targetId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM agent_cache WHERE target_id = ?`);
    const result = stmt.run(targetId);
    return result.changes > 0;
  }

  /**
   * Clear all expired cache entries
   * @returns Number of entries cleared
   */
  clearExpired(): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM agent_cache WHERE expires_at IS NOT NULL AND expires_at < ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Get all cache entries
   * @returns Array of all cache entries with parsed agentCards
   */
  listAll(): AgentCacheWithCard[] {
    const stmt = this.db.prepare(`SELECT * FROM agent_cache ORDER BY fetched_at DESC`);
    const rows = stmt.all() as AgentCache[];
    return rows.map(row => this.cacheToExternal(row));
  }

  /**
   * Check if a cache entry is expired
   * @param targetId - Target ID
   * @returns true if the cache entry exists and is expired, false otherwise
   */
  isExpired(targetId: string): boolean {
    const cache = this.get(targetId);
    if (!cache) return false;
    if (!cache.expiresAt) return false;
    return new Date(cache.expiresAt) < new Date();
  }

  /**
   * Convert internal AgentCache record to external AgentCacheWithCard interface
   */
  private cacheToExternal(row: AgentCache): AgentCacheWithCard {
    return {
      targetId: row.target_id,
      agentCard: row.agent_card_json ? JSON.parse(row.agent_card_json) : undefined,
      agentCardHash: row.agent_card_hash || undefined,
      fetchedAt: row.fetched_at || undefined,
      expiresAt: row.expires_at || undefined,
    };
  }
}
