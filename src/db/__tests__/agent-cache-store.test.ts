/**
 * Tests for AgentCacheStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { AgentCacheStore } from '../agent-cache-store.js';
import { TargetsStore } from '../targets-store.js';
import { closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA } from '../schema.js';

describe('AgentCacheStore', () => {
  let testDir: string;
  let store: AgentCacheStore;
  let targetsStore: TargetsStore;

  // Helper to create a target for cache tests
  const createTarget = (id: string) => {
    targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      enabled: true,
      config: { url: `https://example.com/${id}` }
    }, { id });
  };

  beforeEach(() => {
    // Close any cached DB connections before creating new test dir
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema including Phase 7.0 tables
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 6'); // Schema already includes Phase 7.0 tables
    db.close();

    store = new AgentCacheStore(testDir);
    targetsStore = new TargetsStore(testDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('get', () => {
    it('should return cache by targetId', async () => {
      createTarget('target-1');
      const now = new Date().toISOString();
      const cacheData = {
        targetId: 'target-1',
        agentCard: { name: 'Test Agent', version: '1.0.0' },
        agentCardHash: 'abc123',
        fetchedAt: now,
        expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
      };

      store.set(cacheData);
      const retrieved = store.get('target-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.targetId).toBe('target-1');
      expect(retrieved?.agentCard).toEqual({ name: 'Test Agent', version: '1.0.0' });
      expect(retrieved?.agentCardHash).toBe('abc123');
      expect(retrieved?.fetchedAt).toBe(now);
      expect(retrieved?.expiresAt).toBeDefined();
    });

    it('should return undefined for non-existent targetId', async () => {
      const retrieved = store.get('non-existent-target');
      expect(retrieved).toBeUndefined();
    });

    it('should parse JSON agentCard correctly', async () => {
      createTarget('target-1');
      const complexCard = {
        name: 'Complex Agent',
        version: '2.0.0',
        description: 'A complex agent',
        capabilities: ['tool1', 'tool2'],
        config: { setting1: true, setting2: 'value' },
        nested: { level1: { level2: 'deep' } }
      };

      store.set({
        targetId: 'target-1',
        agentCard: complexCard,
        agentCardHash: 'hash123'
      });

      const retrieved = store.get('target-1');
      expect(retrieved?.agentCard).toEqual(complexCard);
      expect(typeof retrieved?.agentCard).toBe('object');
    });

    it('should handle null values correctly', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCard: null,
        agentCardHash: null,
        fetchedAt: null,
        expiresAt: null
      });

      const retrieved = store.get('target-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.agentCard).toBeUndefined();
      expect(retrieved?.agentCardHash).toBeUndefined();
      expect(retrieved?.fetchedAt).toBeUndefined();
      expect(retrieved?.expiresAt).toBeUndefined();
    });

    it('should handle undefined agentCard', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCard: undefined,
        agentCardHash: 'hash123',
        fetchedAt: new Date().toISOString()
      });

      const retrieved = store.get('target-1');

      expect(retrieved?.agentCard).toBeUndefined();
      expect(retrieved?.agentCardHash).toBe('hash123');
    });
  });

  describe('set', () => {
    it('should insert new cache entry', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCard: { name: 'Agent' },
        agentCardHash: 'hash1',
        fetchedAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-01T01:00:00Z'
      });

      const retrieved = store.get('target-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.targetId).toBe('target-1');
    });

    it('should update existing cache (upsert)', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCard: { name: 'Original' },
        agentCardHash: 'hash1',
        fetchedAt: '2024-01-01T00:00:00Z'
      });

      // Update with new data
      store.set({
        targetId: 'target-1',
        agentCard: { name: 'Updated', version: '2.0' },
        agentCardHash: 'hash2',
        fetchedAt: '2024-01-01T01:00:00Z',
        expiresAt: '2024-01-01T02:00:00Z'
      });

      const retrieved = store.get('target-1');

      expect(retrieved?.agentCard).toEqual({ name: 'Updated', version: '2.0' });
      expect(retrieved?.agentCardHash).toBe('hash2');
      expect(retrieved?.fetchedAt).toBe('2024-01-01T01:00:00Z');
      expect(retrieved?.expiresAt).toBe('2024-01-01T02:00:00Z');
    });

    it('should handle partial data (only targetId required)', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1'
      });

      const retrieved = store.get('target-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.targetId).toBe('target-1');
    });

    it('should handle only agentCardHash and no agentCard', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCardHash: 'abc123',
        fetchedAt: new Date().toISOString()
      });

      const retrieved = store.get('target-1');
      expect(retrieved?.agentCardHash).toBe('abc123');
      expect(retrieved?.agentCard).toBeUndefined();
    });

    it('should handle only fetchedAt', async () => {
      createTarget('target-1');
      const now = new Date().toISOString();
      store.set({
        targetId: 'target-1',
        fetchedAt: now
      });

      const retrieved = store.get('target-1');
      expect(retrieved?.fetchedAt).toBe(now);
    });

    it('should handle only expiresAt', async () => {
      createTarget('target-1');
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      store.set({
        targetId: 'target-1',
        expiresAt
      });

      const retrieved = store.get('target-1');
      expect(retrieved?.expiresAt).toBe(expiresAt);
    });
  });

  describe('clear', () => {
    it('should remove cache for targetId', async () => {
      createTarget('target-1');
      store.set({
        targetId: 'target-1',
        agentCard: { name: 'Agent' }
      });

      // Verify it exists
      expect(store.get('target-1')).toBeDefined();

      const result = store.clear('target-1');
      expect(result).toBe(true);

      // Verify it's gone
      expect(store.get('target-1')).toBeUndefined();
    });

    it('should return false when cache does not exist', async () => {
      const result = store.clear('non-existent-target');
      expect(result).toBe(false);
    });

    it('should only clear specified targetId', async () => {
      createTarget('target-1');
      createTarget('target-2');
      createTarget('target-3');
      store.set({ targetId: 'target-1', agentCard: { name: 'Agent 1' } });
      store.set({ targetId: 'target-2', agentCard: { name: 'Agent 2' } });
      store.set({ targetId: 'target-3', agentCard: { name: 'Agent 3' } });

      // Clear one
      store.clear('target-2');

      // Verify correct ones remain
      expect(store.get('target-1')).toBeDefined();
      expect(store.get('target-2')).toBeUndefined();
      expect(store.get('target-3')).toBeDefined();
    });
  });

  describe('clearExpired', () => {
    it('should clear expired cache entries', async () => {
      createTarget('expired-1');
      createTarget('expired-2');
      createTarget('valid-1');
      createTarget('no-expiry');

      const now = new Date();
      const past = new Date(now.getTime() - 3600000).toISOString(); // 1 hour ago
      const future = new Date(now.getTime() + 3600000).toISOString(); // 1 hour from now

      store.set({
        targetId: 'expired-1',
        agentCard: { name: 'Expired 1' },
        expiresAt: past
      });

      store.set({
        targetId: 'expired-2',
        agentCard: { name: 'Expired 2' },
        expiresAt: past
      });

      store.set({
        targetId: 'valid-1',
        agentCard: { name: 'Valid 1' },
        expiresAt: future
      });

      store.set({
        targetId: 'no-expiry',
        agentCard: { name: 'No Expiry' }
        // No expiresAt set - should not be cleared
      });

      const cleared = store.clearExpired();
      expect(cleared).toBe(2);

      expect(store.get('expired-1')).toBeUndefined();
      expect(store.get('expired-2')).toBeUndefined();
      expect(store.get('valid-1')).toBeDefined();
      expect(store.get('no-expiry')).toBeDefined();
    });

    it('should return 0 when no expired entries', async () => {
      createTarget('valid-1');
      const future = new Date(Date.now() + 3600000).toISOString();

      store.set({
        targetId: 'valid-1',
        agentCard: { name: 'Valid' },
        expiresAt: future
      });

      const cleared = store.clearExpired();
      expect(cleared).toBe(0);
    });
  });

  describe('listAll', () => {
    it('should return all cache entries', async () => {
      createTarget('target-1');
      createTarget('target-2');
      createTarget('target-3');
      store.set({ targetId: 'target-1', agentCard: { name: 'Agent 1' } });
      store.set({ targetId: 'target-2', agentCard: { name: 'Agent 2' } });
      store.set({ targetId: 'target-3', agentCard: { name: 'Agent 3' } });

      const all = store.listAll();

      expect(all).toHaveLength(3);
      const targetIds = all.map(c => c.targetId);
      expect(targetIds).toContain('target-1');
      expect(targetIds).toContain('target-2');
      expect(targetIds).toContain('target-3');
    });

    it('should return empty array when no entries', async () => {
      const all = store.listAll();
      expect(all).toEqual([]);
    });

    it('should order by fetched_at descending', async () => {
      createTarget('target-1');
      createTarget('target-2');
      createTarget('target-3');
      store.set({
        targetId: 'target-1',
        fetchedAt: '2024-01-01T10:00:00Z'
      });
      store.set({
        targetId: 'target-2',
        fetchedAt: '2024-01-01T12:00:00Z'
      });
      store.set({
        targetId: 'target-3',
        fetchedAt: '2024-01-01T11:00:00Z'
      });

      const all = store.listAll();

      expect(all[0].targetId).toBe('target-2'); // Most recent
      expect(all[1].targetId).toBe('target-3');
      expect(all[2].targetId).toBe('target-1');
    });

    it('should handle entries without fetched_at', async () => {
      createTarget('no-fetched-at');
      createTarget('with-fetched-at');
      store.set({ targetId: 'no-fetched-at' });
      store.set({ targetId: 'with-fetched-at', fetchedAt: '2024-01-01T00:00:00Z' });

      const all = store.listAll();

      expect(all).toHaveLength(2);
      expect(all.map(c => c.targetId)).toContain('no-fetched-at');
      expect(all.map(c => c.targetId)).toContain('with-fetched-at');
    });
  });

  describe('isExpired', () => {
    it('should return true for expired cache', async () => {
      createTarget('expired-target');
      const past = new Date(Date.now() - 3600000).toISOString();

      store.set({
        targetId: 'expired-target',
        agentCard: { name: 'Expired' },
        expiresAt: past
      });

      expect(store.isExpired('expired-target')).toBe(true);
    });

    it('should return false for valid cache', async () => {
      createTarget('valid-target');
      const future = new Date(Date.now() + 3600000).toISOString();

      store.set({
        targetId: 'valid-target',
        agentCard: { name: 'Valid' },
        expiresAt: future
      });

      expect(store.isExpired('valid-target')).toBe(false);
    });

    it('should return false for non-existent cache', async () => {
      expect(store.isExpired('non-existent')).toBe(false);
    });

    it('should return false for cache without expiresAt', async () => {
      createTarget('no-expiry');
      store.set({
        targetId: 'no-expiry',
        agentCard: { name: 'No Expiry' }
      });

      expect(store.isExpired('no-expiry')).toBe(false);
    });

    it('should return false for cache with null expiresAt', async () => {
      createTarget('null-expiry');
      store.set({
        targetId: 'null-expiry',
        agentCard: { name: 'Null Expiry' },
        expiresAt: null
      });

      expect(store.isExpired('null-expiry')).toBe(false);
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should cascade delete when target is removed', async () => {
      const target = targetsStore.add({
        type: 'agent',
        protocol: 'a2a',
        enabled: true,
        config: {}
      });

      // Add cache entry
      store.set({
        targetId: target.id,
        agentCard: { name: 'Agent' }
      });

      // Verify cache exists
      expect(store.get(target.id)).toBeDefined();

      // Remove the target
      targetsStore.remove(target.id);

      // Verify cache is gone (via cascade delete)
      expect(store.get(target.id)).toBeUndefined();
    });

    it('should allow cache to be set for existing target', async () => {
      const target = targetsStore.add({
        type: 'agent',
        protocol: 'a2a',
        enabled: true,
        config: {}
      });

      // Should not throw error
      expect(() => {
        store.set({
          targetId: target.id,
          agentCard: { name: 'Agent' }
        });
      }).not.toThrow();

      expect(store.get(target.id)).toBeDefined();
    });

    it('should throw error when setting cache for non-existent target', async () => {
      expect(() => {
        store.set({
          targetId: 'non-existent-target',
          agentCard: { name: 'Agent' }
        });
      }).toThrow();
    });
  });
});
