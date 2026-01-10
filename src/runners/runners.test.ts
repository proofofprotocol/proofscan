/**
 * Runner subsystem tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import type { RunnerStatus } from './types.js';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe('runners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to get fresh imports with mocked execSync
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('NpxRunner', () => {
    describe('detect', () => {
      it('should return available when npx is found', async () => {
        mockedExecSync
          .mockReturnValueOnce('/usr/local/bin/npx\n') // which
          .mockReturnValueOnce('10.2.0\n'); // --version

        const { npxRunner } = await import('./npx.js');
        const status = await npxRunner.detect();

        expect(status.available).toBe(true);
        expect(status.name).toBe('npx');
        expect(status.version).toBe('10.2.0');
        expect(status.path).toBe('/usr/local/bin/npx');
      });

      it('should handle Windows multi-line where output', async () => {
        mockedExecSync
          .mockReturnValueOnce('C:\\Program Files\\nodejs\\npx.cmd\nC:\\Users\\user\\AppData\\npx.cmd\n')
          .mockReturnValueOnce('10.0.0\n');

        const { npxRunner } = await import('./npx.js');
        const status = await npxRunner.detect();

        expect(status.available).toBe(true);
        expect(status.path).toBe('C:\\Program Files\\nodejs\\npx.cmd');
      });

      it('should return available even if version check fails', async () => {
        mockedExecSync
          .mockReturnValueOnce('/usr/bin/npx\n') // which succeeds
          .mockImplementationOnce(() => {
            // --version fails
            throw new Error('version error');
          });

        const { npxRunner } = await import('./npx.js');
        const status = await npxRunner.detect();

        expect(status.available).toBe(true);
        expect(status.version).toBeUndefined();
      });

      it('should return not available when npx is not found', async () => {
        mockedExecSync.mockImplementation(() => {
          throw new Error('not found');
        });

        const { npxRunner } = await import('./npx.js');
        const status = await npxRunner.detect();

        expect(status.available).toBe(false);
        expect(status.name).toBe('npx');
        expect(status.error).toBeDefined();
      });
    });

    describe('materialize', () => {
      it('should generate correct command for package without version', async () => {
        const { npxRunner } = await import('./npx.js');
        const result = npxRunner.materialize({ package: '@org/pkg' });

        expect(result.command).toBe('npx');
        expect(result.args).toEqual(['-y', '@org/pkg']);
        expect(result.env).toBeUndefined();
      });

      it('should generate correct command for package with version', async () => {
        const { npxRunner } = await import('./npx.js');
        const result = npxRunner.materialize({
          package: '@org/pkg',
          version: '1.0.0',
        });

        expect(result.command).toBe('npx');
        expect(result.args).toEqual(['-y', '@org/pkg@1.0.0']);
      });

      it('should include env if provided', async () => {
        const { npxRunner } = await import('./npx.js');
        const result = npxRunner.materialize({ package: 'pkg' }, { API_KEY: 'secret' });

        expect(result.env).toEqual({ API_KEY: 'secret' });
      });

      it('should not include env if empty object', async () => {
        const { npxRunner } = await import('./npx.js');
        const result = npxRunner.materialize({ package: 'pkg' }, {});

        expect(result.env).toBeUndefined();
      });
    });
  });

  describe('UvxRunner', () => {
    describe('detect', () => {
      it('should return available when uvx is found', async () => {
        mockedExecSync
          .mockReturnValueOnce('/home/user/.local/bin/uvx\n')
          .mockReturnValueOnce('uvx 0.5.0\n');

        const { uvxRunner } = await import('./uvx.js');
        const status = await uvxRunner.detect();

        expect(status.available).toBe(true);
        expect(status.name).toBe('uvx');
        expect(status.version).toBe('uvx 0.5.0');
        expect(status.path).toBe('/home/user/.local/bin/uvx');
      });

      it('should return not available when uvx is not found', async () => {
        mockedExecSync.mockImplementation(() => {
          throw new Error('not found');
        });

        const { uvxRunner } = await import('./uvx.js');
        const status = await uvxRunner.detect();

        expect(status.available).toBe(false);
        expect(status.name).toBe('uvx');
      });
    });

    describe('materialize', () => {
      it('should generate correct command for package without version', async () => {
        const { uvxRunner } = await import('./uvx.js');
        const result = uvxRunner.materialize({ package: 'mcp-server' });

        expect(result.command).toBe('uvx');
        expect(result.args).toEqual(['mcp-server']);
      });

      it('should generate correct command for package with version (Python style)', async () => {
        const { uvxRunner } = await import('./uvx.js');
        const result = uvxRunner.materialize({
          package: 'mcp-server',
          version: '1.0.0',
        });

        expect(result.command).toBe('uvx');
        expect(result.args).toEqual(['mcp-server==1.0.0']);
      });
    });
  });

  describe('parsePackageRef', () => {
    it('should parse npx format with -y flag', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      });

      expect(result).toEqual({
        package: '@modelcontextprotocol/server-filesystem',
      });
    });

    it('should parse npx format with --yes flag', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'npx',
        args: ['--yes', 'some-package'],
      });

      expect(result).toEqual({
        package: 'some-package',
      });
    });

    it('should parse scoped package@version format', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'npx',
        args: ['-y', '@org/pkg@1.2.3'],
      });

      expect(result).toEqual({
        package: '@org/pkg',
        version: '1.2.3',
      });
    });

    it('should parse unscoped package@version format', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'npx',
        args: ['-y', 'lodash@4.17.21'],
      });

      expect(result).toEqual({
        package: 'lodash',
        version: '4.17.21',
      });
    });

    it('should parse uvx format', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'uvx',
        args: ['mcp-server'],
      });

      expect(result).toEqual({
        package: 'mcp-server',
      });
    });

    it('should parse uvx format with Python version specifier', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'uvx',
        args: ['mcp-server==1.0.0'],
      });

      expect(result).toEqual({
        package: 'mcp-server',
        version: '1.0.0',
      });
    });

    it('should handle uv command (alias for uvx)', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'uv',
        args: ['some-package'],
      });

      expect(result).toEqual({
        package: 'some-package',
      });
    });

    it('should return null for non-runner commands', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'node',
        args: ['./server.js'],
      });

      expect(result).toBeNull();
    });

    it('should return null for empty args', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'npx',
        args: [],
      });

      expect(result).toBeNull();
    });

    it('should return null for missing command', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        args: ['package'],
      });

      expect(result).toBeNull();
    });

    it('should handle case-insensitive command names', async () => {
      const { parsePackageRef } = await import('./index.js');
      const result = parsePackageRef({
        command: 'NPX',
        args: ['-y', 'package'],
      });

      expect(result).toEqual({
        package: 'package',
      });
    });
  });

  describe('getRunner', () => {
    it('should return npx runner for "npx"', async () => {
      const { getRunner } = await import('./index.js');
      const runner = getRunner('npx');
      expect(runner.name).toBe('npx');
    });

    it('should return uvx runner for "uvx"', async () => {
      const { getRunner } = await import('./index.js');
      const runner = getRunner('uvx');
      expect(runner.name).toBe('uvx');
    });

    it('should throw for unknown runner', async () => {
      const { getRunner } = await import('./index.js');
      expect(() => getRunner('unknown' as any)).toThrow('Unknown runner: unknown');
    });
  });

  describe('listRunnerNames', () => {
    it('should return all runner names', async () => {
      const { listRunnerNames } = await import('./index.js');
      const names = listRunnerNames();
      expect(names).toEqual(['npx', 'uvx']);
    });
  });

  describe('detectAll', () => {
    it('should detect all runners', async () => {
      mockedExecSync
        .mockReturnValueOnce('/usr/bin/npx\n') // npx which
        .mockReturnValueOnce('10.0.0\n') // npx version
        .mockReturnValueOnce('/usr/bin/uvx\n') // uvx which
        .mockReturnValueOnce('0.5.0\n'); // uvx version

      const { detectAll } = await import('./index.js');
      const results = await detectAll();

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('npx');
      expect(results[1].name).toBe('uvx');
    });
  });

  describe('findAvailableRunner', () => {
    it('should return npx first if both available', async () => {
      mockedExecSync.mockReturnValue('/usr/bin/npx\n');

      const { findAvailableRunner } = await import('./index.js');
      const runner = await findAvailableRunner();

      expect(runner?.name).toBe('npx');
    });

    it('should return uvx if npx not available', async () => {
      let callCount = 0;
      mockedExecSync.mockImplementation(() => {
        callCount++;
        // First two calls are for npx (which + version) - fail
        if (callCount <= 1) {
          throw new Error('not found');
        }
        // Next calls are for uvx - succeed
        return '/usr/bin/uvx\n';
      });

      const { findAvailableRunner } = await import('./index.js');
      const runner = await findAvailableRunner();

      expect(runner?.name).toBe('uvx');
    });

    it('should return null if no runners available', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const { findAvailableRunner } = await import('./index.js');
      const runner = await findAvailableRunner();

      expect(runner).toBeNull();
    });
  });

  describe('sanitizeEnv', () => {
    it('should return undefined for undefined input', async () => {
      const { sanitizeEnv } = await import('./index.js');
      expect(sanitizeEnv(undefined)).toBeUndefined();
    });

    it('should return undefined for empty object', async () => {
      const { sanitizeEnv } = await import('./index.js');
      expect(sanitizeEnv({})).toBeUndefined();
    });

    it('should pass through valid environment variables', async () => {
      const { sanitizeEnv } = await import('./index.js');
      const result = sanitizeEnv({
        API_KEY: 'secret123',
        DATABASE_URL: 'postgres://localhost',
        _PRIVATE: 'value',
      });
      expect(result).toEqual({
        API_KEY: 'secret123',
        DATABASE_URL: 'postgres://localhost',
        _PRIVATE: 'value',
      });
    });

    it('should filter out invalid key names', async () => {
      const { sanitizeEnv } = await import('./index.js');
      const result = sanitizeEnv({
        'VALID_KEY': 'value1',
        '123_INVALID': 'value2', // starts with number
        'INVALID-KEY': 'value3', // contains hyphen
        'INVALID.KEY': 'value4', // contains dot
        'ANOTHER_VALID': 'value5',
      });
      expect(result).toEqual({
        VALID_KEY: 'value1',
        ANOTHER_VALID: 'value5',
      });
    });

    it('should filter out non-string values', async () => {
      const { sanitizeEnv } = await import('./index.js');
      const result = sanitizeEnv({
        STRING_VAL: 'value',
        NUMBER_VAL: 123 as any,
        BOOL_VAL: true as any,
        NULL_VAL: null as any,
      });
      expect(result).toEqual({
        STRING_VAL: 'value',
      });
    });

    it('should filter out overly long values', async () => {
      const { sanitizeEnv } = await import('./index.js');
      const longValue = 'x'.repeat(40000); // > 32768
      const result = sanitizeEnv({
        SHORT: 'ok',
        LONG: longValue,
      });
      expect(result).toEqual({
        SHORT: 'ok',
      });
    });
  });
});
