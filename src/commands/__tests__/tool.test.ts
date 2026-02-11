/**
 * Tool Commands Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createToolCommand } from '../tool.js';
import { TargetsStore } from '../../db/targets-store.js';
import { ConfigManager } from '../../config/index.js';
import { getConnector, callTool, type ToolCallResult } from '../../tools/adapter.js';

// Mock dependencies
vi.mock('../../db/targets-store.js');
vi.mock('../../a2a/client.js');
vi.mock('../../proxy/client.js');
vi.mock('../../config/index.js');
vi.mock('../../tools/adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/adapter.js')>('../../tools/adapter.js');
  return {
    ...actual,
    callTool: vi.fn(),
    getConnector: vi.fn(),
  };
});

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
      transport: {
        type: 'stdio' as const,
        command: 'mock',
        args: [],
      },
    };
    vi.mocked(getConnector).mockResolvedValue(mockConnector as never);

    // Mock callTool to return a successful result
    const mockCallResult: ToolCallResult = {
      success: true,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      sessionId: 'test-session-id',
    };
    vi.mocked(callTool).mockResolvedValue(mockCallResult);
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

  // Integration tests for output format with command execution
  describe('output format', () => {
    it('should output compact format (single-line JSON)', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      let caughtError: Error | null = null;
      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--args', '{"test": "value"}',
          '--output', 'compact',
          '--skip-validation',
        ]);
      } catch (e) {
        caughtError = e as Error;
      }

      // Debug: show what happened
      if (!consoleLogSpy.mock.calls.length) {
        console.log('DEBUG - Error calls:', consoleErrorSpy.mock.calls);
        console.log('DEBUG - Caught error:', caughtError?.message);
      }

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      // Compact format should be single line (no newline character)
      expect(output).not.toContain('\n');
      expect(output).toContain('"success":true');

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should output value format (extract result only)', async () => {
      // This test is for the output format functionality
      // In actual execution, --output value extracts result field
      // Since we're using mocks, we just verify the option is accepted
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--args', '{"test": "value"}',
          '--output', 'value',
          '--skip-validation',
        ]);
      } catch (e) {
        // exit may be called
      }

      // Verify command accepted the --output value option
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should output json format (default, formatted JSON)', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--args', '{"test": "value"}',
          '--output', 'json',
          '--skip-validation',
        ]);
      } catch (e) {
        // exit may be called
      }

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      // JSON format should have newlines for formatting
      expect(output).toContain('\n');
      expect(output).toContain('"success": true');

      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should accept table format option', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--args', '{"test": "value"}',
          '--output', 'table',
          '--skip-validation',
        ]);
      } catch (e) {
        // exit may be called
      }

      // Verify command accepted the --output table option
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should output compact format for batch results', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit called with code ${code}`);
      });

      try {
        await program.parseAsync([
          'node', 'test', 'tool', 'call', 'mock-connector', 'mock-tool',
          '--batch', '[{"test": "value1"}, {"test": "value2"}]',
          '--skip-validation',
          '--output', 'compact',
          
        ]);
      } catch (e) {
        // exit may be called
      }

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      // Compact format should be single line
      expect(output).not.toContain('\n');
      expect(output).toContain('"batch":true');

      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });
  });

  // Unit tests for formatOutput and formatAsTable functions
  describe('formatOutput function', () => {
    // Import directly for unit testing
    let formatOutput: typeof import('../tool.js').formatOutput;

    beforeEach(async () => {
      const module = await import('../tool.js');
      formatOutput = module.formatOutput;
    });

    it('should format json with indentation', () => {
      const result = formatOutput({ foo: 'bar' }, 'json');
      expect(result).toBe(JSON.stringify({ foo: 'bar' }, null, 2));
      expect(result).toContain('\n');
    });

    it('should format compact as single line', () => {
      const result = formatOutput({ foo: 'bar' }, 'compact');
      expect(result).toBe('{"foo":"bar"}');
      expect(result).not.toContain('\n');
    });

    it('should extract content for value format', () => {
      const data = { content: [{ type: 'text', text: 'hello' }], sessionId: 'test' };
      const result = formatOutput(data, 'value');
      expect(result).toContain('hello');
      expect(result).not.toContain('sessionId');
    });

    it('should extract results for value format with batch data', () => {
      const data = {
        batch: true,
        results: [
          { args: { a: 1 }, result: 'result1', ok: true },
          { args: { a: 2 }, result: 'result2', ok: true },
        ],
      };
      const result = formatOutput(data, 'value');
      expect(result).toContain('result1');
      expect(result).toContain('result2');
      expect(result).not.toContain('args');
    });

    it('should fallback to json for table format with non-array', () => {
      const result = formatOutput({ foo: 'bar' }, 'table');
      expect(result).toBe(JSON.stringify({ foo: 'bar' }, null, 2));
    });

    it('should use default json format for unknown format', () => {
      const result = formatOutput({ foo: 'bar' }, 'unknown');
      expect(result).toBe(JSON.stringify({ foo: 'bar' }, null, 2));
    });
  });

  describe('formatAsTable function', () => {
    let formatAsTable: typeof import('../tool.js').formatAsTable;

    beforeEach(async () => {
      const module = await import('../tool.js');
      formatAsTable = module.formatAsTable;
    });

    it('should format homogeneous array as tab-separated table', () => {
      const data = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
      const result = formatAsTable(data);
      expect(result).toBe('a\tb\n1\t2\n3\t4');
    });

    it('should handle heterogeneous objects by collecting all keys', () => {
      const data = [{ a: 1 }, { b: 2 }, { a: 3, b: 4 }];
      const result = formatAsTable(data);
      // Should have both keys
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('should fallback to JSON for empty array', () => {
      const result = formatAsTable([]);
      expect(result).toBe('[]');
    });

    it('should fallback to JSON for non-object elements', () => {
      const data = ['string', 123] as unknown as object[];
      const result = formatAsTable(data);
      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    it('should handle null/undefined values as empty strings', () => {
      const data = [{ a: null, b: undefined, c: 'value' }];
      const result = formatAsTable(data);
      expect(result).toContain('value');
      // null/undefined become empty string
      expect(result.split('\n')[1]).toContain('\t\t');
    });
  });
});
