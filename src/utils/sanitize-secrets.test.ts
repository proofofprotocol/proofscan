/**
 * Tests for sanitize-secrets module
 */

import { describe, it, expect } from 'vitest';
import { sanitizeSecrets, hasSecretRefs, countSecretRefs } from './sanitize-secrets.js';

describe('sanitizeSecrets', () => {
  it('returns unchanged primitive values', () => {
    expect(sanitizeSecrets(null)).toEqual({ value: null, count: 0 });
    expect(sanitizeSecrets(undefined)).toEqual({ value: undefined, count: 0 });
    expect(sanitizeSecrets(42)).toEqual({ value: 42, count: 0 });
    expect(sanitizeSecrets(true)).toEqual({ value: true, count: 0 });
    expect(sanitizeSecrets('hello')).toEqual({ value: 'hello', count: 0 });
  });

  it('sanitizes secret:// string value', () => {
    const result = sanitizeSecrets('secret://local/vault/API_KEY');
    expect(result.value).toBe('secret://***');
    expect(result.count).toBe(1);
  });

  it('does not change non-secret strings', () => {
    expect(sanitizeSecrets('http://example.com')).toEqual({ value: 'http://example.com', count: 0 });
    expect(sanitizeSecrets('my-secret')).toEqual({ value: 'my-secret', count: 0 });
    expect(sanitizeSecrets('secret')).toEqual({ value: 'secret', count: 0 });
  });

  it('sanitizes secret in simple object', () => {
    const input = {
      env: {
        API_KEY: 'secret://local/foo/API_KEY',
      },
    };
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual({
      env: {
        API_KEY: 'secret://***',
      },
    });
    expect(result.count).toBe(1);
  });

  it('sanitizes multiple secrets in nested object', () => {
    const input = {
      database: {
        url: 'secret://vault/db/CONNECTION_STRING',
        user: 'admin',
        password: 'secret://vault/db/PASSWORD',
      },
      api: {
        key: 'secret://local/api/KEY',
      },
    };
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual({
      database: {
        url: 'secret://***',
        user: 'admin',
        password: 'secret://***',
      },
      api: {
        key: 'secret://***',
      },
    });
    expect(result.count).toBe(3);
  });

  it('sanitizes secrets in arrays', () => {
    const input = {
      keys: ['secret://a', 'normal', 'secret://b'],
    };
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual({
      keys: ['secret://***', 'normal', 'secret://***'],
    });
    expect(result.count).toBe(2);
  });

  it('handles deeply nested structures', () => {
    const input = {
      level1: {
        level2: {
          level3: {
            level4: {
              secret: 'secret://deep/path/value',
            },
          },
        },
      },
    };
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual({
      level1: {
        level2: {
          level3: {
            level4: {
              secret: 'secret://***',
            },
          },
        },
      },
    });
    expect(result.count).toBe(1);
  });

  it('handles mixed array with objects', () => {
    const input = [
      { key: 'secret://first' },
      'plain string',
      { nested: { key: 'secret://second' } },
      42,
    ];
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual([
      { key: 'secret://***' },
      'plain string',
      { nested: { key: 'secret://***' } },
      42,
    ]);
    expect(result.count).toBe(2);
  });

  it('does not modify original object', () => {
    const original = {
      secret: 'secret://original',
    };
    const result = sanitizeSecrets(original);
    expect(original.secret).toBe('secret://original');
    expect((result.value as { secret: string }).secret).toBe('secret://***');
  });

  it('handles empty objects and arrays', () => {
    expect(sanitizeSecrets({})).toEqual({ value: {}, count: 0 });
    expect(sanitizeSecrets([])).toEqual({ value: [], count: 0 });
  });

  it('handles MCP connector config format', () => {
    const input = {
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js'],
          env: {
            API_KEY: 'secret://local/myServer/API_KEY',
            DATABASE_URL: 'secret://vault/prod/DATABASE_URL',
            NORMAL_VAR: 'normal-value',
          },
        },
      },
    };
    const result = sanitizeSecrets(input);
    expect(result.value).toEqual({
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js'],
          env: {
            API_KEY: 'secret://***',
            DATABASE_URL: 'secret://***',
            NORMAL_VAR: 'normal-value',
          },
        },
      },
    });
    expect(result.count).toBe(2);
  });
});

describe('hasSecretRefs', () => {
  it('returns false for values without secrets', () => {
    expect(hasSecretRefs(null)).toBe(false);
    expect(hasSecretRefs('hello')).toBe(false);
    expect(hasSecretRefs({ key: 'value' })).toBe(false);
  });

  it('returns true for values with secrets', () => {
    expect(hasSecretRefs('secret://test')).toBe(true);
    expect(hasSecretRefs({ key: 'secret://test' })).toBe(true);
    expect(hasSecretRefs([{ nested: 'secret://deep' }])).toBe(true);
  });
});

describe('countSecretRefs', () => {
  it('returns 0 for values without secrets', () => {
    expect(countSecretRefs(null)).toBe(0);
    expect(countSecretRefs({ a: 'b' })).toBe(0);
  });

  it('returns correct count for multiple secrets', () => {
    expect(countSecretRefs({ a: 'secret://1', b: 'secret://2', c: 'normal' })).toBe(2);
  });
});
