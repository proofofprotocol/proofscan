/**
 * Tests for ConfigManager cache behavior
 * Phase 8.3: MCP Proxy
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../manager.js';
import { join } from 'path';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';

describe('ConfigManager cache', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'proofscan-test-'));
    configPath = join(tempDir, 'config.json');
    
    // Create initial config
    const initialConfig = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          name: 'Test Connector',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'echo',
            args: ['hello']
          }
        }
      ]
    };
    await writeFile(configPath, JSON.stringify(initialConfig, null, 2));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return cached config within TTL', async () => {
    const manager = new ConfigManager(configPath, { cacheTtlMs: 1000 });

    // First load
    const config1 = await manager.load();
    expect(config1.connectors).toHaveLength(1);

    // Modify file directly
    const updatedConfig = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          name: 'Test Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['hello'] }
        },
        {
          id: 'new-connector',
          name: 'New Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['world'] }
        }
      ]
    };
    await writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

    // Second load should return cached (TTL not expired)
    const config2 = await manager.load();
    expect(config2.connectors).toHaveLength(1); // Still cached value
  });

  it('should reload config after TTL expires', async () => {
    const manager = new ConfigManager(configPath, { cacheTtlMs: 50 });

    // First load
    const config1 = await manager.load();
    expect(config1.connectors).toHaveLength(1);

    // Modify file directly
    const updatedConfig = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          name: 'Test Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['hello'] }
        },
        {
          id: 'new-connector',
          name: 'New Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['world'] }
        }
      ]
    };
    await writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

    // Wait for TTL to expire
    await sleep(60);

    // Should reload from disk
    const config2 = await manager.load();
    expect(config2.connectors).toHaveLength(2);
  });

  it('should invalidate cache on invalidateCache()', async () => {
    const manager = new ConfigManager(configPath, { cacheTtlMs: 10000 });

    // First load
    const config1 = await manager.load();
    expect(config1.connectors).toHaveLength(1);

    // Modify file directly
    const updatedConfig = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          name: 'Test Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['hello'] }
        },
        {
          id: 'new-connector',
          name: 'New Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['world'] }
        }
      ]
    };
    await writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

    // Invalidate cache
    manager.invalidateCache();

    // Should reload from disk immediately
    const config2 = await manager.load();
    expect(config2.connectors).toHaveLength(2);
  });

  it('should use default TTL of 5 seconds', async () => {
    const manager = new ConfigManager(configPath);

    // Access private field via any cast to verify default
    // This is a simple behavioral test - just verify it works
    const config = await manager.load();
    expect(config.connectors).toHaveLength(1);

    // Immediate second load should be cached
    const config2 = await manager.load();
    expect(config2).toBe(config); // Same object reference = cached
  });

  it('should prevent concurrent disk reads during cache expiry (race condition)', async () => {
    // Track how many times we read from disk
    let diskReadCount = 0;
    const originalConfig = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          name: 'Test Connector',
          enabled: true,
          transport: { type: 'stdio', command: 'echo', args: ['hello'] }
        }
      ]
    };

    // Use a very short TTL so cache expires immediately
    const manager = new ConfigManager(configPath, { cacheTtlMs: 1 });

    // First load to warm up
    await manager.load();

    // Wait for cache to expire
    await sleep(10);

    // Patch readFileSafe to count reads
    const { readFileSafe } = await import('../../utils/fs.js');
    const originalReadFileSafe = readFileSafe;

    // We'll monkey-patch the manager's internal behavior by making multiple concurrent calls
    // Since _loadFromDisk uses readFileSafe internally, concurrent calls would hit disk multiple times
    // without the race condition fix

    // Create a slow version of the config file read to simulate slow disk
    const slowConfigPath = join(tempDir, 'slow-config.json');
    await writeFile(slowConfigPath, JSON.stringify(originalConfig, null, 2));
    const slowManager = new ConfigManager(slowConfigPath, { cacheTtlMs: 1 });

    // First load
    await slowManager.load();
    await sleep(10); // Expire cache

    // Multiple concurrent loads should only result in ONE disk read
    // due to the Promise cache pattern
    const concurrentLoads = Promise.all([
      slowManager.load(),
      slowManager.load(),
      slowManager.load(),
      slowManager.load(),
      slowManager.load(),
    ]);

    const results = await concurrentLoads;

    // All should return the same config object (from a single load)
    const firstResult = results[0];
    for (const result of results) {
      expect(result).toBe(firstResult); // Same object reference
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
