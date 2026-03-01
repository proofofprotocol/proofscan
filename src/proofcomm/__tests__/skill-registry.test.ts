/**
 * Tests for SkillRegistry
 * Phase 9.2: Skill Routing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SkillsStore } from '../../db/skills-store.js';
import { SkillRegistry } from '../skill-registry.js';
import { closeAllDbs } from '../../db/connection.js';
import { EVENTS_DB_SCHEMA } from '../../db/schema.js';

describe('SkillRegistry', () => {
  let testDir: string;
  let skillsStore: SkillsStore;
  let registry: SkillRegistry;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 12');
    db.close();

    skillsStore = new SkillsStore(testDir);
    registry = new SkillRegistry(skillsStore);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==================== refreshFromAgentCard ====================

  describe('refreshFromAgentCard', () => {
    it('should cache skills from agent card', () => {
      const agentCard = {
        name: 'Test Agent',
        skills: [
          { name: 'Translation', description: 'Translates text', tags: ['language'] },
          { name: 'Summarization', description: 'Summarizes documents', tags: ['nlp'] },
        ],
      };

      const count = registry.refreshFromAgentCard('agent-1', agentCard);
      expect(count).toBe(2);
      expect(registry.count()).toBe(2);
    });

    it('should replace existing skills for agent', () => {
      registry.refreshFromAgentCard('agent-1', {
        skills: [{ name: 'OldSkill' }],
      });
      registry.refreshFromAgentCard('agent-1', {
        skills: [{ name: 'NewSkill1' }, { name: 'NewSkill2' }],
      });

      const skills = registry.list('agent-1');
      expect(skills).toHaveLength(2);
      expect(skills.map(s => s.name)).not.toContain('OldSkill');
    });

    it('should clear skills when agent card has no skills', () => {
      registry.refreshFromAgentCard('agent-1', { skills: [{ name: 'Skill' }] });
      registry.refreshFromAgentCard('agent-1', { skills: [] });

      expect(registry.list('agent-1')).toHaveLength(0);
    });

    it('should NOT modify cache when skills key is missing (partial update)', () => {
      registry.refreshFromAgentCard('agent-1', { skills: [{ name: 'Skill' }] });
      const result = registry.refreshFromAgentCard('agent-1', {});

      // Missing skills key = no-op, returns -1
      expect(result).toBe(-1);
      expect(registry.list('agent-1')).toHaveLength(1);
    });

    it('should clear skills when agent card has explicit empty skills array', () => {
      registry.refreshFromAgentCard('agent-1', { skills: [{ name: 'Skill' }] });
      const result = registry.refreshFromAgentCard('agent-1', { skills: [] });

      // Empty array = clear cache, returns 0
      expect(result).toBe(0);
      expect(registry.list('agent-1')).toHaveLength(0);
    });

    it('should ignore skills with empty names', () => {
      const count = registry.refreshFromAgentCard('agent-1', {
        skills: [
          { name: 'Valid Skill' },
          { name: '' },
          { name: '   ' },
          { name: 'Another Valid' },
        ],
      });

      expect(count).toBe(2);
    });

    it('should store examples and tags from agent card', () => {
      registry.refreshFromAgentCard('agent-1', {
        skills: [{
          name: 'Translate',
          examples: ['Translate to Japanese', 'What language is this?'],
          tags: ['language', 'translate'],
          useWhen: 'User wants to translate text',
          dontUseWhen: 'User asks for original language',
        }],
      });

      const skill = registry.list('agent-1')[0];
      expect(skill.examples).toEqual(['Translate to Japanese', 'What language is this?']);
      expect(skill.tags).toEqual(['language', 'translate']);
      expect(skill.useWhen).toBe('User wants to translate text');
      expect(skill.dontUseWhen).toBe('User asks for original language');
    });

    it('should handle non-array skills gracefully (no-op)', () => {
      const count = registry.refreshFromAgentCard('agent-1', { skills: 'not-an-array' });
      // Non-array skills = no-op, returns -1
      expect(count).toBe(-1);
    });

    it('should NOT delete existing cache when skills is non-array', () => {
      // First, add some skills
      registry.refreshFromAgentCard('agent-1', { skills: [{ name: 'Existing' }] });
      expect(registry.list('agent-1')).toHaveLength(1);

      // Then pass non-array skills - should not modify cache
      const count = registry.refreshFromAgentCard('agent-1', { skills: 42 });
      expect(count).toBe(-1);
      expect(registry.list('agent-1')).toHaveLength(1); // Still has existing skill
    });
  });

  // ==================== resolveSkill ====================

  describe('resolveSkill', () => {
    beforeEach(() => {
      registry.refreshFromAgentCard('agent-translate', {
        skills: [{ name: 'Translation', description: 'Translates text between languages', tags: ['language', 'translate'] }],
      });
      registry.refreshFromAgentCard('agent-summarize', {
        skills: [{ name: 'Summarization', description: 'Summarizes long documents', tags: ['nlp', 'text'] }],
      });
    });

    it('should resolve exact skill name match', () => {
      const result = registry.resolveSkill('Translation');
      expect(result).toBeDefined();
      expect(result?.agentId).toBe('agent-translate');
    });

    it('should resolve case-insensitive partial name match', () => {
      const result = registry.resolveSkill('translation');
      expect(result).toBeDefined();
      expect(result?.agentId).toBe('agent-translate');
    });

    it('should return undefined for unknown skill', () => {
      const result = registry.resolveSkill('NonExistentSkill');
      expect(result).toBeUndefined();
    });

    it('should return the best matching skill', () => {
      registry.refreshFromAgentCard('agent-translate2', {
        skills: [{ name: 'Text Translation', description: 'Alternative translator', tags: ['language'] }],
      });

      // 'Translation' should exactly match agent-translate's skill
      const result = registry.resolveSkill('Translation');
      expect(result?.agentId).toBe('agent-translate');
    });

    it('should include skill and score in result', () => {
      const result = registry.resolveSkill('Summarization');
      expect(result?.skill).toBeDefined();
      expect(result?.score).toBeGreaterThan(0);
    });
  });

  // ==================== search ====================

  describe('search', () => {
    it('should delegate to skillsStore.search', () => {
      registry.refreshFromAgentCard('agent-1', {
        skills: [
          { name: 'Translation', tags: ['language'] },
          { name: 'Summarization', tags: ['nlp'] },
        ],
      });

      const results = registry.search('Translation');
      expect(results).toHaveLength(1);
      expect(results[0].skill.name).toBe('Translation');
    });
  });

  // ==================== clearAgent ====================

  describe('clearAgent', () => {
    it('should remove all skills for agent', () => {
      registry.refreshFromAgentCard('agent-1', {
        skills: [{ name: 'Skill A' }, { name: 'Skill B' }],
      });
      registry.refreshFromAgentCard('agent-2', {
        skills: [{ name: 'Skill C' }],
      });

      const deleted = registry.clearAgent('agent-1');
      expect(deleted).toBe(2);
      expect(registry.list('agent-1')).toHaveLength(0);
      expect(registry.list('agent-2')).toHaveLength(1);
    });
  });

  // ==================== count ====================

  describe('count', () => {
    it('should return total cached skill count', () => {
      expect(registry.count()).toBe(0);

      registry.refreshFromAgentCard('agent-1', {
        skills: [{ name: 'A' }, { name: 'B' }],
      });
      expect(registry.count()).toBe(2);
    });
  });
});
