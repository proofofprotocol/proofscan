/**
 * Tests for catalog sources
 */

import { describe, it, expect } from 'vitest';
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

    it('should have at least one source', () => {
      expect(CATALOG_SOURCES.length).toBeGreaterThanOrEqual(1);
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
    });

    it('should return false for invalid sources', () => {
      expect(isValidSource('unknown')).toBe(false);
      expect(isValidSource('')).toBe(false);
    });
  });

  describe('getSourceApiKey', () => {
    it('should return undefined for sources without auth', () => {
      const source = getSource('official')!;
      expect(getSourceApiKey(source)).toBeUndefined();
    });
  });

  describe('isSourceReady', () => {
    it('should return true for sources without auth', () => {
      const source = getSource('official')!;
      expect(isSourceReady(source)).toBe(true);
    });
  });

  describe('getAuthErrorMessage', () => {
    it('should return empty string for sources without auth', () => {
      const source = getSource('official')!;
      expect(getAuthErrorMessage(source)).toBe('');
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
  });
});
