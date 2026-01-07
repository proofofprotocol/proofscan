/**
 * Tests for catalog sources
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  setSecretResolver,
} from './sources.js';

describe('catalog sources', () => {
  // Reset secret resolver before each test
  beforeEach(() => {
    setSecretResolver(null as unknown as (key: string) => Promise<string | undefined>);
  });

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
      expect(smithery?.secretKey).toBe('catalog.smithery');
    });

    it('should have at least two sources', () => {
      expect(CATALOG_SOURCES.length).toBeGreaterThanOrEqual(2);
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
    it('should return undefined for sources without auth', async () => {
      const source = getSource('official')!;
      expect(await getSourceApiKey(source)).toBeUndefined();
    });

    it('should return undefined when no secret resolver is set', async () => {
      const source = getSource('smithery')!;
      expect(await getSourceApiKey(source)).toBeUndefined();
    });

    it('should return API key from secret resolver', async () => {
      setSecretResolver(async (key: string) => {
        if (key === 'catalog.smithery') {
          return 'test-api-key-123';
        }
        return undefined;
      });

      const source = getSource('smithery')!;
      expect(await getSourceApiKey(source)).toBe('test-api-key-123');
    });
  });

  describe('isSourceReady', () => {
    it('should return true for sources without auth', () => {
      const source = getSource('official')!;
      expect(isSourceReady(source)).toBe(true);
    });

    it('should return true for auth sources with secretKey defined', () => {
      const source = getSource('smithery')!;
      expect(isSourceReady(source)).toBe(true);
    });
  });

  describe('getAuthErrorMessage', () => {
    it('should return empty string for sources without auth', () => {
      const source = getSource('official')!;
      expect(getAuthErrorMessage(source)).toBe('');
    });

    it('should return proper error message for auth sources', () => {
      const source = getSource('smithery')!;
      const msg = getAuthErrorMessage(source);
      expect(msg).toContain('smithery');
      expect(msg).toContain('pfscan secrets set catalog.smithery');
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

    it('should format auth source with secret key', () => {
      const source = getSource('smithery')!;
      const line = formatSourceLine(source, false);
      expect(line).toContain('smithery');
      expect(line).toContain('secret:');
      expect(line).toContain('catalog.smithery');
    });
  });
});
