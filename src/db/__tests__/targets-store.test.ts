/**
 * Tests for TargetsStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { TargetsStore } from '../targets-store.js';
import { getEventsDb, closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA, EVENTS_DB_MIGRATION_5_TO_6 } from '../schema.js';

describe('TargetsStore', () => {
  let testDir: string;
  let store: TargetsStore;

  beforeEach(() => {
    // Close any cached DB connections before creating new test dir
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema including Phase 7.0 tables
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 5'); // Start at version 5
    // Run migration to version 6 to create targets and agent_cache tables
    db.exec(EVENTS_DB_MIGRATION_5_TO_6);
    db.pragma('user_version = 6');
    db.close();

    store = new TargetsStore(testDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('add', () => {
    it('should add a connector target', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        name: 'test-connector',
        enabled: true,
        config: { endpoint: 'stdio://', command: 'test' }
      });

      expect(target.id).toBeDefined();
      expect(target.type).toBe('connector');
      expect(target.protocol).toBe('mcp');
      expect(target.name).toBe('test-connector');
      expect(target.enabled).toBe(true);
      expect(target.createdAt).toBeDefined();
      expect(target.config).toEqual({ endpoint: 'stdio://', command: 'test' });

      // Verify it was persisted
      const retrieved = store.get(target.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(target.id);
    });

    it('should add an agent target', async () => {
      const target = store.add({
        type: 'agent',
        protocol: 'a2a',
        name: 'test-agent',
        enabled: true,
        config: { baseUrl: 'http://localhost:3000' }
      });

      expect(target.id).toBeDefined();
      expect(target.type).toBe('agent');
      expect(target.protocol).toBe('a2a');
      expect(target.name).toBe('test-agent');
      expect(target.enabled).toBe(true);
      expect(target.config).toEqual({ baseUrl: 'http://localhost:3000' });

      // Verify it was persisted
      const retrieved = store.get(target.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(target.id);
    });

    it('should reject invalid type/protocol combination for connector', async () => {
      expect(() => {
        store.add({
          type: 'connector',
          protocol: 'a2a', // Invalid: connector must use mcp
          name: 'invalid',
          enabled: true,
          config: {}
        });
      }).toThrow('Invalid combination: connector must use mcp protocol');
    });

    it('should reject invalid type/protocol combination for agent', async () => {
      expect(() => {
        store.add({
          type: 'agent',
          protocol: 'mcp', // Invalid: agent must use a2a
          name: 'invalid',
          enabled: true,
          config: {}
        });
      }).toThrow('Invalid combination: agent must use a2a protocol');
    });

    it('should generate UUID when no ID is provided', async () => {
      const target1 = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      const target2 = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      expect(target1.id).toBeDefined();
      expect(target2.id).toBeDefined();
      expect(target1.id).not.toBe(target2.id);
    });

    it('should use provided ID when given', async () => {
      const customId = 'custom-target-id';
      const target = store.add(
        {
          type: 'connector',
          protocol: 'mcp',
          enabled: true,
          config: {}
        },
        { id: customId }
      );

      expect(target.id).toBe(customId);

      const retrieved = store.get(customId);
      expect(retrieved?.id).toBe(customId);
    });

    it('should handle optional name field', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      expect(target.name).toBeUndefined();
    });

    it('should store config as JSON and parse on retrieval', async () => {
      const complexConfig = {
        endpoint: 'stdio://',
        command: 'node',
        args: ['--arg1', '--arg2'],
        env: { KEY1: 'value1', KEY2: 'value2' },
        nested: { a: 1, b: { c: 2 } }
      };

      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: complexConfig
      });

      const retrieved = store.get(target.id);
      expect(retrieved?.config).toEqual(complexConfig);
    });

    it('should set both created_at and updated_at on add', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      expect(target.createdAt).toBeDefined();
      expect(target.updatedAt).toBeDefined();
      expect(target.updatedAt).toBe(target.createdAt);
    });
  });

  describe('get', () => {
    it('should return target by id', async () => {
      const added = store.add({
        type: 'connector',
        protocol: 'mcp',
        name: 'test-connector',
        enabled: true,
        config: { endpoint: 'stdio://' }
      });

      const retrieved = store.get(added.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(added.id);
      expect(retrieved?.type).toBe('connector');
      expect(retrieved?.protocol).toBe('mcp');
      expect(retrieved?.name).toBe('test-connector');
      expect(retrieved?.enabled).toBe(true);
      expect(retrieved?.config).toEqual({ endpoint: 'stdio://' });
    });

    it('should return undefined for non-existent id', async () => {
      const retrieved = store.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should parse JSON config correctly', async () => {
      const config = { key: 'value', number: 42, bool: true, obj: { nested: 'data' } };
      const added = store.add({
        type: 'agent',
        protocol: 'a2a',
        enabled: true,
        config
      });

      const retrieved = store.get(added.id);

      expect(retrieved?.config).toEqual(config);
      expect(typeof retrieved?.config).toBe('object');
    });

    it('should convert enabled from 0/1 to boolean', async () => {
      const targetEnabled = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      const targetDisabled = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: false,
        config: {}
      });

      const retrievedEnabled = store.get(targetEnabled.id);
      const retrievedDisabled = store.get(targetDisabled.id);

      expect(retrievedEnabled?.enabled).toBe(true);
      expect(retrievedDisabled?.enabled).toBe(false);
    });

    it('should handle null name correctly', async () => {
      const added = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      const retrieved = store.get(added.id);

      expect(retrieved?.name).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all targets', async () => {
      const t1 = store.add({ type: 'connector', protocol: 'mcp', name: 't1', enabled: true, config: {} });
      const t2 = store.add({ type: 'agent', protocol: 'a2a', name: 't2', enabled: false, config: {} });
      const t3 = store.add({ type: 'connector', protocol: 'mcp', name: 't3', enabled: true, config: {} });

      const all = store.list();

      expect(all).toHaveLength(3);
      expect(all.map(t => t.id)).toContain(t1.id);
      expect(all.map(t => t.id)).toContain(t2.id);
      expect(all.map(t => t.id)).toContain(t3.id);
    });

    it('should filter by type', async () => {
      const c1 = store.add({ type: 'connector', protocol: 'mcp', name: 'c1', enabled: true, config: {} });
      const c2 = store.add({ type: 'connector', protocol: 'mcp', name: 'c2', enabled: true, config: {} });
      const a1 = store.add({ type: 'agent', protocol: 'a2a', name: 'a1', enabled: true, config: {} });
      const a2 = store.add({ type: 'agent', protocol: 'a2a', name: 'a2', enabled: true, config: {} });

      const connectors = store.list({ type: 'connector' });
      const agents = store.list({ type: 'agent' });

      expect(connectors).toHaveLength(2);
      expect(connectors.every(t => t.type === 'connector')).toBe(true);

      expect(agents).toHaveLength(2);
      expect(agents.every(t => t.type === 'agent')).toBe(true);
    });

    it('should filter by enabled', async () => {
      store.add({ type: 'connector', protocol: 'mcp', name: 'e1', enabled: true, config: {} });
      store.add({ type: 'connector', protocol: 'mcp', name: 'e2', enabled: true, config: {} });
      store.add({ type: 'connector', protocol: 'mcp', name: 'd1', enabled: false, config: {} });
      store.add({ type: 'connector', protocol: 'mcp', name: 'd2', enabled: false, config: {} });

      const enabled = store.list({ enabled: true });
      const disabled = store.list({ enabled: false });

      expect(enabled).toHaveLength(2);
      expect(enabled.every(t => t.enabled === true)).toBe(true);

      expect(disabled).toHaveLength(2);
      expect(disabled.every(t => t.enabled === false)).toBe(true);
    });

    it('should filter by both type and enabled', async () => {
      store.add({ type: 'connector', protocol: 'mcp', name: 'c-e1', enabled: true, config: {} });
      store.add({ type: 'connector', protocol: 'mcp', name: 'c-d1', enabled: false, config: {} });
      store.add({ type: 'agent', protocol: 'a2a', name: 'a-e1', enabled: true, config: {} });
      store.add({ type: 'agent', protocol: 'a2a', name: 'a-d1', enabled: false, config: {} });

      const result = store.list({ type: 'connector', enabled: true });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('connector');
      expect(result[0].enabled).toBe(true);
    });

    it('should return empty array when no targets exist', async () => {
      const result = store.list();
      expect(result).toEqual([]);
    });

    it('should return empty array when filter matches nothing', async () => {
      store.add({ type: 'connector', protocol: 'mcp', enabled: false, config: {} });

      const result = store.list({ enabled: true });
      expect(result).toEqual([]);
    });

    it('should order by created_at descending', async () => {
      // Add targets with slight delays to ensure different timestamps
      const t1 = store.add({ type: 'connector', protocol: 'mcp', config: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      const t2 = store.add({ type: 'connector', protocol: 'mcp', config: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      const t3 = store.add({ type: 'connector', protocol: 'mcp', config: {} });

      const all = store.list();

      expect(all[0].id).toBe(t3.id); // Most recent first
      expect(all[1].id).toBe(t2.id);
      expect(all[2].id).toBe(t1.id);
    });
  });

  describe('updateEnabled', () => {
    it('should update enabled flag', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      const result = store.updateEnabled(target.id, false);
      expect(result).toBe(true);

      const updated = store.get(target.id);
      expect(updated?.enabled).toBe(false);
      expect(updated?.updatedAt).toBeDefined();
      expect(updated?.updatedAt).not.toBe(updated?.createdAt);
    });

    it('should return false when target does not exist', async () => {
      const result = store.updateEnabled('non-existent', true);
      expect(result).toBe(false);
    });

    it('should update from false to true', async () => {
      const target = store.add({
        type: 'agent',
        protocol: 'a2a',
        enabled: false,
        config: {}
      });

      store.updateEnabled(target.id, true);
      const updated = store.get(target.id);
      expect(updated?.enabled).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update config', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: { old: 'value' }
      });

      const newConfig = { new: 'config', with: { nested: 'data' } };
      const result = store.updateConfig(target.id, newConfig);
      expect(result).toBe(true);

      const updated = store.get(target.id);
      expect(updated?.config).toEqual(newConfig);
      expect(updated?.updatedAt).toBeDefined();
      expect(updated?.updatedAt).not.toBe(updated?.createdAt);
    });

    it('should return false when target does not exist', async () => {
      const result = store.updateConfig('non-existent', {});
      expect(result).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove target', async () => {
      const target = store.add({
        type: 'connector',
        protocol: 'mcp',
        enabled: true,
        config: {}
      });

      const result = store.remove(target.id);
      expect(result).toBe(true);

      const retrieved = store.get(target.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false when target does not exist', async () => {
      const result = store.remove('non-existent');
      expect(result).toBe(false);
    });

    it('should cascade delete agent_cache entries', async () => {
      // Import AgentCacheStore to test cascade
      const { AgentCacheStore } = await import('../agent-cache-store.js');
      const cacheStore = new AgentCacheStore(testDir);

      const target = store.add({
        type: 'agent',
        protocol: 'a2a',
        enabled: true,
        config: {}
      });

      // Add cache entry
      cacheStore.set({
        targetId: target.id,
        agentCard: { name: 'test' },
        agentCardHash: 'hash123',
        fetchedAt: new Date().toISOString()
      });

      // Verify cache exists
      const cacheBefore = cacheStore.get(target.id);
      expect(cacheBefore).toBeDefined();

      // Remove target
      store.remove(target.id);

      // Verify cache is gone (cascade delete)
      const cacheAfter = cacheStore.get(target.id);
      expect(cacheAfter).toBeUndefined();
    });
  });

  describe('getByConnectorId', () => {
    it('should get target by legacy connector_id', async () => {
      const connectorId = 'legacy-connector-id';
      const target = store.add(
        {
          type: 'connector',
          protocol: 'mcp',
          name: 'legacy',
          enabled: true,
          config: {}
        },
        { id: connectorId }
      );

      const retrieved = store.getByConnectorId(connectorId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(connectorId);
      expect(retrieved?.type).toBe('connector');
    });

    it('should return undefined for non-existent connector_id', async () => {
      const retrieved = store.getByConnectorId('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should return undefined for non-connector targets', async () => {
      const agent = store.add({
        type: 'agent',
        protocol: 'a2a',
        name: 'agent',
        enabled: true,
        config: {}
      });

      const retrieved = store.getByConnectorId(agent.id);
      expect(retrieved).toBeUndefined();
    });
  });
});
