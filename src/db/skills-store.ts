/**
 * Skills cache database store - manages A2A Agent Card skill cache
 * Phase 9.2: Skill Routing
 *
 * Skills are pulled from A2A Agent Cards and cached locally.
 * This enables @skill: routing without hitting external agents on every request.
 *
 * skill_id format: "<agent_id>/<slug>" where slug is the skill name lowercased and
 * normalized (spaces → underscores, non-alphanumeric stripped).
 */

import { getEventsDb } from './connection.js';
import type { SkillCache, SkillCacheEntry, SkillSearchResult } from './types.js';

/**
 * Options for creating/updating a skill cache entry
 */
export interface CreateSkillOptions {
  /** Agent ID that owns this skill */
  agentId: string;
  /** Skill name (human-readable) */
  name: string;
  /** Optional description */
  description?: string;
  /** Conditions for use */
  useWhen?: string;
  /** Conditions where this skill should NOT be used */
  dontUseWhen?: string;
  /** Example prompts */
  examples?: string[];
  /** Tags for categorization and search */
  tags?: string[];
  /** Optional cache TTL in seconds (undefined = no expiry) */
  ttlSeconds?: number;
}

/**
 * Normalize a skill name to a slug suitable for use in skill_id
 */
export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'skill';
}

/**
 * Build a skill_id from agent_id and skill name
 */
export function buildSkillId(agentId: string, name: string): string {
  return `${agentId}/${slugifySkillName(name)}`;
}

/**
 * Skills cache store
 * Manages cached skills from A2A Agent Cards for @skill: routing
 */
export class SkillsStore {
  constructor(private readonly configDir?: string) {}

  private get db() {
    return getEventsDb(this.configDir);
  }

  /**
   * Convert a DB row to external format with parsed JSON fields
   */
  private toExternal(row: SkillCache): SkillCacheEntry {
    let examples: string[] = [];
    let tags: string[] = [];

    if (row.examples_json) {
      try {
        const parsed = JSON.parse(row.examples_json);
        if (Array.isArray(parsed)) {
          examples = parsed.filter((e): e is string => typeof e === 'string');
        }
      } catch {
        console.warn(`[skills-store] Failed to parse examples_json for skill ${row.skill_id}`);
      }
    }

    if (row.tags_json) {
      try {
        const parsed = JSON.parse(row.tags_json);
        if (Array.isArray(parsed)) {
          tags = parsed.filter((t): t is string => typeof t === 'string');
        }
      } catch {
        console.warn(`[skills-store] Failed to parse tags_json for skill ${row.skill_id}`);
      }
    }

    return {
      skillId: row.skill_id,
      agentId: row.agent_id,
      name: row.name,
      ...(row.description != null && { description: row.description }),
      ...(row.use_when != null && { useWhen: row.use_when }),
      ...(row.dont_use_when != null && { dontUseWhen: row.dont_use_when }),
      examples,
      tags,
      cachedAt: row.cached_at,
      ...(row.expires_at != null && { expiresAt: row.expires_at }),
    };
  }

  /**
   * Upsert a single skill into the cache
   * Returns the skill_id
   */
  upsert(options: CreateSkillOptions): string {
    const skillId = buildSkillId(options.agentId, options.name);
    const now = new Date().toISOString();
    const expiresAt = options.ttlSeconds != null
      ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
      : null;

    this.db.prepare(`
      INSERT INTO skills_cache (
        skill_id, agent_id, name, description,
        use_when, dont_use_when, examples_json, tags_json,
        cached_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        use_when = excluded.use_when,
        dont_use_when = excluded.dont_use_when,
        examples_json = excluded.examples_json,
        tags_json = excluded.tags_json,
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at
    `).run(
      skillId,
      options.agentId,
      options.name,
      options.description ?? null,
      options.useWhen ?? null,
      options.dontUseWhen ?? null,
      options.examples != null ? JSON.stringify(options.examples) : null,
      options.tags != null ? JSON.stringify(options.tags) : null,
      now,
      expiresAt,
    );

    return skillId;
  }

  /**
   * Upsert multiple skills for an agent atomically
   * Replaces all existing skills for the agent
   * Returns the number of skills upserted
   */
  upsertMany(agentId: string, skills: Omit<CreateSkillOptions, 'agentId'>[]): number {
    const upsertMany = this.db.transaction(() => {
      // Delete all existing skills for this agent first
      this.db.prepare('DELETE FROM skills_cache WHERE agent_id = ?').run(agentId);

      // Insert all new skills
      for (const skill of skills) {
        this.upsert({ ...skill, agentId });
      }

      return skills.length;
    });

    return upsertMany() as number;
  }

  /**
   * Get a skill by skill_id
   */
  get(skillId: string): SkillCacheEntry | undefined {
    const row = this.db.prepare(
      'SELECT * FROM skills_cache WHERE skill_id = ?'
    ).get(skillId) as SkillCache | undefined;

    return row ? this.toExternal(row) : undefined;
  }

  /**
   * List all skills, optionally filtered by agent_id
   * Excludes expired skills
   */
  list(agentId?: string): SkillCacheEntry[] {
    const now = new Date().toISOString();
    let rows: SkillCache[];

    if (agentId != null) {
      rows = this.db.prepare(`
        SELECT * FROM skills_cache
        WHERE agent_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY name ASC
      `).all(agentId, now) as SkillCache[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM skills_cache
        WHERE expires_at IS NULL OR expires_at > ?
        ORDER BY agent_id ASC, name ASC
      `).all(now) as SkillCache[];
    }

    return rows.map(r => this.toExternal(r));
  }

  /**
   * Search skills by query string and/or tags
   * Searches: name, description, use_when, tags
   * Returns results sorted by relevance score (descending)
   */
  search(query: string, tags?: string[], limit = 10): SkillSearchResult[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM skills_cache
      WHERE expires_at IS NULL OR expires_at > ?
    `).all(now) as SkillCache[];

    const q = query.toLowerCase().trim();
    const filterTags = tags?.map(t => t.toLowerCase()) ?? [];

    const results: SkillSearchResult[] = [];

    for (const row of rows) {
      const skill = this.toExternal(row);
      let score = 0;

      // Score by name match (highest weight)
      const nameLower = skill.name.toLowerCase();
      if (nameLower === q) {
        score += 100;
      } else if (nameLower.startsWith(q)) {
        score += 60;
      } else if (nameLower.includes(q)) {
        score += 40;
      }

      // Score by description match
      if (skill.description) {
        const descLower = skill.description.toLowerCase();
        if (descLower.includes(q)) {
          score += 20;
        }
      }

      // Score by use_when match
      if (skill.useWhen) {
        const useWhenLower = skill.useWhen.toLowerCase();
        if (useWhenLower.includes(q)) {
          score += 15;
        }
      }

      // Score by tags match
      const skillTags = skill.tags.map(t => t.toLowerCase());
      if (q && skillTags.includes(q)) {
        score += 50;
      }

      // Filter by requested tags (must have all)
      if (filterTags.length > 0) {
        const hasAllTags = filterTags.every(ft => skillTags.includes(ft));
        if (!hasAllTags) continue;
        score += filterTags.length * 10;
      }

      // Only include if there's a match (when query is non-empty)
      if (q && score === 0) continue;

      // When no query, include all (score = 0 is fine)
      results.push({ agentId: skill.agentId, skill, score });
    }

    // Sort by score descending, then by name ascending
    results.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

    return results.slice(0, limit);
  }

  /**
   * Find agents that have a skill matching the given name
   * Used for @skill: routing resolution
   * Returns agentIds sorted by best match
   */
  resolveByName(skillName: string): string[] {
    const results = this.search(skillName, undefined, 5);
    // Deduplicate agent IDs while preserving order
    const seen = new Set<string>();
    return results
      .map(r => r.agentId)
      .filter(id => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  /**
   * Delete all skills for an agent
   * Returns number of deleted rows
   */
  deleteByAgent(agentId: string): number {
    const result = this.db.prepare(
      'DELETE FROM skills_cache WHERE agent_id = ?'
    ).run(agentId);
    return result.changes;
  }

  /**
   * Delete a single skill by skill_id
   * Returns true if deleted
   */
  delete(skillId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM skills_cache WHERE skill_id = ?'
    ).run(skillId);
    return result.changes > 0;
  }

  /**
   * Get total skill count (excluding expired)
   */
  count(): number {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) as n FROM skills_cache
      WHERE expires_at IS NULL OR expires_at > ?
    `).get(now) as { n: number };
    return row.n;
  }

  /**
   * Purge expired skills
   * Returns number of deleted rows
   */
  purgeExpired(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'DELETE FROM skills_cache WHERE expires_at IS NOT NULL AND expires_at <= ?'
    ).run(now);
    return result.changes;
  }
}
