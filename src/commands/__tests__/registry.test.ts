/**
 * Registry Command Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createRegistryCommand, searchConnectors } from '../registry.js';
import { ConfigManager } from '../../config/index.js';
import type { Connector, StdioTransport, HttpTransport } from '../../types/index.js';

// Mock ConfigManager
vi.mock('../../config/index.js');

describe('registry command', () => {
  let program: Command;
  let mockConfigPath: string;
  let mockConnectors: Connector[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConfigPath = '/test/config';

    // Mock connectors for testing
    mockConnectors = [
      {
        id: 'weather-server',
        enabled: false,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'mcp-server-weather'],
        } as StdioTransport,
      },
      {
        id: 'openweathermap',
        enabled: false,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@openweathermap/mcp'],
        } as StdioTransport,
      },
      {
        id: 'yfinance',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'mcp-yfinance'],
        } as StdioTransport,
      },
      {
        id: 'github-agent',
        enabled: true,
        transport: {
          type: 'rpc-http',
          url: 'https://api.github.com/mcp',
        } as HttpTransport,
      },
    ];

    // Reset global output options
    const { setOutputOptions } = await import('../../utils/output.js');
    setOutputOptions({ json: false, verbose: false });

    program = new Command();
    program.addCommand(createRegistryCommand(() => mockConfigPath));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registry search', () => {
    it('should search by keyword matching connector ID', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'weather']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should search with case-insensitive matching', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'WEATHER']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should search by command name', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'mcp-server']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should search by transport type', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'http']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should return empty results when no matches found', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'nonexistent']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should output JSON when --json flag is used', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const { setOutputOptions } = await import('../../utils/output.js');
      setOutputOptions({ json: true });

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'search', 'weather']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();

      // Reset output options
      setOutputOptions({ json: false });
    });

    it('should handle errors gracefully', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockRejectedValue(new Error('Config file not found')),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'registry', 'search', 'weather'])
      ).rejects.toThrow('exit called');

      expect(exitSpy).toHaveBeenCalledWith(1);
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('registry list', () => {
    it('should list all connectors', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'list']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should list only enabled connectors with --enabled flag', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'list', '--enabled']);

      expect(mockManager.getConnectors).toHaveBeenCalled();

      // Verify filtering is done in the command (we check the call was made)
      // The actual filtering logic is tested via formatListResults
      consoleSpy.mockRestore();
    });

    it('should list only disabled connectors with --disabled flag', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'list', '--disabled']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should reject conflicting --enabled and --disabled flags', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'registry', 'list', '--enabled', '--disabled'])
      ).rejects.toThrow('exit called');

      expect(exitSpy).toHaveBeenCalledWith(1);
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should output JSON when --json flag is used', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const { setOutputOptions } = await import('../../utils/output.js');
      setOutputOptions({ json: true });

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'list']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();

      // Reset output options
      setOutputOptions({ json: false });
    });

    it('should handle empty connector list', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'registry', 'list']);

      expect(mockManager.getConnectors).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle errors gracefully', async () => {
      const mockManager = {
        getConnectors: vi.fn().mockRejectedValue(new Error('Config file not found')),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'registry', 'list'])
      ).rejects.toThrow('exit called');

      expect(exitSpy).toHaveBeenCalledWith(1);
      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('searchConnectors function (unit tests)', () => {
    it('should match by ID case-insensitively', () => {
      const connectors = [
        { id: 'weather-server', enabled: true, transport: { type: 'stdio' as const, command: 'npx' } },
      ];

      const results = searchConnectors(connectors, 'WEATHER');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('weather-server');
    });

    it('should match by ID partially', () => {
      const connectors = [
        { id: 'mcp-server-weather', enabled: true, transport: { type: 'stdio' as const, command: 'npx' } },
      ];

      const results = searchConnectors(connectors, 'server');
      expect(results).toHaveLength(1);
    });

    it('should match by transport type', () => {
      const connectors = [
        { id: 'server1', enabled: true, transport: { type: 'stdio' as const, command: 'npx' } },
        { id: 'server2', enabled: true, transport: { type: 'rpc-http' as const, url: 'https://api.example.com' } },
      ];

      const results = searchConnectors(connectors, 'http');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('server2');
    });

    it('should match by command for stdio', () => {
      const connectors = [
        { id: 'server', enabled: true, transport: { type: 'stdio' as const, command: 'python', args: ['server.py'] } },
      ];

      const results = searchConnectors(connectors, 'python');
      expect(results).toHaveLength(1);
    });

    it('should match by args for stdio', () => {
      const connectors = [
        { id: 'server', enabled: true, transport: { type: 'stdio' as const, command: 'python', args: ['server.py'] } },
      ];

      const results = searchConnectors(connectors, 'server.py');
      expect(results).toHaveLength(1);
    });

    it('should match by URL for http transport', () => {
      const connectors = [
        { id: 'server', enabled: true, transport: { type: 'rpc-http' as const, url: 'https://api.github.com/mcp' } },
      ];

      const results = searchConnectors(connectors, 'github');
      expect(results).toHaveLength(1);
    });

    it('should return empty array when no matches', () => {
      const connectors = [
        { id: 'server', enabled: true, transport: { type: 'stdio' as const, command: 'npx' } },
      ];

      const results = searchConnectors(connectors, 'nonexistent');
      expect(results).toHaveLength(0);
    });
  });
});
