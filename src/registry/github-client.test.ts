/**
 * Tests for GitHub Reference Servers Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GitHubRegistryClient,
  REFERENCE_SERVER_DIRS,
  FALLBACK_SERVERS,
} from './github-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GitHubRegistryClient', () => {
  let client: GitHubRegistryClient;

  beforeEach(() => {
    client = new GitHubRegistryClient();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('REFERENCE_SERVER_DIRS', () => {
    it('should have 7 reference server directories', () => {
      expect(REFERENCE_SERVER_DIRS).toHaveLength(7);
    });

    it('should include expected directories', () => {
      expect(REFERENCE_SERVER_DIRS).toContain('src/fetch');
      expect(REFERENCE_SERVER_DIRS).toContain('src/time');
      expect(REFERENCE_SERVER_DIRS).toContain('src/filesystem');
    });
  });

  describe('FALLBACK_SERVERS', () => {
    it('should have 7 fallback servers', () => {
      expect(FALLBACK_SERVERS).toHaveLength(7);
    });

    it('should have npm package info', () => {
      for (const server of FALLBACK_SERVERS) {
        expect(server.name).toMatch(/^@modelcontextprotocol\/server-/);
        expect(server.packages).toBeDefined();
        expect(server.packages![0].registryType).toBe('npm');
      }
    });
  });

  describe('listServers', () => {
    it('should fetch package.json for each server', async () => {
      // Mock successful responses
      mockFetch.mockImplementation((url: string) => {
        const dir = url.includes('/fetch/') ? 'fetch' :
                   url.includes('/time/') ? 'time' :
                   url.includes('/git/') ? 'git' : 'other';
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            name: `@modelcontextprotocol/server-${dir}`,
            version: '1.0.0',
            description: `${dir} server`,
          }),
        });
      });

      const servers = await client.listServers();

      expect(servers).toHaveLength(7);
      expect(mockFetch).toHaveBeenCalledTimes(7);
    });

    it('should use cached results on subsequent calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: '@modelcontextprotocol/server-test',
          version: '1.0.0',
        }),
      });

      await client.listServers();
      await client.listServers();

      // Should only fetch once
      expect(mockFetch).toHaveBeenCalledTimes(7);
    });

    it('should refetch after cache clear', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: '@modelcontextprotocol/server-test',
          version: '1.0.0',
        }),
      });

      await client.listServers();
      client.clearCache();
      await client.listServers();

      // Should fetch twice (7 * 2 = 14)
      expect(mockFetch).toHaveBeenCalledTimes(14);
    });

    it('should fall back to hardcoded server on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const servers = await client.listServers();

      expect(servers).toHaveLength(7);
      // Should return fallback servers
      expect(servers[0].name).toBe(FALLBACK_SERVERS[0].name);
    });

    it('should fall back on non-200 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const servers = await client.listServers();

      expect(servers).toHaveLength(7);
      expect(servers[0].name).toBe(FALLBACK_SERVERS[0].name);
    });

    it('should include version from package.json', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: '@modelcontextprotocol/server-fetch',
          version: '2.5.0',
          description: 'Fetch server',
        }),
      });

      const servers = await client.listServers();

      expect(servers[0].version).toBe('2.5.0');
      expect(servers[0].packages![0].version).toBe('2.5.0');
    });
  });

  describe('searchServers', () => {
    beforeEach(() => {
      // Use fallback (mock fetch fails)
      mockFetch.mockRejectedValue(new Error('Network error'));
    });

    it('should filter by name', async () => {
      const results = await client.searchServers('fetch');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('fetch');
    });

    it('should filter by description', async () => {
      const results = await client.searchServers('timezone');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].description?.toLowerCase()).toContain('time');
    });

    it('should be case-insensitive', async () => {
      const lower = await client.searchServers('fetch');
      const upper = await client.searchServers('FETCH');

      expect(lower.length).toBe(upper.length);
    });

    it('should return empty array for no match', async () => {
      const results = await client.searchServers('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('getServer', () => {
    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('Network error'));
    });

    it('should find by exact name', async () => {
      const server = await client.getServer('@modelcontextprotocol/server-fetch');

      expect(server).not.toBeNull();
      expect(server!.name).toBe('@modelcontextprotocol/server-fetch');
    });

    it('should find by suffix (short name)', async () => {
      const server = await client.getServer('fetch');

      expect(server).not.toBeNull();
      expect(server!.name).toBe('@modelcontextprotocol/server-fetch');
    });

    it('should find by server- prefix suffix', async () => {
      const server = await client.getServer('server-time');

      expect(server).not.toBeNull();
      expect(server!.name).toBe('@modelcontextprotocol/server-time');
    });

    it('should return null for non-existent server', async () => {
      const server = await client.getServer('nonexistent');

      expect(server).toBeNull();
    });

    it('should be case-insensitive', async () => {
      const server = await client.getServer('FETCH');

      expect(server).not.toBeNull();
      expect(server!.name).toBe('@modelcontextprotocol/server-fetch');
    });
  });

  describe('fetchPackageJson', () => {
    it('should construct correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'test' }),
      });

      await client.listServers();

      // Check that fetch was called with correct URLs
      const calls = mockFetch.mock.calls;
      expect(calls.some((c) => c[0].includes('src/fetch/package.json'))).toBe(true);
      expect(calls.some((c) => c[0].includes('src/time/package.json'))).toBe(true);
    });

    it('should handle JSON parse errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const servers = await client.listServers();

      // Should return fallback
      expect(servers).toHaveLength(7);
      expect(servers[0].name).toBe(FALLBACK_SERVERS[0].name);
    });

    it('should handle timeout errors gracefully', async () => {
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        });
      });

      const servers = await client.listServers();

      expect(servers).toHaveLength(7);
    });
  });
});
