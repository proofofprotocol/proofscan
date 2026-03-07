/**
 * ProofGuild - Registration tests
 * Phase 5: ProofGuild
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateGuildToken,
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
