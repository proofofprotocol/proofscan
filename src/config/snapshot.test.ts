/**
 * Tests for config snapshot management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SnapshotManager,
  formatSnapshotLine,
  formatConfigDiff,
  type SnapshotMeta,
  type ConfigDiff,
} from './snapshot.js';
import type { Config } from '../types/index.js';

// ============================================================
// Test helpers
// ============================================================

async function createTestDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'proofscan-snapshot-test-'));
}

function createTestConfig(connectorIds: string[] = ['test']): Config {
  return {
    version: 1,
    connectors: connectorIds.map(id => ({
      id,
      enabled: true,
      transport: { type: 'stdio' as const, command: 'node' },
    })),
  };
}

// ============================================================
// SnapshotManager tests
// ============================================================

describe('SnapshotManager', () => {
  let testDir: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    testDir = await createTestDir();
    manager = new SnapshotManager(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('creates snapshot file and updates index', async () => {
      const config = createTestConfig(['server1', 'server2']);
      const meta = await manager.save(config);

      expect(meta.id).toBeDefined();
      expect(meta.connector_count).toBe(2);
      expect(meta.hash).toBeDefined();

      // Verify index was updated
      const list = await manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(meta.id);
    });

    it('saves with note', async () => {
      const config = createTestConfig();
      const meta = await manager.save(config, 'before refactor');

      expect(meta.note).toBe('before refactor');
      expect(meta.file_name).toContain('before_refactor');
    });

    it('creates multiple snapshots', async () => {
      const config1 = createTestConfig(['a']);
      const config2 = createTestConfig(['a', 'b']);

      await manager.save(config1, 'first');
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));
      await manager.save(config2, 'second');

      const list = await manager.list();
      expect(list).toHaveLength(2);
      // Newest first
      expect(list[0].note).toBe('second');
      expect(list[1].note).toBe('first');
    });
  });

  describe('list', () => {
    it('returns empty array when no snapshots', async () => {
      const list = await manager.list();
      expect(list).toEqual([]);
    });

    it('returns snapshots newest first', async () => {
      const config = createTestConfig();

      await manager.save(config, 'old');
      await new Promise(r => setTimeout(r, 10));
      await manager.save(config, 'new');

      const list = await manager.list();
      expect(list[0].note).toBe('new');
      expect(list[1].note).toBe('old');
    });
  });

  describe('getByNumber', () => {
    it('returns snapshot by 1-indexed number', async () => {
      const config = createTestConfig(['test']);
      await manager.save(config, 'snapshot1');

      const snapshot = await manager.getByNumber(1);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.meta.note).toBe('snapshot1');
      expect(snapshot!.config.connectors).toHaveLength(1);
    });

    it('returns null for invalid number', async () => {
      const config = createTestConfig();
      await manager.save(config);

      expect(await manager.getByNumber(0)).toBeNull();
      expect(await manager.getByNumber(2)).toBeNull();
      expect(await manager.getByNumber(-1)).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes snapshot and updates index', async () => {
      const config = createTestConfig();
      await manager.save(config, 'to-delete');

      expect(await manager.list()).toHaveLength(1);

      const deleted = await manager.delete(1);
      expect(deleted).not.toBeNull();
      expect(deleted!.note).toBe('to-delete');

      expect(await manager.list()).toHaveLength(0);
    });

    it('returns null for invalid number', async () => {
      expect(await manager.delete(1)).toBeNull();
    });
  });

  describe('findMatchingSnapshot', () => {
    it('finds snapshot matching config by hash', async () => {
      const config = createTestConfig(['a', 'b']);
      await manager.save(config);

      const match = await manager.findMatchingSnapshot(config);
      expect(match).toBe(1);
    });

    it('returns null when no match', async () => {
      const config1 = createTestConfig(['a']);
      const config2 = createTestConfig(['b']);

      await manager.save(config1);

      const match = await manager.findMatchingSnapshot(config2);
      expect(match).toBeNull();
    });
  });

  describe('diffConfigs', () => {
    it('detects added connectors', () => {
      const current = createTestConfig(['a']);
      const target = createTestConfig(['a', 'b']);

      const diff = manager.diffConfigs(current, target);

      expect(diff.added).toEqual(['b']);
      expect(diff.removed).toEqual([]);
      expect(diff.unchanged).toEqual(['a']);
    });

    it('detects removed connectors', () => {
      const current = createTestConfig(['a', 'b']);
      const target = createTestConfig(['a']);

      const diff = manager.diffConfigs(current, target);

      expect(diff.removed).toEqual(['b']);
      expect(diff.added).toEqual([]);
    });

    it('detects changed connectors', () => {
      const current: Config = {
        version: 1,
        connectors: [
          { id: 'a', enabled: true, transport: { type: 'stdio', command: 'node' } },
        ],
      };
      const target: Config = {
        version: 1,
        connectors: [
          { id: 'a', enabled: false, transport: { type: 'stdio', command: 'node' } },
        ],
      };

      const diff = manager.diffConfigs(current, target);

      expect(diff.changed).toEqual(['a']);
      expect(diff.unchanged).toEqual([]);
    });
  });

  describe('computeHash', () => {
    it('produces consistent hash for same config', () => {
      const config = createTestConfig(['a', 'b']);

      const hash1 = manager.computeHash(config);
      const hash2 = manager.computeHash(config);

      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different configs', () => {
      const config1 = createTestConfig(['a']);
      const config2 = createTestConfig(['b']);

      expect(manager.computeHash(config1)).not.toBe(manager.computeHash(config2));
    });
  });
});

// ============================================================
// Formatting tests
// ============================================================

describe('formatSnapshotLine', () => {
  it('formats snapshot without note', () => {
    const meta: SnapshotMeta = {
      id: '2024-01-15T10-30-00',
      created_at: '2024-01-15T10:30:00.000Z',
      note: null,
      file_name: '2024-01-15T10-30-00.json',
      connector_count: 3,
      hash: 'abc123',
    };

    const line = formatSnapshotLine(1, meta);

    expect(line).toContain('1.');
    expect(line).toContain('3 connectors');
    expect(line).not.toContain('[current]');
  });

  it('formats snapshot with note', () => {
    const meta: SnapshotMeta = {
      id: '2024-01-15T10-30-00',
      created_at: '2024-01-15T10:30:00.000Z',
      note: 'before update',
      file_name: '2024-01-15T10-30-00.json',
      connector_count: 2,
      hash: 'abc123',
    };

    const line = formatSnapshotLine(1, meta);

    expect(line).toContain('"before update"');
  });

  it('formats current snapshot marker', () => {
    const meta: SnapshotMeta = {
      id: '2024-01-15T10-30-00',
      created_at: '2024-01-15T10:30:00.000Z',
      note: null,
      file_name: '2024-01-15T10-30-00.json',
      connector_count: 1,
      hash: 'abc123',
    };

    const line = formatSnapshotLine(1, meta, true);

    expect(line).toContain('[current]');
  });
});

describe('formatConfigDiff', () => {
  it('formats diff with all change types', () => {
    const diff: ConfigDiff = {
      added: ['new1', 'new2'],
      removed: ['old'],
      changed: ['modified'],
      unchanged: ['same'],
    };

    const output = formatConfigDiff(diff);

    expect(output).toContain('+ Added: new1, new2');
    expect(output).toContain('- Removed: old');
    expect(output).toContain('~ Changed: modified');
    expect(output).toContain('= Unchanged: same');
  });

  it('formats empty diff', () => {
    const diff: ConfigDiff = {
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    };

    const output = formatConfigDiff(diff);

    expect(output).toContain('No changes');
  });
});

// ============================================================
// Integration tests
// ============================================================

describe('Snapshot workflow integration', () => {
  let testDir: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    testDir = await createTestDir();
    manager = new SnapshotManager(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('full save/list/load workflow', async () => {
    // Save initial config
    const config1 = createTestConfig(['server1']);
    await manager.save(config1, 'initial');

    // Save updated config
    const config2 = createTestConfig(['server1', 'server2']);
    await manager.save(config2, 'added server2');

    // List shows both
    const list = await manager.list();
    expect(list).toHaveLength(2);

    // Load older snapshot
    const older = await manager.getByNumber(2);
    expect(older!.config.connectors).toHaveLength(1);

    // Diff shows changes
    const diff = manager.diffConfigs(config2, older!.config);
    expect(diff.removed).toContain('server2');
  });

  it('delete removes correct snapshot', async () => {
    await manager.save(createTestConfig(['a']), 'first');
    await manager.save(createTestConfig(['b']), 'second');
    await manager.save(createTestConfig(['c']), 'third');

    // Delete middle one (second newest = #2)
    await manager.delete(2);

    const list = await manager.list();
    expect(list).toHaveLength(2);
    expect(list[0].note).toBe('third');
    expect(list[1].note).toBe('first');
  });
});
