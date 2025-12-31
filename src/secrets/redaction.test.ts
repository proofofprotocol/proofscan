/**
 * Tests for secret redaction utilities
 */

import { describe, it, expect } from 'vitest';
import {
  redactDeep,
  redactValue,
  redactEnv,
  redactionSummary,
  isRedacted,
  REDACTED,
  REDACTED_REF,
} from './redaction.js';

describe('redactDeep', () => {
  it('should redact secret references', () => {
    const value = {
      env: {
        PATH: '/usr/bin',
        API_KEY: 'dpapi:abc123',
      },
    };

    const result = redactDeep(value);

    expect(result.count).toBe(1);
    expect((result.value as { env: { API_KEY: string } }).env.API_KEY).toBe(REDACTED_REF);
    expect((result.value as { env: { PATH: string } }).env.PATH).toBe('/usr/bin');
  });

  it('should redact values for secret keys', () => {
    const value = {
      env: {
        OPENAI_API_KEY: 'sk-1234567890',
        DEBUG: 'true',
      },
    };

    const result = redactDeep(value);

    expect(result.count).toBe(1);
    expect((result.value as { env: { OPENAI_API_KEY: string } }).env.OPENAI_API_KEY).toBe(REDACTED);
    expect((result.value as { env: { DEBUG: string } }).env.DEBUG).toBe('true');
  });

  it('should handle nested objects', () => {
    const value = {
      connectors: [
        {
          id: 'test',
          transport: {
            env: {
              API_KEY: 'secret-value',
            },
          },
        },
      ],
    };

    const result = redactDeep(value);

    expect(result.count).toBe(1);
    const connectors = (result.value as { connectors: Array<{ transport: { env: { API_KEY: string } } }> }).connectors;
    expect(connectors[0].transport.env.API_KEY).toBe(REDACTED);
  });

  it('should handle arrays', () => {
    const value = {
      tokens: ['dpapi:abc', 'dpapi:def'],
    };

    const result = redactDeep(value);

    expect(result.count).toBe(2);
    const tokens = (result.value as { tokens: string[] }).tokens;
    expect(tokens[0]).toBe(REDACTED_REF);
    expect(tokens[1]).toBe(REDACTED_REF);
  });

  it('should handle null and undefined', () => {
    const value = {
      env: {
        API_KEY: null,
        SECRET: undefined,
      },
    };

    const result = redactDeep(value);

    expect(result.count).toBe(0);
    const env = (result.value as { env: { API_KEY: null; SECRET: undefined } }).env;
    expect(env.API_KEY).toBeNull();
    expect(env.SECRET).toBeUndefined();
  });

  it('should not redact already redacted values', () => {
    const value = {
      env: {
        API_KEY: REDACTED,
      },
    };

    const result = redactDeep(value);

    expect(result.count).toBe(0);
    expect((result.value as { env: { API_KEY: string } }).env.API_KEY).toBe(REDACTED);
  });

  it('should not redact empty strings', () => {
    const value = {
      env: {
        API_KEY: '',
      },
    };

    const result = redactDeep(value);

    expect(result.count).toBe(0);
    expect((result.value as { env: { API_KEY: string } }).env.API_KEY).toBe('');
  });

  it('should use custom redaction strings', () => {
    const value = {
      env: {
        API_KEY: 'secret',
        TOKEN: 'dpapi:xxx',
      },
    };

    const result = redactDeep(value, {
      redactedValue: '[HIDDEN]',
      redactedRef: '[REF]',
    });

    expect(result.count).toBe(2);
    const env = (result.value as { env: { API_KEY: string; TOKEN: string } }).env;
    expect(env.API_KEY).toBe('[HIDDEN]');
    expect(env.TOKEN).toBe('[REF]');
  });

  it('should skip secret key redaction when disabled', () => {
    const value = {
      env: {
        API_KEY: 'secret-value',
      },
    };

    const result = redactDeep(value, { redactSecretKeys: false });

    expect(result.count).toBe(0);
    expect((result.value as { env: { API_KEY: string } }).env.API_KEY).toBe('secret-value');
  });

  it('should skip secret ref redaction when disabled', () => {
    const value = {
      env: {
        API_KEY: 'dpapi:abc123',
      },
    };

    const result = redactDeep(value, { redactSecretRefs: false });

    // Should still redact because API_KEY is a secret key
    expect(result.count).toBe(1);
    expect((result.value as { env: { API_KEY: string } }).env.API_KEY).toBe(REDACTED);
  });

  it('should handle primitives at top level', () => {
    expect(redactDeep('dpapi:abc').value).toBe(REDACTED_REF);
    expect(redactDeep('dpapi:abc').count).toBe(1);
    expect(redactDeep(123).value).toBe(123);
    expect(redactDeep(true).value).toBe(true);
    expect(redactDeep(null).value).toBeNull();
  });
});

describe('redactValue', () => {
  it('should redact secret references', () => {
    expect(redactValue('TOKEN', 'dpapi:abc123')).toBe(REDACTED_REF);
    expect(redactValue('TOKEN', 'keychain:xyz')).toBe(REDACTED_REF);
  });

  it('should redact values for secret keys', () => {
    expect(redactValue('API_KEY', 'my-secret')).toBe(REDACTED);
    expect(redactValue('PASSWORD', 'hunter2')).toBe(REDACTED);
  });

  it('should not redact non-secret keys', () => {
    expect(redactValue('PATH', '/usr/bin')).toBe('/usr/bin');
    expect(redactValue('DEBUG', 'true')).toBe('true');
  });

  it('should not redact empty strings', () => {
    expect(redactValue('API_KEY', '')).toBe('');
  });
});

describe('redactEnv', () => {
  it('should redact env object', () => {
    const env = {
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-test',
      PASSWORD: 'secret',
      DEBUG: 'true',
    };

    const result = redactEnv(env);

    expect(result.count).toBe(2);
    expect(result.env.PATH).toBe('/usr/bin');
    expect(result.env.OPENAI_API_KEY).toBe(REDACTED);
    expect(result.env.PASSWORD).toBe(REDACTED);
    expect(result.env.DEBUG).toBe('true');
  });

  it('should return empty object for empty env', () => {
    const result = redactEnv({});
    expect(result.count).toBe(0);
    expect(result.env).toEqual({});
  });
});

describe('redactionSummary', () => {
  it('should return empty string for zero', () => {
    expect(redactionSummary(0)).toBe('');
  });

  it('should return singular form for one', () => {
    expect(redactionSummary(1)).toBe('(1 secret redacted)');
  });

  it('should return plural form for multiple', () => {
    expect(redactionSummary(5)).toBe('(5 secrets redacted)');
  });
});

describe('isRedacted', () => {
  it('should detect REDACTED placeholder', () => {
    expect(isRedacted(REDACTED)).toBe(true);
  });

  it('should detect REDACTED_REF placeholder', () => {
    expect(isRedacted(REDACTED_REF)).toBe(true);
  });

  it('should not detect other values', () => {
    expect(isRedacted('some-value')).toBe(false);
    expect(isRedacted('***')).toBe(false);
    expect(isRedacted('')).toBe(false);
  });
});
