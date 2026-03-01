/**
 * ProofComm Skill Registry
 * Phase 9.2: Skill Routing
 *
 * Pull-type skill cache: fetches skills from A2A Agent Cards on demand
 * and caches them for @skill: routing resolution.
 *
 * Flow:
 *   1. @skill:translate arrives at a2aProxy
 *   2. resolveSkill('translate') searches the local cache
 *   3. Returns the agentId that best matches
 *   4. Route to that agent as a regular A2A request
 */

import type { SkillCacheEntry, SkillSearchResult } from '../db/types.js';
import { SkillsStore, type CreateSkillOptions } from '../db/skills-store.js';

/**
 * A2A Agent Card skill shape (minimal subset used for caching)
 */
interface AgentCardSkill {
  id?: string;
  name: string;
  description?: string;
  useWhen?: string;
  dontUseWhen?: string;
  examples?: string[];
  tags?: string[];
}

/**
 * A2A Agent Card shape (minimal subset)
 */
interface AgentCard {
  skills?: AgentCardSkill[];
  [key: string]: unknown;
}

/**
 * Result of a skill resolution (for @skill: routing)
 */
export interface SkillResolutionResult {
  /** Resolved agent ID */
  agentId: string;
  /** The matched skill */
  skill: SkillCacheEntry;
  /** Relevance score */
  score: number;
}

/**
 * SkillRegistry manages the skill cache and handles @skill: routing resolution
 */
export class SkillRegistry {
  constructor(private readonly skillsStore: SkillsStore) {}

  /**
   * Refresh skills from an A2A Agent Card
   * Replaces all cached skills for the agent
   * Returns the number of skills cached
   */
  refreshFromAgentCard(agentId: string, agentCard: unknown): number {
    const card = agentCard as AgentCard;
    const skills = card?.skills;

    if (!Array.isArray(skills) || skills.length === 0) {
      // No skills in card - clear any existing cache for this agent
      this.skillsStore.deleteByAgent(agentId);
      return 0;
    }

    // Convert Agent Card skills to store options
    const skillOptions: Omit<CreateSkillOptions, 'agentId'>[] = skills
      .filter((s): s is AgentCardSkill => s != null && typeof s.name === 'string' && s.name.trim() !== '')
      .map(s => ({
        name: s.name.trim(),
        description: s.description?.trim(),
        useWhen: s.useWhen?.trim(),
        dontUseWhen: s.dontUseWhen?.trim(),
        examples: Array.isArray(s.examples)
          ? s.examples.filter((e): e is string => typeof e === 'string')
          : undefined,
        tags: Array.isArray(s.tags)
          ? s.tags.filter((t): t is string => typeof t === 'string')
          : undefined,
      }));

    return this.skillsStore.upsertMany(agentId, skillOptions);
  }

  /**
   * Search skills by query string and/or tags
   */
  search(query: string, tags?: string[], limit = 10): SkillSearchResult[] {
    return this.skillsStore.search(query, tags, limit);
  }

  /**
   * List all cached skills, optionally filtered by agent
   */
  list(agentId?: string): SkillCacheEntry[] {
    return this.skillsStore.list(agentId);
  }

  /**
   * Resolve a skill name to the best matching agent ID
   * Used for @skill: routing
   *
   * @param skillName - Skill name from @skill:<name>
   * @returns Resolution result, or undefined if no match found
   */
  resolveSkill(skillName: string): SkillResolutionResult | undefined {
    const results = this.skillsStore.search(skillName, undefined, 1);
    if (results.length === 0) return undefined;

    const top = results[0];
    return {
      agentId: top.agentId,
      skill: top.skill,
      score: top.score,
    };
  }

  /**
   * Clear all skills for an agent (e.g., when agent is removed)
   */
  clearAgent(agentId: string): number {
    return this.skillsStore.deleteByAgent(agentId);
  }

  /**
   * Purge expired skill cache entries
   */
  purgeExpired(): number {
    return this.skillsStore.purgeExpired();
  }

  /**
   * Get total cached skill count
   */
  count(): number {
    return this.skillsStore.count();
  }
}
