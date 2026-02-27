/**
 * Tests for SkillsStore
 * Phase 9.2: Skill Routing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SkillsStore, buildSkillId, slugifySkillName } from '../skills-store.js';
import { closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA } from '../schema.js';

describe('SkillsStore', () => {
  let testDir: string;
  let store: SkillsStore;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema (version 12 has skills_cache)
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 12');
    db.close();

    store = new SkillsStore(testDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==================== Utility Functions ====================

  describe('slugifySkillName', () => {
    it('should lowercase and replace spaces with underscores', () => {
      expect(slugifySkillName('Text Translation')).toBe('text_translation');
    });

    it('should remove non-alphanumeric characters', () => {
      // '&' and '!' are removed, then double underscores collapsed to single
      expect(slugifySkillName('Text & Translation!')).toBe('text_translation');
    });

    it('should collapse multiple underscores', () => {
      expect(slugifySkillName('a  b')).toBe('a_b');
    });

    it('should return "skill" for empty result', () => {
      expect(slugifySkillName('!!!')).toBe('skill');
    });

    it('should handle already-normalized names', () => {
      expect(slugifySkillName('translate')).toBe('translate');
    });
  });

  describe('buildSkillId', () => {
    it('should combine agent_id and slug', () => {
      expect(buildSkillId('agent-1', 'Translation')).toBe('agent-1/translation');
    });
  });

  // ==================== upsert ====================

  describe('upsert', () => {
    it('should insert a new skill and return skill_id', () => {
      const skillId = store.upsert({
        agentId: 'agent-1',
        name: 'Translation',
        description: 'Translates text',
        tags: ['translate', 'language'],
        examples: ['Translate to Japanese'],
      });

      expect(skillId).toBe('agent-1/translation');
    });

    it('should update existing skill on conflict', () => {
      store.upsert({ agentId: 'agent-1', name: 'Translation', description: 'Old description' });
      store.upsert({ agentId: 'agent-1', name: 'Translation', description: 'New description' });

      const skill = store.get('agent-1/translation');
      expect(skill?.description).toBe('New description');
    });

    it('should store examples as JSON array', () => {
      store.upsert({
        agentId: 'agent-1',
        name: 'Translate',
        examples: ['Translate this to Japanese', 'What language is this?'],
      });

      const skill = store.get('agent-1/translate');
      expect(skill?.examples).toEqual(['Translate this to Japanese', 'What language is this?']);
    });

    it('should store tags as JSON array', () => {
      store.upsert({
        agentId: 'agent-1',
        name: 'Translate',
        tags: ['translate', 'language', 'nlp'],
      });

      const skill = store.get('agent-1/translate');
      expect(skill?.tags).toEqual(['translate', 'language', 'nlp']);
    });

    it('should set expiresAt when ttlSeconds provided', () => {
      const before = new Date();
      store.upsert({ agentId: 'agent-1', name: 'TempSkill', ttlSeconds: 3600 });
      const after = new Date();

      const skill = store.get('agent-1/tempskill');
      expect(skill?.expiresAt).toBeDefined();

      const expires = new Date(skill!.expiresAt!);
      expect(expires.getTime()).toBeGreaterThan(before.getTime() + 3500 * 1000);
      expect(expires.getTime()).toBeLessThan(after.getTime() + 3700 * 1000);
    });

    it('should not set expiresAt when no ttlSeconds', () => {
      store.upsert({ agentId: 'agent-1', name: 'Permanent' });
      const skill = store.get('agent-1/permanent');
      expect(skill?.expiresAt).toBeUndefined();
    });
  });

  // ==================== upsertMany ====================

  describe('upsertMany', () => {
    it('should insert multiple skills atomically', () => {
      const count = store.upsertMany('agent-1', [
        { name: 'Translate', description: 'Translation' },
        { name: 'Summarize', description: 'Summarization' },
        { name: 'Classify', description: 'Classification' },
      ]);

      expect(count).toBe(3);
      expect(store.list('agent-1')).toHaveLength(3);
    });

    it('should replace all existing skills for agent', () => {
      store.upsert({ agentId: 'agent-1', name: 'OldSkill' });
      store.upsertMany('agent-1', [{ name: 'NewSkill' }]);

      const skills = store.list('agent-1');
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('NewSkill');
    });

    it('should not affect other agents skills', () => {
      store.upsert({ agentId: 'agent-2', name: 'OtherSkill' });
      store.upsertMany('agent-1', [{ name: 'NewSkill' }]);

      expect(store.list('agent-2')).toHaveLength(1);
    });

    it('should clear agent skills when given empty array', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill' });
      store.upsertMany('agent-1', []);

      expect(store.list('agent-1')).toHaveLength(0);
    });
  });

  // ==================== get ====================

  describe('get', () => {
    it('should return skill by skill_id', () => {
      store.upsert({ agentId: 'agent-1', name: 'Translate', description: 'Translates text' });
      const skill = store.get('agent-1/translate');

      expect(skill).toBeDefined();
      expect(skill?.agentId).toBe('agent-1');
      expect(skill?.name).toBe('Translate');
      expect(skill?.description).toBe('Translates text');
    });

    it('should return undefined for unknown skill_id', () => {
      expect(store.get('unknown/skill')).toBeUndefined();
    });
  });

  // ==================== list ====================

  describe('list', () => {
    it('should list all skills when no filter', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill A' });
      store.upsert({ agentId: 'agent-2', name: 'Skill B' });

      const skills = store.list();
      expect(skills).toHaveLength(2);
    });

    it('should filter by agent_id', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill A' });
      store.upsert({ agentId: 'agent-2', name: 'Skill B' });

      const skills = store.list('agent-1');
      expect(skills).toHaveLength(1);
      expect(skills[0].agentId).toBe('agent-1');
    });

    it('should exclude expired skills', () => {
      // Create expired skill (expired 1ms ago)
      const db = new Database(join(testDir, 'events.db'));
      const pastDate = new Date(Date.now() - 1).toISOString();
      db.prepare(`
        INSERT INTO skills_cache (skill_id, agent_id, name, cached_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('agent-1/expired', 'agent-1', 'Expired', new Date().toISOString(), pastDate);
      db.close();

      expect(store.list()).toHaveLength(0);
    });
  });

  // ==================== search ====================

  describe('search', () => {
    beforeEach(() => {
      store.upsert({ agentId: 'agent-1', name: 'Translation', description: 'Translate text between languages', tags: ['language', 'translate'] });
      store.upsert({ agentId: 'agent-2', name: 'Summarization', description: 'Summarize long documents', tags: ['text', 'nlp'] });
      store.upsert({ agentId: 'agent-3', name: 'Classification', description: 'Classify text into categories', tags: ['nlp', 'classification'] });
    });

    it('should find exact name match with highest score', () => {
      const results = store.search('Translation');
      expect(results).toHaveLength(1);
      expect(results[0].skill.name).toBe('Translation');
      expect(results[0].score).toBeGreaterThanOrEqual(100);
    });

    it('should find partial name match', () => {
      const results = store.search('Summar');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.name).toBe('Summarization');
    });

    it('should find by description', () => {
      const results = store.search('long documents');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].skill.agentId).toBe('agent-2');
    });

    it('should filter by tags', () => {
      const results = store.search('', ['nlp']);
      expect(results).toHaveLength(2);
      const agentIds = results.map(r => r.agentId);
      expect(agentIds).toContain('agent-2');
      expect(agentIds).toContain('agent-3');
    });

    it('should combine query and tags filter', () => {
      const results = store.search('text', ['nlp']);
      expect(results).toHaveLength(2);
    });

    it('should respect limit', () => {
      const results = store.search('', undefined, 2);
      expect(results).toHaveLength(2);
    });

    it('should return empty for no matches', () => {
      const results = store.search('xyznonexistent');
      expect(results).toHaveLength(0);
    });
  });

  // ==================== resolveByName ====================

  describe('resolveByName', () => {
    it('should return agent IDs matching skill name', () => {
      store.upsert({ agentId: 'agent-1', name: 'Translation' });
      store.upsert({ agentId: 'agent-2', name: 'Summarization' });

      const agentIds = store.resolveByName('Translation');
      expect(agentIds).toContain('agent-1');
      expect(agentIds).not.toContain('agent-2');
    });

    it('should return empty array for unknown skill', () => {
      expect(store.resolveByName('unknown')).toHaveLength(0);
    });

    it('should deduplicate agent IDs', () => {
      store.upsert({ agentId: 'agent-1', name: 'Translate' });
      store.upsert({ agentId: 'agent-1', name: 'Translation' });

      const agentIds = store.resolveByName('translat');
      const unique = new Set(agentIds);
      expect(agentIds.length).toBe(unique.size);
    });
  });

  // ==================== delete ====================

  describe('deleteByAgent', () => {
    it('should delete all skills for agent', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill A' });
      store.upsert({ agentId: 'agent-1', name: 'Skill B' });
      store.upsert({ agentId: 'agent-2', name: 'Skill C' });

      const deleted = store.deleteByAgent('agent-1');
      expect(deleted).toBe(2);
      expect(store.list('agent-1')).toHaveLength(0);
      expect(store.list('agent-2')).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should delete a single skill by skill_id', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill' });
      const deleted = store.delete('agent-1/skill');

      expect(deleted).toBe(true);
      expect(store.get('agent-1/skill')).toBeUndefined();
    });

    it('should return false for unknown skill_id', () => {
      expect(store.delete('unknown/skill')).toBe(false);
    });
  });

  // ==================== count ====================

  describe('count', () => {
    it('should return 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('should count non-expired skills', () => {
      store.upsert({ agentId: 'agent-1', name: 'Skill A' });
      store.upsert({ agentId: 'agent-1', name: 'Skill B' });
      expect(store.count()).toBe(2);
    });
  });

  // ==================== purgeExpired ====================

  describe('purgeExpired', () => {
    it('should delete expired skills and return count', () => {
      store.upsert({ agentId: 'agent-1', name: 'Permanent' });

      // Insert expired skill directly
      const db = new Database(join(testDir, 'events.db'));
      const pastDate = new Date(Date.now() - 1).toISOString();
      db.prepare(`
        INSERT INTO skills_cache (skill_id, agent_id, name, cached_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('agent-1/expired', 'agent-1', 'Expired', new Date().toISOString(), pastDate);
      db.close();

      const deleted = store.purgeExpired();
      expect(deleted).toBe(1);
      expect(store.count()).toBe(1);
    });

    it('should return 0 when no expired skills', () => {
      store.upsert({ agentId: 'agent-1', name: 'Permanent' });
      expect(store.purgeExpired()).toBe(0);
    });
  });
});
