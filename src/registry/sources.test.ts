/**
 * Tests for catalog sources
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CATALOG_SOURCES,
  DEFAULT_CATALOG_SOURCE,
  getSourceNames,
  getSource,
  isValidSource,
  getSourceApiKey,
  isSourceReady,
  getAuthErrorMessage,
  formatSourceLine,
} from './sources.js';

describe('catalog sources', () => {
  describe('CATALOG_SOURCES', () => {
    it('should have official source', () => {
      const official = CATALOG_SOURCES.find((s) => s.name === 'official');
      expect(official).toBeDefined();
      expect(official?.baseUrl).toBe('https://registry.modelcontextprotocol.io/v0');
      expect(official?.authRequired).toBe(false);
    });

    it('should have smithery source', () => {
      const smithery = CATALOG_SOURCES.find((s) => s.name === 'smithery');
      expect(smithery).toBeDefined();
      expect(smithery?.baseUrl).toBe('https://registry.smithery.ai');
      expect(smithery?.authRequired).toBe(true);
      expect(smithery?.authEnvVar).toBe('SMITHERY_API_KEY');
    });
  });

  describe('DEFAULT_CATALOG_SOURCE', () => {
    it('should be official', () => {
      expect(DEFAULT_CATALOG_SOURCE).toBe('official');
    });
  });

  describe('getSourceNames', () => {
    it('should return all source names', () => {
      const names = getSourceNames();
      expect(names).toContain('official');
      expect(names).toContain('smithery');
    });
  });

  describe('getSource', () => {
    it('should return source by name', () => {
      const source = getSource('official');
      expect(source).toBeDefined();
      expect(source?.name).toBe('official');
    });

    it('should return undefined for unknown source', () => {
      const source = getSource('unknown');
      expect(source).toBeUndefined();
    });
  });

  describe('isValidSource', () => {
    it('should return true for valid sources', () => {
      expect(isValidSource('official')).toBe(true);
      expect(isValidSource('smithery')).toBe(true);
    });

    it('should return false for invalid sources', () => {
      expect(isValidSource('unknown')).toBe(false);
      expect(isValidSource('')).toBe(false);
    });
  });

  describe('getSourceApiKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return undefined for sources without auth', () => {
      const source = getSource('official')!;
      expect(getSourceApiKey(source)).toBeUndefined();
    });

    it('should return env var value for auth-required sources', () => {
      process.env.SMITHERY_API_KEY = 'test-key';
      const source = getSource('smithery')!;
      expect(getSourceApiKey(source)).toBe('test-key');
    });

    it('should return undefined if env var not set', () => {
      delete process.env.SMITHERY_API_KEY;
      const source = getSource('smithery')!;
      expect(getSourceApiKey(source)).toBeUndefined();
    });
  });

  describe('isSourceReady', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return true for sources without auth', () => {
      const source = getSource('official')!;
      expect(isSourceReady(source)).toBe(true);
    });

    it('should return true if auth key is set', () => {
      process.env.SMITHERY_API_KEY = 'test-key';
      const source = getSource('smithery')!;
      expect(isSourceReady(source)).toBe(true);
    });

    it('should return false if auth key not set', () => {
      delete process.env.SMITHERY_API_KEY;
      const source = getSource('smithery')!;
      expect(isSourceReady(source)).toBe(false);
    });
  });

  describe('getAuthErrorMessage', () => {
    it('should return empty string for sources without auth', () => {
      const source = getSource('official')!;
      expect(getAuthErrorMessage(source)).toBe('');
    });

    it('should return error message for auth-required sources', () => {
      const source = getSource('smithery')!;
      expect(getAuthErrorMessage(source)).toContain('SMITHERY_API_KEY');
    });
  });

  describe('formatSourceLine', () => {
    it('should format non-default source', () => {
      const source = getSource('official')!;
      const line = formatSourceLine(source, false);
      expect(line).toContain('official');
      expect(line).toContain('(no auth)');
      expect(line.startsWith(' ')).toBe(true);
    });

    it('should format default source with marker', () => {
      const source = getSource('official')!;
      const line = formatSourceLine(source, true);
      expect(line.startsWith('*')).toBe(true);
    });

    it('should show auth info for auth-required sources', () => {
      const source = getSource('smithery')!;
      const line = formatSourceLine(source, false);
      expect(line).toContain('SMITHERY_API_KEY');
    });
  });
});
