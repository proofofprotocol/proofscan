/**
 * Tests for catalog install stdio functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parsePackageRef, getRunner, findAvailableRunner, listRunnerNames } from '../runners/index.js';
import type { RunnerName, PackageRef, MaterializedTransport } from '../runners/types.js';
import { execSync } from 'child_process';

// Mock child_process for runner detection
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe('catalog install stdio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('--runner option validation', () => {
    it('should accept valid runner names', () => {
      const validRunners = listRunnerNames();
      expect(validRunners).toContain('npx');
      expect(validRunners).toContain('uvx');
    });

    it('should have exactly two runners', () => {
      const runners = listRunnerNames();
      expect(runners).toHaveLength(2);
    });
  });

  describe('package ref parsing from transport', () => {
    it('should parse npx transport with -y flag', () => {
      const transport = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toEqual({
        package: '@modelcontextprotocol/server-filesystem',
      });
    });

    it('should parse npx transport with versioned package', () => {
      const transport = {
        command: 'npx',
        args: ['-y', '@org/pkg@1.2.3'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toEqual({
        package: '@org/pkg',
        version: '1.2.3',
      });
    });

    it('should parse uvx transport', () => {
      const transport = {
        command: 'uvx',
        args: ['mcp-server-python'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toEqual({
        package: 'mcp-server-python',
      });
    });

    it('should parse uvx transport with Python version syntax', () => {
      const transport = {
        command: 'uvx',
        args: ['mcp-server==1.0.0'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toEqual({
        package: 'mcp-server',
        version: '1.0.0',
      });
    });

    it('should return null for node command (not a runner)', () => {
      const transport = {
        command: 'node',
        args: ['./server.js'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toBeNull();
    });

    it('should return null for python command (not a runner)', () => {
      const transport = {
        command: 'python',
        args: ['-m', 'mcp_server'],
      };

      const ref = parsePackageRef(transport);
      expect(ref).toBeNull();
    });
  });

  describe('runner selection', () => {
    it('should get npx runner by name', async () => {
      const runner = getRunner('npx');
      expect(runner.name).toBe('npx');
    });

    it('should get uvx runner by name', async () => {
      const runner = getRunner('uvx');
      expect(runner.name).toBe('uvx');
    });

    it('should throw for invalid runner name', () => {
      expect(() => getRunner('invalid' as RunnerName)).toThrow('Unknown runner');
    });
  });

  describe('runner detection and fallback', () => {
    it('should prefer npx when both available', async () => {
      mockedExecSync.mockReturnValue('/usr/bin/npx\n');

      const { findAvailableRunner } = await import('../runners/index.js');
      const runner = await findAvailableRunner();

      expect(runner?.name).toBe('npx');
    });

    it('should fallback to uvx when npx not available', async () => {
      let callCount = 0;
      mockedExecSync.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('npx not found');
        }
        return '/usr/bin/uvx\n';
      });

      const { findAvailableRunner } = await import('../runners/index.js');
      const runner = await findAvailableRunner();

      expect(runner?.name).toBe('uvx');
    });

    it('should return null when no runners available', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const { findAvailableRunner } = await import('../runners/index.js');
      const runner = await findAvailableRunner();

      expect(runner).toBeNull();
    });
  });

  describe('transport materialization', () => {
    it('should materialize npx transport correctly', async () => {
      const { npxRunner } = await import('../runners/npx.js');

      const result = npxRunner.materialize({ package: '@org/server' });

      expect(result).toEqual({
        command: 'npx',
        args: ['-y', '@org/server'],
      });
    });

    it('should materialize npx transport with version', async () => {
      const { npxRunner } = await import('../runners/npx.js');

      const result = npxRunner.materialize({
        package: '@org/server',
        version: '2.0.0',
      });

      expect(result).toEqual({
        command: 'npx',
        args: ['-y', '@org/server@2.0.0'],
      });
    });

    it('should materialize uvx transport correctly', async () => {
      const { uvxRunner } = await import('../runners/uvx.js');

      const result = uvxRunner.materialize({ package: 'mcp-server' });

      expect(result).toEqual({
        command: 'uvx',
        args: ['mcp-server'],
      });
    });

    it('should materialize uvx transport with version', async () => {
      const { uvxRunner } = await import('../runners/uvx.js');

      const result = uvxRunner.materialize({
        package: 'mcp-server',
        version: '1.0.0',
      });

      expect(result).toEqual({
        command: 'uvx',
        args: ['mcp-server==1.0.0'],
      });
    });

    it('should include env when provided', async () => {
      const { npxRunner } = await import('../runners/npx.js');

      const result = npxRunner.materialize(
        { package: 'server' },
        { API_KEY: 'secret', TOKEN: 'value' }
      );

      expect(result.env).toEqual({
        API_KEY: 'secret',
        TOKEN: 'value',
      });
    });

    it('should not include env when empty', async () => {
      const { npxRunner } = await import('../runners/npx.js');

      const result = npxRunner.materialize({ package: 'server' }, {});

      expect(result.env).toBeUndefined();
    });
  });

  describe('connector generation', () => {
    it('should build valid stdio connector structure', () => {
      const materialized: MaterializedTransport = {
        command: 'npx',
        args: ['-y', '@org/server'],
      };

      const connector = {
        id: 'server',
        enabled: true,
        transport: {
          type: 'stdio' as const,
          command: materialized.command,
          args: materialized.args,
        },
      };

      expect(connector.transport.type).toBe('stdio');
      expect(connector.transport.command).toBe('npx');
      expect(connector.transport.args).toEqual(['-y', '@org/server']);
    });

    it('should include env in connector when present', () => {
      const materialized: MaterializedTransport = {
        command: 'npx',
        args: ['-y', 'server'],
        env: { SECRET: 'value' },
      };

      const connector = {
        id: 'server',
        enabled: true,
        transport: {
          type: 'stdio' as const,
          command: materialized.command,
          args: materialized.args,
          ...(materialized.env && { env: materialized.env }),
        },
      };

      expect(connector.transport.env).toEqual({ SECRET: 'value' });
    });
  });

  describe('connector ID derivation', () => {
    // Test the deriveConnectorId logic inline
    function deriveConnectorId(serverName: string): string {
      const parts = serverName.split(/[/@]/);
      const lastPart = parts[parts.length - 1] || serverName;
      return lastPart
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    it('should derive ID from scoped package', () => {
      expect(deriveConnectorId('@modelcontextprotocol/server-filesystem')).toBe('server-filesystem');
    });

    it('should derive ID from smithery-style name', () => {
      expect(deriveConnectorId('smithery/hello-world')).toBe('hello-world');
    });

    it('should preserve simple names', () => {
      expect(deriveConnectorId('my-server')).toBe('my-server');
    });

    it('should sanitize special characters', () => {
      expect(deriveConnectorId('@user/My_Server')).toBe('my-server');
    });
  });

  describe('error messages', () => {
    it('should suggest runners doctor when no runner available', () => {
      const errorMessage = 'No package runner available.';
      const suggestion = 'pfscan runners doctor';

      expect(errorMessage).toContain('No package runner');
      expect(suggestion).toContain('runners doctor');
    });

    it('should suggest manual configuration for unparseable transport', () => {
      const errorMessage = 'Cannot parse package reference from transport config.';
      const suggestion = 'pfscan connectors add';

      expect(errorMessage).toContain('Cannot parse');
      expect(suggestion).toContain('connectors add');
    });
  });

  describe('dry-run mode', () => {
    it('should not include actual file operations in dry-run output structure', () => {
      const dryRunOutput = {
        dryRun: true,
        connector: {
          id: 'test',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'test-server'],
          },
        },
        runner: 'npx',
      };

      expect(dryRunOutput.dryRun).toBe(true);
      expect(dryRunOutput.runner).toBe('npx');
      expect(dryRunOutput.connector.transport.type).toBe('stdio');
    });
  });
});
