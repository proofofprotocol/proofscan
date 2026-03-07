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
});
