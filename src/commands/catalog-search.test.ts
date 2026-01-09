/**
 * Tests for catalog search command transport filter
 */

import { describe, it, expect } from 'vitest';

// Test the filter logic that's used in catalog search

/** Valid transport types (replicating from catalog.ts) */
const VALID_TRANSPORT_TYPES = ['http', 'streamable-http', 'sse', 'stdio'] as const;

describe('catalog search transport filter', () => {
  // Mock ServerInfo type
  interface MockServer {
    name: string;
    description?: string;
    transport?: {
      type?: string;
      url?: string;
    };
  }

  /**
   * Check if transport type is valid (replicating from catalog.ts)
   */
  function isValidTransportType(type: string): boolean {
    return (VALID_TRANSPORT_TYPES as readonly string[]).includes(type.toLowerCase());
  }

  /**
   * Filter servers by transport type (replicating the logic from catalog.ts)
   */
  function filterByTransport(servers: MockServer[], transportType: string): MockServer[] {
    const normalizedType = transportType.toLowerCase();
    return servers.filter((server) => {
      const serverTransport = server.transport?.type?.toLowerCase();
      if (!serverTransport) {
        return false;
      }
      return serverTransport === normalizedType;
    });
  }

  /**
   * Get transport badge (replicating the logic from catalog.ts)
   */
  function getTransportBadge(server: MockServer): string {
    const type = server.transport?.type?.toLowerCase();
    if (!type) {
      return '';
    }
    if (type === 'streamable-http') {
      return '[s-http]';
    }
    return `[${type}]`;
  }

  describe('filterByTransport', () => {
    const mockServers: MockServer[] = [
      { name: 'server-http', transport: { type: 'http', url: 'https://a.com' } },
      { name: 'server-streamable', transport: { type: 'streamable-http', url: 'https://b.com' } },
      { name: 'server-stdio', transport: { type: 'stdio' } },
      { name: 'server-sse', transport: { type: 'sse', url: 'https://c.com' } },
      { name: 'server-no-transport' },
      { name: 'server-empty-type', transport: {} },
      { name: 'server-null-type', transport: { type: undefined } },
    ];

    it('should filter to only http servers', () => {
      const result = filterByTransport(mockServers, 'http');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-http');
    });

    it('should filter to only streamable-http servers', () => {
      const result = filterByTransport(mockServers, 'streamable-http');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-streamable');
    });

    it('should filter to only stdio servers', () => {
      const result = filterByTransport(mockServers, 'stdio');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-stdio');
    });

    it('should filter to only sse servers', () => {
      const result = filterByTransport(mockServers, 'sse');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-sse');
    });

    it('should be case-insensitive', () => {
      const result = filterByTransport(mockServers, 'HTTP');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server-http');

      const result2 = filterByTransport(mockServers, 'Streamable-HTTP');
      expect(result2).toHaveLength(1);
      expect(result2[0].name).toBe('server-streamable');
    });

    it('should exclude servers without transport', () => {
      const result = filterByTransport(mockServers, 'http');
      const names = result.map((s) => s.name);
      expect(names).not.toContain('server-no-transport');
      expect(names).not.toContain('server-empty-type');
      expect(names).not.toContain('server-null-type');
    });

    it('should return empty array for unknown transport type', () => {
      const result = filterByTransport(mockServers, 'unknown');
      expect(result).toHaveLength(0);
    });

    it('should return empty array when no servers match', () => {
      const servers: MockServer[] = [
        { name: 'a', transport: { type: 'stdio' } },
        { name: 'b', transport: { type: 'stdio' } },
      ];
      const result = filterByTransport(servers, 'http');
      expect(result).toHaveLength(0);
    });
  });

  describe('getTransportBadge', () => {
    it('should return [http] for http transport', () => {
      const server: MockServer = { name: 'test', transport: { type: 'http' } };
      expect(getTransportBadge(server)).toBe('[http]');
    });

    it('should return [s-http] for streamable-http transport', () => {
      const server: MockServer = { name: 'test', transport: { type: 'streamable-http' } };
      expect(getTransportBadge(server)).toBe('[s-http]');
    });

    it('should return [stdio] for stdio transport', () => {
      const server: MockServer = { name: 'test', transport: { type: 'stdio' } };
      expect(getTransportBadge(server)).toBe('[stdio]');
    });

    it('should return [sse] for sse transport', () => {
      const server: MockServer = { name: 'test', transport: { type: 'sse' } };
      expect(getTransportBadge(server)).toBe('[sse]');
    });

    it('should return empty string for no transport', () => {
      const server: MockServer = { name: 'test' };
      expect(getTransportBadge(server)).toBe('');
    });

    it('should return empty string for transport without type', () => {
      const server: MockServer = { name: 'test', transport: {} };
      expect(getTransportBadge(server)).toBe('');
    });

    it('should handle case-insensitive type', () => {
      const server: MockServer = { name: 'test', transport: { type: 'HTTP' } };
      expect(getTransportBadge(server)).toBe('[http]');

      const server2: MockServer = { name: 'test', transport: { type: 'STREAMABLE-HTTP' } };
      expect(getTransportBadge(server2)).toBe('[s-http]');
    });
  });

  describe('isValidTransportType', () => {
    it('should accept valid transport types', () => {
      expect(isValidTransportType('http')).toBe(true);
      expect(isValidTransportType('streamable-http')).toBe(true);
      expect(isValidTransportType('sse')).toBe(true);
      expect(isValidTransportType('stdio')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isValidTransportType('HTTP')).toBe(true);
      expect(isValidTransportType('Streamable-HTTP')).toBe(true);
      expect(isValidTransportType('SSE')).toBe(true);
      expect(isValidTransportType('STDIO')).toBe(true);
    });

    it('should reject invalid transport types', () => {
      expect(isValidTransportType('invalid')).toBe(false);
      expect(isValidTransportType('websocket')).toBe(false);
      expect(isValidTransportType('grpc')).toBe(false);
      expect(isValidTransportType('')).toBe(false);
    });
  });
});
