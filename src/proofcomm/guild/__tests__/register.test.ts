/**
 * ProofGuild - Registration tests
 * Phase 5: ProofGuild
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateGuildToken,
  validateApiKey,
  isApiKeyConfigured,
  getGuildTokenCount,
  cleanupGuildTokens,
  isExternalUrl,
} from '../register.js';

describe('ProofGuild Registration', () => {
  describe('validateGuildToken', () => {
    it('should return null for invalid token', () => {
      const result = validateGuildToken('invalid-token-123');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = validateGuildToken('');
      expect(result).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    it('should return false for missing auth header', () => {
      expect(validateApiKey(undefined)).toBe(false);
    });

    it('should return false for empty auth header', () => {
      expect(validateApiKey('')).toBe(false);
    });

    it('should return false for non-Bearer auth', () => {
      expect(validateApiKey('Basic abc123')).toBe(false);
    });

    it('should return false for invalid Bearer format', () => {
      expect(validateApiKey('Bearer')).toBe(false);
    });

    // Note: Cannot test valid API key without setting GUILD_API_KEY env var
    // which would require mocking process.env
  });

  describe('isApiKeyConfigured', () => {
    it('should return boolean', () => {
      const result = isApiKeyConfigured();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getGuildTokenCount', () => {
    it('should return number of registered tokens', () => {
      const count = getGuildTokenCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanupGuildTokens', () => {
    it('should not throw when called', () => {
      expect(() => cleanupGuildTokens()).not.toThrow();
    });
  });

  describe('isExternalUrl (SSRF protection)', () => {
    it('should return true for external URLs', () => {
      expect(isExternalUrl('https://example.com')).toBe(true);
      expect(isExternalUrl('https://api.openai.com/v1')).toBe(true);
      expect(isExternalUrl('http://github.com')).toBe(true);
    });

    it('should return false for localhost', () => {
      expect(isExternalUrl('http://localhost:8080')).toBe(false);
      expect(isExternalUrl('http://localhost')).toBe(false);
      expect(isExternalUrl('https://localhost.localdomain')).toBe(false);
    });

    it('should return false for loopback IP (127.x.x.x)', () => {
      expect(isExternalUrl('http://127.0.0.1:8080')).toBe(false);
      expect(isExternalUrl('http://127.1.2.3')).toBe(false);
    });

    it('should return false for private Class A (10.x.x.x)', () => {
      expect(isExternalUrl('http://10.0.0.1')).toBe(false);
      expect(isExternalUrl('http://10.255.255.255')).toBe(false);
    });

    it('should return false for private Class B (172.16-31.x.x)', () => {
      expect(isExternalUrl('http://172.16.0.1')).toBe(false);
      expect(isExternalUrl('http://172.31.255.255')).toBe(false);
    });

    it('should return false for private Class C (192.168.x.x)', () => {
      expect(isExternalUrl('http://192.168.0.1')).toBe(false);
      expect(isExternalUrl('http://192.168.1.1')).toBe(false);
    });

    it('should return false for link-local (169.254.x.x)', () => {
      expect(isExternalUrl('http://169.254.0.1')).toBe(false);
      expect(isExternalUrl('http://169.254.169.254')).toBe(false);
    });

    it('should return false for IPv6 loopback', () => {
      expect(isExternalUrl('http://[::1]:8080')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isExternalUrl('not-a-url')).toBe(false);
      expect(isExternalUrl('')).toBe(false);
    });
  });
});
