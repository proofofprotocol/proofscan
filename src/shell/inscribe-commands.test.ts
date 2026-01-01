/**
 * Inscribe command tests (Phase 4.3)
 */

import { describe, it, expect } from 'vitest';
import { redactForInscribe } from './inscribe-commands.js';

describe('redactForInscribe', () => {
  describe('should redact secret keys with "***"', () => {
    it('should redact apiKey', () => {
      const input = { apiKey: 'sk-1234567890' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ apiKey: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact api_key', () => {
      const input = { api_key: 'secret123' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ api_key: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact authorization', () => {
      const input = { authorization: 'Bearer token123' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ authorization: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact secret', () => {
      const input = { secret: 'mysecretvalue' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ secret: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact token', () => {
      const input = { access_token: 'abc123' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ access_token: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact password', () => {
      const input = { password: 'hunter2' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ password: '***' });
      expect(result.count).toBe(1);
    });
  });

  describe('should handle deep nesting', () => {
    it('should redact nested secrets', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              apiKey: 'deep-secret',
            },
          },
        },
      };
      const result = redactForInscribe(input);
      expect((result.value as Record<string, unknown>).level1).toEqual({
        level2: {
          level3: {
            apiKey: '***',
          },
        },
      });
      expect(result.count).toBe(1);
    });

    it('should redact multiple nested secrets', () => {
      const input = {
        request: {
          headers: {
            authorization: 'Bearer xyz',
          },
          body: {
            credentials: {
              password: 'secret123',
              apiKey: 'key456',
            },
          },
        },
      };
      const result = redactForInscribe(input);
      const val = result.value as Record<string, unknown>;
      const request = val.request as Record<string, unknown>;
      const headers = request.headers as Record<string, unknown>;
      const body = request.body as Record<string, unknown>;
      const credentials = body.credentials as Record<string, unknown>;

      expect(headers.authorization).toBe('***');
      expect(credentials.password).toBe('***');
      expect(credentials.apiKey).toBe('***');
      expect(result.count).toBe(3);
    });
  });

  describe('should handle arrays', () => {
    it('should redact secrets in arrays', () => {
      const input = {
        items: [
          { apiKey: 'key1' },
          { apiKey: 'key2' },
        ],
      };
      const result = redactForInscribe(input);
      const val = result.value as Record<string, unknown>;
      const items = val.items as Record<string, unknown>[];

      expect(items[0].apiKey).toBe('***');
      expect(items[1].apiKey).toBe('***');
      expect(result.count).toBe(2);
    });
  });

  describe('should redact secret references', () => {
    it('should redact dpapi references', () => {
      const input = { value: 'dpapi:encrypted-data' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ value: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact keychain references', () => {
      const input = { value: 'keychain:my-secret-id' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ value: '***' });
      expect(result.count).toBe(1);
    });
  });

  describe('should not redact non-secret values', () => {
    it('should preserve normal values', () => {
      const input = {
        name: 'test',
        count: 42,
        enabled: true,
        items: ['a', 'b', 'c'],
      };
      const result = redactForInscribe(input);
      expect(result.value).toEqual(input);
      expect(result.count).toBe(0);
    });

    it('should preserve nested non-secret values', () => {
      const input = {
        user: {
          name: 'alice',
          settings: {
            theme: 'dark',
          },
        },
      };
      const result = redactForInscribe(input);
      expect(result.value).toEqual(input);
      expect(result.count).toBe(0);
    });
  });

  describe('should handle edge cases', () => {
    it('should handle null values', () => {
      const input = { apiKey: null };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ apiKey: null });
      expect(result.count).toBe(0);
    });

    it('should handle empty strings', () => {
      const input = { apiKey: '' };
      const result = redactForInscribe(input);
      // Empty strings are not redacted (nothing to hide)
      expect(result.value).toEqual({ apiKey: '' });
      expect(result.count).toBe(0);
    });

    it('should handle undefined', () => {
      const result = redactForInscribe(undefined);
      expect(result.value).toBeUndefined();
      expect(result.count).toBe(0);
    });

    it('should handle primitive values', () => {
      expect(redactForInscribe('hello').value).toBe('hello');
      expect(redactForInscribe(42).value).toBe(42);
      expect(redactForInscribe(true).value).toBe(true);
    });
  });

  describe('case insensitive matching', () => {
    it('should redact APIKEY (uppercase)', () => {
      const input = { APIKEY: 'value' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ APIKEY: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact ApiKey (mixed case)', () => {
      const input = { ApiKey: 'value' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ ApiKey: '***' });
      expect(result.count).toBe(1);
    });

    it('should redact client_secret', () => {
      const input = { client_secret: 'secret-value' };
      const result = redactForInscribe(input);
      expect(result.value).toEqual({ client_secret: '***' });
      expect(result.count).toBe(1);
    });
  });
});
