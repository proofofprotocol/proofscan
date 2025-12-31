/**
 * Tests for secretize utilities (Phase 3.5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { secretizeEnv, formatSecretizeOutput } from './secretize.js';

// On Windows, dpapi: is used; on other platforms, plain: is used
const expectedProvider = platform() === 'win32' ? 'dpapi' : 'plain';

// Test secrets - clearly fake patterns that won't trigger secret scanning
const TEST_SECRET_LONG = 'test_fake_secret_' + 'x'.repeat(30);
const TEST_SECRET_SHORT = 'test_fake_key_1234567890abcdef';

describe('secretizeEnv', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = join(tmpdir(), `secretize-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, '{}');
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should store real secrets and replace with dpapi reference', async () => {
    const env = {
      OPENAI_API_KEY: TEST_SECRET_LONG,
      OTHER_VAR: 'not-a-secret',
    };

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    // Secret should be stored
    expect(result.storedCount).toBe(1);
    expect(result.placeholderCount).toBe(0);

    // API key should be replaced with secret reference (dpapi on Windows, plain on others)
    expect(result.env.OPENAI_API_KEY).toMatch(new RegExp(`^${expectedProvider}:[a-f0-9-]+$`));

    // Other var should remain unchanged
    expect(result.env.OTHER_VAR).toBe('not-a-secret');

    // Check secrets.db was created
    const secretsDbPath = join(tempDir, 'secrets.db');
    expect(existsSync(secretsDbPath)).toBe(true);
  });

  it('should detect placeholders and not store them', async () => {
    const env = {
      API_KEY: 'YOUR_API_KEY',
      AUTH_TOKEN: '<your-token-here>',
    };

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    // No secrets stored
    expect(result.storedCount).toBe(0);
    // Both are placeholders
    expect(result.placeholderCount).toBe(2);

    // Values should remain unchanged (placeholders)
    expect(result.env.API_KEY).toBe('YOUR_API_KEY');
    expect(result.env.AUTH_TOKEN).toBe('<your-token-here>');
  });

  it('should skip non-secret keys', async () => {
    const env = {
      NODE_ENV: 'production',
      PORT: '3000',
      DEBUG: 'true',
    };

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    // Nothing stored or warned
    expect(result.storedCount).toBe(0);
    expect(result.placeholderCount).toBe(0);

    // All values unchanged
    expect(result.env).toEqual(env);
  });

  it('should handle empty env object', async () => {
    const env = {};

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    expect(result.storedCount).toBe(0);
    expect(result.placeholderCount).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.env).toEqual({});
  });

  it('should handle mixed env vars', async () => {
    const env = {
      API_KEY: TEST_SECRET_SHORT,
      PASSWORD: 'changeme',
      SECRET_TOKEN: TEST_SECRET_LONG,
      NODE_ENV: 'production',
    };

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    // Two real secrets stored
    expect(result.storedCount).toBe(2);
    // One placeholder detected
    expect(result.placeholderCount).toBe(1);

    // Real secrets replaced with secret references
    expect(result.env.API_KEY).toMatch(new RegExp(`^${expectedProvider}:`));
    expect(result.env.SECRET_TOKEN).toMatch(new RegExp(`^${expectedProvider}:`));

    // Placeholder remains as-is
    expect(result.env.PASSWORD).toBe('changeme');

    // Non-secret unchanged
    expect(result.env.NODE_ENV).toBe('production');
  });

  it('should create detailed results for each key', async () => {
    const env = {
      API_KEY: TEST_SECRET_SHORT,
      AUTH_TOKEN: 'YOUR_TOKEN',
      OTHER: 'value',
    };

    const result = await secretizeEnv(env, {
      configPath,
      connectorId: 'test-connector',
    });

    expect(result.results.length).toBe(3);

    // Find results by key
    const apiKeyResult = result.results.find(r => r.key === 'API_KEY');
    const tokenResult = result.results.find(r => r.key === 'AUTH_TOKEN');
    const otherResult = result.results.find(r => r.key === 'OTHER');

    expect(apiKeyResult?.action).toBe('stored');
    expect(apiKeyResult?.secretRef).toMatch(new RegExp(`^${expectedProvider}:`));

    expect(tokenResult?.action).toBe('placeholder');
    expect(tokenResult?.secretRef).toBeUndefined();

    expect(otherResult?.action).toBe('skipped');
  });
});

describe('formatSecretizeOutput', () => {
  it('should format stored secrets', () => {
    const results = [
      {
        key: 'API_KEY',
        originalValue: 'secret-value',
        newValue: 'dpapi:12345678-1234-1234-1234-123456789012',
        action: 'stored' as const,
        secretRef: 'dpapi:12345678-1234-1234-1234-123456789012',
      },
    ];

    const output = formatSecretizeOutput(results, 'my-connector');

    expect(output.length).toBe(1);
    expect(output[0]).toContain('✔ secret stored');
    expect(output[0]).toContain('my-connector.transport.env.API_KEY');
    // Reference should be truncated and contain provider prefix
    expect(output[0]).toContain('dpapi:');
  });

  it('should format placeholder warnings', () => {
    const results = [
      {
        key: 'PASSWORD',
        originalValue: 'changeme',
        newValue: 'changeme',
        action: 'placeholder' as const,
      },
    ];

    const output = formatSecretizeOutput(results, 'my-connector');

    expect(output.length).toBe(1);
    expect(output[0]).toContain('⚠ placeholder detected');
    expect(output[0]).toContain('my-connector.transport.env.PASSWORD');
  });

  it('should not output skipped keys', () => {
    const results = [
      {
        key: 'NODE_ENV',
        originalValue: 'production',
        newValue: 'production',
        action: 'skipped' as const,
      },
    ];

    const output = formatSecretizeOutput(results, 'my-connector');

    expect(output.length).toBe(0);
  });

  it('should truncate long references', () => {
    const results = [
      {
        key: 'API_KEY',
        originalValue: 'secret-value',
        newValue: 'dpapi:12345678-1234-1234-1234-123456789012',
        action: 'stored' as const,
        secretRef: 'dpapi:12345678-1234-1234-1234-123456789012',
      },
    ];

    const output = formatSecretizeOutput(results, 'test');

    // Should be truncated with ... (reference > 20 chars)
    expect(output[0]).toContain('dpapi:');
    expect(output[0]).toContain('...');
  });

  it('should show warning when using plain provider', () => {
    const results = [
      {
        key: 'API_KEY',
        originalValue: 'secret-value',
        newValue: 'plain:12345678',
        action: 'stored' as const,
        secretRef: 'plain:12345678',
      },
    ];

    const output = formatSecretizeOutput(results, 'test', { providerType: 'plain' });

    // Should include warning about plain provider
    expect(output.some(line => line.includes('WARNING'))).toBe(true);
    expect(output.some(line => line.includes('plain'))).toBe(true);
    expect(output.some(line => line.includes('NOT encrypted'))).toBe(true);
    // Should still include the stored secret line
    expect(output.some(line => line.includes('secret stored'))).toBe(true);
  });

  it('should not show plain provider warning if no secrets stored', () => {
    const results = [
      {
        key: 'PASSWORD',
        originalValue: 'changeme',
        newValue: 'changeme',
        action: 'placeholder' as const,
      },
    ];

    const output = formatSecretizeOutput(results, 'test', { providerType: 'plain' });

    // Should NOT include warning if nothing was stored
    expect(output.some(line => line.includes('WARNING'))).toBe(false);
    // But should still show placeholder warning
    expect(output.some(line => line.includes('placeholder detected'))).toBe(true);
  });

  it('should not show warning for dpapi provider', () => {
    const results = [
      {
        key: 'API_KEY',
        originalValue: 'secret-value',
        newValue: 'dpapi:12345678',
        action: 'stored' as const,
        secretRef: 'dpapi:12345678',
      },
    ];

    const output = formatSecretizeOutput(results, 'test', { providerType: 'dpapi' });

    // Should NOT include warning for dpapi
    expect(output.some(line => line.includes('WARNING'))).toBe(false);
    // Should show stored message
    expect(output.some(line => line.includes('secret stored'))).toBe(true);
  });

  it('should format storage errors (v0.7.2)', () => {
    const results = [
      {
        key: 'API_KEY',
        originalValue: 'secret-value',
        newValue: 'secret-value',
        action: 'error' as const,
        error: 'DPAPI encryption failed: PowerShell error',
      },
    ];

    const output = formatSecretizeOutput(results, 'test');

    expect(output.length).toBe(1);
    expect(output[0]).toContain('✖ storage failed');
    expect(output[0]).toContain('test.transport.env.API_KEY');
    expect(output[0]).toContain('DPAPI encryption failed');
  });

  it('should format storage errors without message', () => {
    const results = [
      {
        key: 'SECRET_TOKEN',
        originalValue: 'secret-value',
        newValue: 'secret-value',
        action: 'error' as const,
      },
    ];

    const output = formatSecretizeOutput(results, 'my-connector');

    expect(output.length).toBe(1);
    expect(output[0]).toContain('✖ storage failed');
    expect(output[0]).toContain('my-connector.transport.env.SECRET_TOKEN');
    // Should not have extra colon when no error message
    expect(output[0]).not.toContain('::');
  });
});
