/**
 * Tests for registry client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RegistryClient,
  RegistryError,
  SUPPORTED_FIELDS,
  isSupportedField,
  getFieldValue,
  formatFieldValue,
  type ServerInfo,
} from './client.js';

// Helper to create mock registry v0 API response
function createMockServerEntry(
  name: string,
  description?: string,
  version?: string,
  isLatest = true
) {
  return {
    server: {
      name,
      description,
      version,
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        isLatest,
      },
    },
  };
}

describe('RegistryClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('listServers', () => {
    it('should return servers from registry (latest only)', async () => {
      const mockResponse = {
        servers: [
          createMockServerEntry('server1', 'Test server 1', '1.0.0', true),
          createMockServerEntry('server1', 'Test server 1', '0.9.0', false), // older version
          createMockServerEntry('server2', 'Test server 2', '2.0.0', true),
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new RegistryClient();
      const servers = await client.listServers();

      // Should only return latest versions
      expect(servers).toHaveLength(2);
      expect(servers[0].name).toBe('server1');
      expect(servers[0].version).toBe('1.0.0');
      expect(servers[1].name).toBe('server2');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://registry.modelcontextprotocol.io/v0/servers',
        expect.any(Object)
      );
    });

    it('should handle pagination', async () => {
      const page1 = {
        servers: [createMockServerEntry('server1', 'Test 1', '1.0.0', true)],
        metadata: { nextCursor: 'cursor123' },
      };
      const page2 = {
        servers: [createMockServerEntry('server2', 'Test 2', '2.0.0', true)],
        metadata: {},
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(callCount === 1 ? page1 : page2),
        });
      });

      const client = new RegistryClient();
      const servers = await client.listServers();

      expect(servers).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle empty server list', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ servers: [] }),
      });

      const client = new RegistryClient();
      const servers = await client.listServers();

      expect(servers).toEqual([]);
    });

    it('should throw RegistryError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const client = new RegistryClient();
      await expect(client.listServers()).rejects.toThrow(RegistryError);
    });

    it('should throw RegistryError on HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const client = new RegistryClient();
      await expect(client.listServers()).rejects.toThrow(RegistryError);
    });
  });

  describe('searchServers', () => {
    it('should return servers from server-side search (official source)', async () => {
      // With server-side search, the API returns already-filtered results
      const mockSearchResponse = {
        servers: [
          createMockServerEntry('ai.time/time-server', 'Time utilities', '1.0.0'),
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      const client = new RegistryClient();
      const results = await client.searchServers('time');

      // Verify search parameter was used in request
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=time'),
        expect.any(Object)
      );
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('ai.time/time-server');
    });

    it('should fallback to client-side filter when server-side search fails', async () => {
      // First call (server-side search) fails, second call (listServers) succeeds
      const mockListResponse = {
        servers: [
          createMockServerEntry('server1', 'Provides time utilities', '1.0.0'),
          createMockServerEntry('server2', 'File operations', '1.0.0'),
        ],
      };

      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Search API error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        });

      const client = new RegistryClient();
      const results = await client.searchServers('time');

      // Fallback to client-side filter: should find 'time' in description
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('server1');
    });

    it('should be case-insensitive', async () => {
      const mockResponse = {
        servers: [createMockServerEntry('TimeServer', 'TIME utilities', '1.0.0')],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new RegistryClient();
      const results = await client.searchServers('time');

      expect(results).toHaveLength(1);
    });
  });

  describe('getServer', () => {
    it('should return server by exact name match', async () => {
      const mockResponse = {
        servers: [
          createMockServerEntry('ai.test/test-server', 'Test server', '1.0.0'),
          createMockServerEntry('ai.other/other', 'Other', '1.0.0'),
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new RegistryClient();
      const server = await client.getServer('ai.test/test-server');

      expect(server?.name).toBe('ai.test/test-server');
    });

    it('should return server by suffix match', async () => {
      const mockResponse = {
        servers: [
          createMockServerEntry('ai.exa/exa', 'Exa server', '1.0.0'),
          createMockServerEntry('ai.other/other', 'Other', '1.0.0'),
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new RegistryClient();
      const server = await client.getServer('exa');

      expect(server?.name).toBe('ai.exa/exa');
    });

    it('should return null for non-existent server', async () => {
      const mockResponse = {
        servers: [createMockServerEntry('ai.test/test', 'Test', '1.0.0')],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new RegistryClient();
      const server = await client.getServer('non-existent');

      expect(server).toBeNull();
    });
  });

  describe('custom base URL', () => {
    it('should use custom base URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ servers: [] }),
      });

      const client = new RegistryClient({ baseUrl: 'https://custom.registry.io' });
      await client.listServers();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom.registry.io/servers',
        expect.any(Object)
      );
    });
  });

  describe('API key authentication', () => {
    it('should send Authorization header when apiKey is set', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ servers: [] }),
      });

      const client = new RegistryClient({
        baseUrl: 'https://registry.smithery.ai',
        apiKey: 'test-api-key-123',
      });
      await client.listServers();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://registry.smithery.ai/servers',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key-123',
          }),
        })
      );
    });

    it('should not send Authorization header when apiKey is not set', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ servers: [] }),
      });

      const client = new RegistryClient({
        baseUrl: 'https://registry.modelcontextprotocol.io/v0',
      });
      await client.listServers();

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });
  });
});

describe('field utilities', () => {
  describe('SUPPORTED_FIELDS', () => {
    it('should include expected fields', () => {
      expect(SUPPORTED_FIELDS).toContain('name');
      expect(SUPPORTED_FIELDS).toContain('description');
      expect(SUPPORTED_FIELDS).toContain('version');
      expect(SUPPORTED_FIELDS).toContain('versions');
      expect(SUPPORTED_FIELDS).toContain('repository');
      expect(SUPPORTED_FIELDS).toContain('homepage');
      expect(SUPPORTED_FIELDS).toContain('transport');
    });
  });

  describe('isSupportedField', () => {
    it('should return true for supported fields', () => {
      expect(isSupportedField('name')).toBe(true);
      expect(isSupportedField('version')).toBe(true);
    });

    it('should return false for unsupported fields', () => {
      expect(isSupportedField('unknown')).toBe(false);
      expect(isSupportedField('')).toBe(false);
    });
  });

  describe('getFieldValue', () => {
    it('should get field value from server', () => {
      const server: ServerInfo = {
        name: 'test',
        description: 'Test server',
        version: '1.0.0',
      };

      expect(getFieldValue(server, 'name')).toBe('test');
      expect(getFieldValue(server, 'description')).toBe('Test server');
      expect(getFieldValue(server, 'version')).toBe('1.0.0');
    });

    it('should return undefined for missing fields', () => {
      const server: ServerInfo = { name: 'test' };
      expect(getFieldValue(server, 'description')).toBeUndefined();
    });
  });

  describe('formatFieldValue', () => {
    it('should format string values', () => {
      expect(formatFieldValue('test')).toBe('test');
    });

    it('should format array values', () => {
      expect(formatFieldValue(['1.0', '2.0', '3.0'])).toBe('1.0, 2.0, 3.0');
    });

    it('should format object values as JSON', () => {
      const obj = { type: 'stdio', command: 'node' };
      expect(formatFieldValue(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it('should handle null/undefined', () => {
      expect(formatFieldValue(null)).toBe('(not set)');
      expect(formatFieldValue(undefined)).toBe('(not set)');
    });
  });
});
