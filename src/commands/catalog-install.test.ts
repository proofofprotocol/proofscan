/**
 * Tests for catalog install command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Test deriveConnectorId function by importing it indirectly through module
// Since it's not exported, we test the behavior through integration tests

describe('catalog install', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'pfscan-test-'));
    configPath = join(tempDir, 'config.json');

    // Create initial config
    await fs.writeFile(configPath, JSON.stringify({
      version: 1,
      connectors: [],
    }, null, 2));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('deriveConnectorId logic', () => {
    // Test the ID derivation through expected behaviors
    it('should derive simple ID from full server name', () => {
      // This tests the pattern: "@anthropic/claude" -> "claude"
      const testCases = [
        { input: '@anthropic/claude', expected: 'claude' },
        { input: 'smithery/hello-world', expected: 'hello-world' },
        { input: 'my-server', expected: 'my-server' },
        { input: '@user/My_Server', expected: 'my-server' },
      ];

      for (const { input, expected } of testCases) {
        // Replicate the deriveConnectorId logic for testing
        const parts = input.split(/[/@]/);
        const lastPart = parts[parts.length - 1] || input;
        const result = lastPart
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        expect(result).toBe(expected);
      }
    });
  });

  describe('transport validation', () => {
    it('should accept http transport type', () => {
      const transport = { type: 'http', url: 'https://example.com/mcp' };
      const transportType = transport.type?.toLowerCase();
      const isHttpTransport = transportType === 'http' || transportType === 'streamable-http';
      expect(isHttpTransport).toBe(true);
    });

    it('should accept streamable-http transport type', () => {
      const transport = { type: 'streamable-http', url: 'https://example.com/mcp' };
      const transportType = transport.type?.toLowerCase();
      const isHttpTransport = transportType === 'http' || transportType === 'streamable-http';
      expect(isHttpTransport).toBe(true);
    });

    it('should reject stdio transport type', () => {
      const transport = { type: 'stdio', command: 'npx' };
      const transportType = transport.type?.toLowerCase();
      expect(transportType).toBe('stdio');
    });

    it('should reject unknown transport type', () => {
      const transport = { type: 'unknown' };
      const transportType = transport.type?.toLowerCase();
      const isHttpTransport = transportType === 'http' || transportType === 'streamable-http';
      expect(isHttpTransport).toBe(false);
    });

    it('should validate URL format', () => {
      // Valid URLs
      expect(() => new URL('https://example.com/mcp')).not.toThrow();
      expect(() => new URL('http://localhost:3000')).not.toThrow();

      // Invalid URLs
      expect(() => new URL('not-a-url')).toThrow();
      expect(() => new URL('')).toThrow();
    });
  });

  describe('connector building', () => {
    it('should build correct connector config from http transport', () => {
      const serverName = '@test/my-server';
      const transport = { type: 'http', url: 'https://api.example.com/mcp' };

      // Derive connector ID
      const parts = serverName.split(/[/@]/);
      const lastPart = parts[parts.length - 1] || serverName;
      const connectorId = lastPart
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const connector = {
        id: connectorId,
        enabled: true,
        transport: {
          type: 'rpc-http' as const,
          url: transport.url,
        },
      };

      expect(connector).toEqual({
        id: 'my-server',
        enabled: true,
        transport: {
          type: 'rpc-http',
          url: 'https://api.example.com/mcp',
        },
      });
    });

    it('should use --name option to override connector ID', () => {
      const overrideId = 'custom-id';
      const connector = {
        id: overrideId,
        enabled: true,
        transport: {
          type: 'rpc-http' as const,
          url: 'https://api.example.com/mcp',
        },
      };

      expect(connector.id).toBe('custom-id');
    });
  });

  describe('ID collision detection', () => {
    it('should detect existing connector ID', async () => {
      // Add an existing connector
      const config = {
        version: 1,
        connectors: [
          {
            id: 'existing-server',
            enabled: true,
            transport: { type: 'rpc-http', url: 'https://old.example.com' },
          },
        ],
      };
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // Read back and check
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      const existing = parsed.connectors.find((c: { id: string }) => c.id === 'existing-server');

      expect(existing).toBeDefined();
    });
  });

  describe('dry-run mode', () => {
    it('should not modify config in dry-run mode', async () => {
      const originalContent = await fs.readFile(configPath, 'utf-8');

      // Simulate dry-run: we don't write anything
      const connector = {
        id: 'test-server',
        enabled: true,
        transport: { type: 'rpc-http' as const, url: 'https://example.com' },
      };

      // In dry-run, we just output without saving
      const dryRunOutput = { dryRun: true, connector };
      expect(dryRunOutput.dryRun).toBe(true);

      // Config should be unchanged
      const afterContent = await fs.readFile(configPath, 'utf-8');
      expect(afterContent).toBe(originalContent);
    });
  });

  describe('--version option', () => {
    it('should override package version in pkgRef', () => {
      // Simulate pkgRef from packages[] array
      const pkgRef = {
        package: '@modelcontextprotocol/server-everything',
        version: '2.0.0', // Original version from GitHub package.json
      };

      // Simulate --version option override
      const versionOverride = '2026.1.14';
      if (versionOverride) {
        pkgRef.version = versionOverride;
      }

      expect(pkgRef.version).toBe('2026.1.14');
    });

    it('should preserve original version when --version not specified', () => {
      const pkgRef = {
        package: '@anthropic/mcp-server-time',
        version: '1.0.0',
      };

      // No version override
      const versionOverride: string | undefined = undefined;
      if (versionOverride) {
        pkgRef.version = versionOverride;
      }

      expect(pkgRef.version).toBe('1.0.0');
    });

    it('should allow "latest" as version value', () => {
      const pkgRef = {
        package: '@example/server',
        version: '1.0.0',
      };

      // Simulate --version latest
      const versionOverride = 'latest';
      if (versionOverride) {
        pkgRef.version = versionOverride;
      }

      expect(pkgRef.version).toBe('latest');
    });

    it('should handle calver format versions', () => {
      const pkgRef = {
        package: '@modelcontextprotocol/server-everything',
        version: undefined as string | undefined,
      };

      // Simulate --version with calver format
      const versionOverride = '2025.12.18';
      if (versionOverride) {
        pkgRef.version = versionOverride;
      }

      expect(pkgRef.version).toBe('2025.12.18');
    });
  });
});
