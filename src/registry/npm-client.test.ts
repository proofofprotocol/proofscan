/**
 * Tests for npm Registry Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NpmRegistryClient } from './npm-client.js';
import { DEFAULT_TRUSTED_NPM_SCOPES } from './trust.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('NpmRegistryClient', () => {
  let client: NpmRegistryClient;

  beforeEach(() => {
    client = new NpmRegistryClient();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchServers', () => {
    it('should construct correct search URL with scopes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ objects: [], total: 0 }),
      });

      await client.searchServers({ query: 'time' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url);

      // Should include scope filter
      expect(decodedUrl).toContain('scope:@modelcontextprotocol');
      expect(decodedUrl).toContain('scope:@anthropic');
      // Should include query and mcp keyword
      expect(decodedUrl).toContain('time');
      expect(decodedUrl).toContain('mcp');
    });

    it('should use custom scopes when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ objects: [], total: 0 }),
      });

      await client.searchServers({
        query: 'server',
        scopes: ['@mycompany'],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url);
      expect(decodedUrl).toContain('scope:@mycompany');
      expect(decodedUrl).not.toContain('@modelcontextprotocol');
    });

    it('should map search results to ServerInfo', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            objects: [
              {
                package: {
                  name: '@modelcontextprotocol/server-time',
                  version: '0.6.2',
                  description: 'Time and timezone tools',
                  keywords: ['mcp', 'time'],
                  repository: { url: 'git+https://github.com/modelcontextprotocol/servers.git' },
                  homepage: 'https://modelcontextprotocol.io',
                },
                score: { final: 0.9 },
                searchScore: 100,
              },
            ],
            total: 1,
          }),
      });

      const results = await client.searchServers({ query: 'time' });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('@modelcontextprotocol/server-time');
      expect(results[0].version).toBe('0.6.2');
      expect(results[0].description).toBe('Time and timezone tools');
      expect(results[0].packages).toBeDefined();
      expect(results[0].packages![0].registryType).toBe('npm');
      expect(results[0].packages![0].identifier).toBe('@modelcontextprotocol/server-time');
    });

    it('should normalize repository URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            objects: [
              {
                package: {
                  name: 'test-package',
                  version: '1.0.0',
                  repository: { url: 'git+https://github.com/org/repo.git' },
                },
              },
            ],
            total: 1,
          }),
      });

      const results = await client.searchServers({ query: 'test' });

      expect(results[0].repository).toBe('https://github.com/org/repo');
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const results = await client.searchServers({ query: 'time' });

      expect(results).toEqual([]);
    });

    it('should return empty array on non-200 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const results = await client.searchServers({ query: 'time' });

      expect(results).toEqual([]);
    });

    it('should limit size to MAX_SEARCH_SIZE', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ objects: [], total: 0 }),
      });

      await client.searchServers({ query: 'test', size: 1000 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('size=250'); // MAX_SEARCH_SIZE
    });

    it('should use default scopes from DEFAULT_TRUSTED_NPM_SCOPES', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ objects: [], total: 0 }),
      });

      await client.searchServers({ query: 'test' });

      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url);
      for (const scope of DEFAULT_TRUSTED_NPM_SCOPES) {
        expect(decodedUrl).toContain(`scope:${scope}`);
      }
    });
  });

  describe('getPackage', () => {
    it('should fetch package details by name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: '@modelcontextprotocol/server-time',
            description: 'Time tools',
            'dist-tags': { latest: '0.6.2' },
            versions: {
              '0.6.2': { version: '0.6.2', description: 'Time tools v0.6.2' },
              '0.6.1': { version: '0.6.1' },
            },
            repository: { url: 'https://github.com/org/repo' },
            homepage: 'https://example.com',
          }),
      });

      const pkg = await client.getPackage('@modelcontextprotocol/server-time');

      expect(pkg).not.toBeNull();
      expect(pkg!.name).toBe('@modelcontextprotocol/server-time');
      expect(pkg!.version).toBe('0.6.2');
      expect(pkg!.versions).toContain('0.6.2');
      expect(pkg!.versions).toContain('0.6.1');
    });

    it('should return null on not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const pkg = await client.getPackage('nonexistent-package');

      expect(pkg).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const pkg = await client.getPackage('@modelcontextprotocol/server-time');

      expect(pkg).toBeNull();
    });

    it('should encode package name in URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: '@modelcontextprotocol/server-time',
            'dist-tags': { latest: '1.0.0' },
          }),
      });

      await client.getPackage('@modelcontextprotocol/server-time');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('%40modelcontextprotocol%2Fserver-time');
    });

    it('should include packages array for install', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: '@modelcontextprotocol/server-time',
            'dist-tags': { latest: '0.6.2' },
          }),
      });

      const pkg = await client.getPackage('@modelcontextprotocol/server-time');

      expect(pkg!.packages).toBeDefined();
      expect(pkg!.packages![0].registryType).toBe('npm');
      expect(pkg!.packages![0].identifier).toBe('@modelcontextprotocol/server-time');
      expect(pkg!.packages![0].version).toBe('0.6.2');
    });
  });
});
