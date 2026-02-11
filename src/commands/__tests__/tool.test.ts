/**
 * Tool Commands Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createToolCommand } from '../tool.js';
import { TargetsStore } from '../../db/targets-store.js';
import { ConfigManager } from '../../config/index.js';
import { getConnector } from '../../tools/adapter.js';

// Mock dependencies
vi.mock('../../db/targets-store.js');
vi.mock('../../a2a/client.js');
vi.mock('../../proxy/client.js');
vi.mock('../../config/index.js');
vi.mock('../../tools/adapter.js');

describe('tool command', () => {
  let program: Command;
  let mockConfigPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigPath = '/test/config';
    program = new Command();
    program.addCommand(createToolCommand(() => mockConfigPath));

    // Mock TargetsStore
    const mockStore = {
      list: vi.fn().mockReturnValue([]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

    // Mock ConfigManager
    const mockConfigManager = {
      getConfigDir: vi.fn().mockReturnValue('/test/config/dir'),
    };
    vi.mocked(ConfigManager).mockImplementation(() => mockConfigManager as unknown as ConfigManager);

    // Mock getConnector to return a valid connector
    const mockConnector = {
      id: 'mock-connector',
      type: 'mcp' as const,
      protocol: 'mcp' as const,
      name: 'Mock Connector',
      enabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      config: {
        command: 'mock',
        args: [],
      },
      callTool: vi.fn().mockResolvedValue({
        content: { result: 'ok' },
        success: true,
        isError: false,
      }),
    };
    vi.mocked(getConnector).mockResolvedValue(mockConnector as never);
  });

  describe('batch execution', () => {
    it('should accept valid JSON array of objects', async () => {
      // Spy console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      // This should not throw exit(1)
      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[{"arg1": "value1"}, {"arg2": "value2"}]',
          '--skip-validation',
        ]);
      } catch (e) {
        // Exit with non-1 code might be thrown
        if ((e as Error).message !== 'exit called with code 0') {
          throw e;
        }
      }

      // Should not have called exit(1)
      expect(processExitSpy).not.toHaveBeenCalledWith(1);

      consoleSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject empty batch array', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: --batch requires at least one item');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject non-object elements (strings)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '["not-an-object"]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Batch item 1 must be an object, got string');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject non-object elements (numbers)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[123]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Batch item 1 must be an object, got number');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject null elements', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[null]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Batch item 1 must be an object, got object');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject array elements (nested arrays)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[[1, 2, 3]]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Batch item 1 must be an object, got array');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject mixed type elements', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[{"arg": "valid"}, "invalid", 123]',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Batch item 2 must be an object, got string');

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject non-JSON input', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', 'not-json-at-all',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON in --batch')
      );

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should reject non-array JSON', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '{"not": "an-array"}',
          '--skip-validation',
        ])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--batch must be a JSON array')
      );

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });
  });
});
