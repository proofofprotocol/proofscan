/**
 * Tests for secret reference resolution (Phase 3.6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveEnvSecrets, formatResolveErrors } from './resolve.js';
import { SqliteSecretStore } from './store.js';

// Test secrets - clearly fake patterns
const TEST_SECRET = 'test_fake_secret_' + 'x'.repeat(30);

describe('resolveEnvSecrets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `resolve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle empty env', async () => {
    const result = await resolveEnvSecrets(undefined, 'test', tempDir);

    expect(result.success).toBe(true);
    expect(result.envResolved).toEqual({});
    expect(result.resolvedRefs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should pass through non-secret values', async () => {
    const env = {
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      DEBUG: 'true',
    };

    const result = await resolveEnvSecrets(env, 'test', tempDir);

    expect(result.success).toBe(true);
    expect(result.envResolved).toEqual(env);
    expect(result.resolvedRefs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should resolve secret references', async () => {
    // Store a secret
    const store = new SqliteSecretStore(tempDir);
    const storeResult = await store.store(TEST_SECRET, {
      connectorId: 'test-connector',
      keyName: 'API_KEY',
    });
    store.close();

    const env = {
      API_KEY: storeResult.reference,
      OTHER: 'value',
    };

    const result = await resolveEnvSecrets(env, 'test-connector', tempDir);

    expect(result.success).toBe(true);
    expect(result.envResolved.API_KEY).toBe(TEST_SECRET);
    expect(result.envResolved.OTHER).toBe('value');
    expect(result.resolvedRefs).toContain(storeResult.reference);
  });

  it('should return error for missing secrets', async () => {
    const env = {
      API_KEY: 'plain:nonexistent-id',
    };

    const result = await resolveEnvSecrets(env, 'my-connector', tempDir);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].key).toBe('API_KEY');
    expect(result.errors[0].ref).toBe('plain:nonexistent-id');
    expect(result.errors[0].message).toContain('not found');
    expect(result.errors[0].suggestion).toContain('pfscan secrets set');
    // Original ref is preserved in output
    expect(result.envResolved.API_KEY).toBe('plain:nonexistent-id');
  });

  it('should handle multiple secrets', async () => {
    const store = new SqliteSecretStore(tempDir);
    const result1 = await store.store('secret-one', { connectorId: 'test' });
    const result2 = await store.store('secret-two', { connectorId: 'test' });
    store.close();

    const env = {
      KEY_ONE: result1.reference,
      KEY_TWO: result2.reference,
      PLAIN: 'not-a-secret',
    };

    const result = await resolveEnvSecrets(env, 'test', tempDir);

    expect(result.success).toBe(true);
    expect(result.envResolved.KEY_ONE).toBe('secret-one');
    expect(result.envResolved.KEY_TWO).toBe('secret-two');
    expect(result.envResolved.PLAIN).toBe('not-a-secret');
    expect(result.resolvedRefs.length).toBe(2);
  });

  it('should handle partial resolution (some missing)', async () => {
    const store = new SqliteSecretStore(tempDir);
    const result1 = await store.store('existing-secret', { connectorId: 'test' });
    store.close();

    const env = {
      KEY_EXISTS: result1.reference,
      KEY_MISSING: 'plain:does-not-exist',
    };

    const result = await resolveEnvSecrets(env, 'test', tempDir);

    expect(result.success).toBe(false);
    expect(result.envResolved.KEY_EXISTS).toBe('existing-secret');
    expect(result.envResolved.KEY_MISSING).toBe('plain:does-not-exist'); // Preserved as-is
    expect(result.resolvedRefs.length).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].key).toBe('KEY_MISSING');
  });
});

describe('formatResolveErrors', () => {
  it('should return empty array for no errors', () => {
    const lines = formatResolveErrors([], 'test');
    expect(lines).toEqual([]);
  });

  it('should format single error', () => {
    const errors = [{
      key: 'API_KEY',
      ref: 'plain:missing-id',
      message: 'Secret not found',
      suggestion: 'pfscan secrets set test API_KEY',
    }];

    const lines = formatResolveErrors(errors, 'test');

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('test');
    expect(lines.some(l => l.includes('API_KEY'))).toBe(true);
    expect(lines.some(l => l.includes('pfscan secrets set'))).toBe(true);
  });

  it('should format multiple errors', () => {
    const errors = [
      { key: 'KEY1', ref: 'plain:id1', message: 'Not found' },
      { key: 'KEY2', ref: 'plain:id2', message: 'Not found' },
    ];

    const lines = formatResolveErrors(errors, 'my-connector');

    expect(lines[0]).toContain('2');
    expect(lines[0]).toContain('my-connector');
  });
});
