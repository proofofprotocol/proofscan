/**
 * Tests for secrets management (Phase 3.6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  listSecretBindings,
  setSecret,
  pruneOrphanSecrets,
  exportSecrets,
  importSecrets,
} from './management.js';
import { SqliteSecretStore } from './store.js';
import type { Config } from '../types/index.js';

// Test secrets - clearly fake patterns
const TEST_SECRET = 'test_fake_secret_' + 'x'.repeat(30);

describe('listSecretBindings', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `secrets-mgmt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return empty list when no secrets exist', async () => {
    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    const bindings = await listSecretBindings(tempDir, configPath);

    expect(bindings).toEqual([]);
  });

  it('should list stored secrets with bindings', async () => {
    // Create a secret
    const store = new SqliteSecretStore(tempDir);
    const result = await store.store(TEST_SECRET, {
      connectorId: 'test-connector',
      keyName: 'API_KEY',
    });
    store.close();

    // Create config with the secret ref
    const config: Config = {
      version: 1,
      connectors: [{
        id: 'test-connector',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'test',
          env: {
            API_KEY: result.reference,
          },
        },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    const bindings = await listSecretBindings(tempDir, configPath);

    expect(bindings.length).toBe(1);
    expect(bindings[0].connector_id).toBe('test-connector');
    expect(bindings[0].env_key).toBe('API_KEY');
    expect(bindings[0].status).toBe('OK');
  });

  it('should detect orphan secrets', async () => {
    // Create a secret not referenced by config
    const store = new SqliteSecretStore(tempDir);
    await store.store(TEST_SECRET, {
      connectorId: 'old-connector',
      keyName: 'OLD_KEY',
    });
    store.close();

    // Create empty config
    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    const bindings = await listSecretBindings(tempDir, configPath);

    expect(bindings.length).toBe(1);
    expect(bindings[0].status).toBe('ORPHAN');
  });
});

describe('setSecret', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `secrets-set-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should store secret and update config', async () => {
    // Create initial config
    const config: Config = {
      version: 1,
      connectors: [{
        id: 'my-connector',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          env: {
            API_KEY: 'YOUR_API_KEY',
          },
        },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    const result = await setSecret({
      configPath,
      connectorId: 'my-connector',
      envKey: 'API_KEY',
      secretValue: TEST_SECRET,
    });

    expect(result.secretRef).toMatch(/^plain:[a-f0-9-]+$/);

    // Verify config was updated
    const updatedConfig: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const env = (updatedConfig.connectors[0].transport as { env: Record<string, string> }).env;
    expect(env.API_KEY).toBe(result.secretRef);
  });

  it('should throw if connector not found', async () => {
    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    await expect(setSecret({
      configPath,
      connectorId: 'nonexistent',
      envKey: 'API_KEY',
      secretValue: TEST_SECRET,
    })).rejects.toThrow('Connector not found');
  });
});

describe('pruneOrphanSecrets', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `secrets-prune-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should remove orphan secrets', async () => {
    // Create orphan secrets
    const store = new SqliteSecretStore(tempDir);
    await store.store('orphan1', { connectorId: 'old1' });
    await store.store('orphan2', { connectorId: 'old2' });
    store.close();

    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    const result = await pruneOrphanSecrets({
      configDir: tempDir,
      configPath,
    });

    expect(result.orphanCount).toBe(2);
    expect(result.removedCount).toBe(2);
  });

  it('should not remove bound secrets', async () => {
    const store = new SqliteSecretStore(tempDir);
    const storeResult = await store.store(TEST_SECRET, { connectorId: 'active' });
    store.close();

    const config: Config = {
      version: 1,
      connectors: [{
        id: 'active',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'test',
          env: { API_KEY: storeResult.reference },
        },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    const result = await pruneOrphanSecrets({
      configDir: tempDir,
      configPath,
    });

    expect(result.orphanCount).toBe(0);
    expect(result.removedCount).toBe(0);
  });

  it('should support dry-run mode', async () => {
    const store = new SqliteSecretStore(tempDir);
    await store.store('orphan', { connectorId: 'old' });
    store.close();

    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    const result = await pruneOrphanSecrets({
      configDir: tempDir,
      configPath,
      dryRun: true,
    });

    expect(result.orphanCount).toBe(1);
    expect(result.removedCount).toBe(0); // Not actually removed

    // Verify secret still exists
    const store2 = new SqliteSecretStore(tempDir);
    const count = store2.count();
    store2.close();
    expect(count).toBe(1);
  });

  it('should skip secrets newer than olderThanDays threshold', async () => {
    // Create orphan secret (just now, so 0 days old)
    const store = new SqliteSecretStore(tempDir);
    await store.store('recent-orphan', { connectorId: 'old' });
    store.close();

    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    // Try to prune with 7 days threshold - should skip the recent secret
    const result = await pruneOrphanSecrets({
      configDir: tempDir,
      configPath,
      olderThanDays: 7,
    });

    expect(result.orphanCount).toBe(0); // Too new, not included
    expect(result.removedCount).toBe(0);

    // Verify secret still exists
    const store2 = new SqliteSecretStore(tempDir);
    const count = store2.count();
    store2.close();
    expect(count).toBe(1);
  });

  it('should prune secrets older than olderThanDays threshold', async () => {
    // Create orphan secret
    const store = new SqliteSecretStore(tempDir);
    await store.store('orphan', { connectorId: 'old' });
    store.close();

    writeFileSync(configPath, JSON.stringify({ version: 1, connectors: [] }));

    // Prune with 0 days threshold - should include all
    const result = await pruneOrphanSecrets({
      configDir: tempDir,
      configPath,
      olderThanDays: 0,
    });

    expect(result.orphanCount).toBe(1);
    expect(result.removedCount).toBe(1);
  });
});

describe('exportSecrets / importSecrets', () => {
  let tempDir: string;
  let configPath: string;
  let exportPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `secrets-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.json');
    exportPath = join(tempDir, 'export.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should export and import secrets', async () => {
    // Setup: store a secret
    const store = new SqliteSecretStore(tempDir);
    const storeResult = await store.store(TEST_SECRET, {
      connectorId: 'my-connector',
      keyName: 'API_KEY',
    });
    store.close();

    const config: Config = {
      version: 1,
      connectors: [{
        id: 'my-connector',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'test',
          env: { API_KEY: storeResult.reference },
        },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    // Export
    const passphrase = 'test-passphrase-12345';
    const exportResult = await exportSecrets({
      configDir: tempDir,
      configPath,
      outputPath: exportPath,
      passphrase,
    });

    expect(exportResult.exportedCount).toBe(1);
    expect(existsSync(exportPath)).toBe(true);

    // Verify export file is encrypted (not readable as plaintext)
    const exportContent = readFileSync(exportPath, 'utf-8');
    expect(exportContent).not.toContain(TEST_SECRET);
    const exportBundle = JSON.parse(exportContent);
    expect(exportBundle.version).toBe(1);
    expect(exportBundle.kdf.name).toBe('scrypt');
    expect(exportBundle.cipher.name).toBe('aes-256-gcm');
    expect(exportBundle.metadataHmac).toBeDefined(); // HMAC for integrity

    // Setup for import: create new temp dir with config without secret refs
    const importDir = join(tmpdir(), `secrets-import-test-${Date.now()}`);
    mkdirSync(importDir, { recursive: true });
    const importConfigPath = join(importDir, 'config.json');
    // Config without secret refs - simulating a fresh install
    const importConfig: Config = {
      version: 1,
      connectors: [{
        id: 'my-connector',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'test',
          env: { API_KEY: 'PLACEHOLDER' },  // Not a secret ref
        },
      }],
    };
    writeFileSync(importConfigPath, JSON.stringify(importConfig));

    try {
      // Import
      const importResult = await importSecrets({
        configDir: importDir,
        configPath: importConfigPath,
        inputPath: exportPath,
        passphrase,
      });

      expect(importResult.importedCount).toBe(1);

      // Verify secret was imported
      const store2 = new SqliteSecretStore(importDir);
      const count = store2.count();
      store2.close();
      expect(count).toBe(1);
    } finally {
      if (existsSync(importDir)) {
        rmSync(importDir, { recursive: true, force: true });
      }
    }
  });

  it('should fail import with wrong passphrase', async () => {
    // Setup
    const store = new SqliteSecretStore(tempDir);
    const storeResult = await store.store(TEST_SECRET, { connectorId: 'test' });
    store.close();

    const config: Config = {
      version: 1,
      connectors: [{
        id: 'test',
        enabled: true,
        transport: { type: 'stdio', command: 'x', env: { KEY: storeResult.reference } },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    await exportSecrets({
      configDir: tempDir,
      configPath,
      outputPath: exportPath,
      passphrase: 'correct-password',
    });

    await expect(importSecrets({
      configDir: tempDir,
      configPath,
      inputPath: exportPath,
      passphrase: 'wrong-password',
    })).rejects.toThrow('integrity check failed'); // HMAC check fails before decryption
  });

  it('should skip existing secrets without overwrite flag', async () => {
    // Setup: create secret and export
    const store = new SqliteSecretStore(tempDir);
    const storeResult = await store.store(TEST_SECRET, { connectorId: 'test' });
    store.close();

    const config: Config = {
      version: 1,
      connectors: [{
        id: 'test',
        enabled: true,
        transport: { type: 'stdio', command: 'x', env: { KEY: storeResult.reference } },
      }],
    };
    writeFileSync(configPath, JSON.stringify(config));

    const passphrase = 'test123456';
    await exportSecrets({
      configDir: tempDir,
      configPath,
      outputPath: exportPath,
      passphrase,
    });

    // Import to same location (secret already exists)
    const importResult = await importSecrets({
      configDir: tempDir,
      configPath,
      inputPath: exportPath,
      passphrase,
      overwrite: false,
    });

    expect(importResult.skippedCount).toBe(1);
    expect(importResult.importedCount).toBe(0);
  });
});
