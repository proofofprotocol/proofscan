/**
 * Status Command Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createStatusCommand, calculateResourceInfo, displayResources } from '../status.js';
import { ConfigManager } from '../../config/index.js';
import type { Connector } from '../../types/index.js';

// Mock ConfigManager
vi.mock('../../config/index.js');
// Mock db/connection
vi.mock('../../db/connection.js');
// Mock eventline/store
vi.mock('../../eventline/store.js');

describe('status command', () => {
  describe('calculateResourceInfo', () => {
    let mockConfigPath: string;
    let mockConnectors: Connector[];
    let mockManager: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockConfigPath = '/test/config';

      // Reset global output options
      const { setOutputOptions } = await import('../../utils/output.js');
      setOutputOptions({ json: false, verbose: false });

      // Mock connectors for testing
      mockConnectors = [
        {
          id: 'weather-server',
          enabled: false,
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-server-weather'],
          },
        },
        {
          id: 'openweathermap',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@openweathermap/mcp'],
          },
        },
        {
          id: 'yfinance',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-yfinance'],
          },
        },
      ];

      mockManager = {
        getConnectors: vi.fn().mockResolvedValue(mockConnectors),
        getConfigDir: vi.fn().mockReturnValue('/test/config'),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return zero counts when no connectors exist', async () => {
      mockManager.getConnectors.mockResolvedValue([]);

      const result = await calculateResourceInfo(mockManager, false);

      expect(result).toEqual({
        enabledCount: 0,
        totalCount: 0,
      });
      expect(result.toolCount).toBeUndefined();
      expect(result.estimatedTokens).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('should count enabled vs total connectors correctly', async () => {
      const result = await calculateResourceInfo(mockManager, false);

      expect(result.totalCount).toBe(3);
      expect(result.enabledCount).toBe(2);
      expect(result.toolCount).toBeUndefined();
      expect(result.estimatedTokens).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('should return undefined tool count when showTools is false', async () => {
      const result = await calculateResourceInfo(mockManager, false);

      expect(result.toolCount).toBeUndefined();
      expect(result.estimatedTokens).toBeUndefined();
      // Verify DB was not queried (no tools/list calls)
      expect(mockManager.getConnectors).toHaveBeenCalledOnce();
    });

    it('should calculate tool count from DB when showTools is true', async () => {
      // Mock getEventsDb to return a mock database
      const mockDb = {
        prepare: vi.fn().mockReturnThis(),
        get: vi.fn(),
      };
      const { getEventsDb } = await import('../../db/connection.js');
      vi.mocked(getEventsDb).mockReturnValue(mockDb as any);

      // Mock DB response for each connector
      mockDb.get.mockImplementation((connectorId: string) => {
        if (connectorId === 'openweathermap') {
          return {
            raw_json: JSON.stringify({
              result: {
                tools: [{ name: 'get_current_weather' }, { name: 'get_forecast' }],
              },
            }),
          };
        }
        if (connectorId === 'yfinance') {
          return {
            raw_json: JSON.stringify({
              result: {
                tools: [
                  { name: 'get_stock_info' },
                  { name: 'get_history' },
                  { name: 'search_ticker' },
                ],
              },
            }),
          };
        }
        return undefined; // Disabled connector returns undefined
      });

      const result = await calculateResourceInfo(mockManager, true);

      expect(result.totalCount).toBe(3);
      expect(result.enabledCount).toBe(2);
      expect(result.toolCount).toBe(5); // 2 + 3 tools
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.warning).toBeUndefined();

      // Verify DB was queried for enabled connectors only
      expect(mockDb.get).toHaveBeenCalledTimes(2);
    });

    it('should handle JSON parsing errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnThis(),
        get: vi.fn(),
      };
      const { getEventsDb } = await import('../../db/connection.js');
      vi.mocked(getEventsDb).mockReturnValue(mockDb as any);

      // Mock invalid JSON response
      mockDb.get.mockReturnValue({
        raw_json: '{ invalid json',
      });

      const result = await calculateResourceInfo(mockManager, true);

      expect(result.totalCount).toBe(3);
      expect(result.enabledCount).toBe(2);
      // Invalid JSON should be skipped gracefully
      expect(result.toolCount).toBe(0);
      expect(result.estimatedTokens).toBe(0);
      expect(result.warning).toBeUndefined();
    });

    it('should trigger warning when tokens exceed threshold', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnThis(),
        get: vi.fn(),
      };
      const { getEventsDb } = await import('../../db/connection.js');
      vi.mocked(getEventsDb).mockReturnValue(mockDb as any);

      // Mock large tools response to exceed 5000 tokens
      const largeTools = Array.from({ length: 100 }, (_, i) => ({
        name: `tool_${i}`,
        description: 'This is a very long description that will increase byte count significantly',
      }));

      mockDb.get.mockImplementation((connectorId: string) => {
        // Return the same large tools for both enabled connectors (100 * 2 = 200)
        if (connectorId === 'openweathermap' || connectorId === 'yfinance') {
          return {
            raw_json: JSON.stringify({
              result: {
                tools: largeTools,
              },
            }),
          };
        }
        return undefined;
      });

      const result = await calculateResourceInfo(mockManager, true);

      // 2 connectors * 100 tools each = 200
      expect(result.toolCount).toBe(200);
      expect(result.estimatedTokens).toBeGreaterThan(5000);
      expect(result.warning).toBeDefined();
      // The warning message from i18n (Japanese)
      expect(result.warning).toContain('5,000');
    });
  });

  describe('displayResources', () => {
    let mockManager: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.stubGlobal('console', { log: vi.fn() });

      mockManager = {
        getConnectors: vi.fn().mockResolvedValue([]),
        getConfigDir: vi.fn().mockReturnValue('/test/config'),
      };
      vi.mocked(ConfigManager).mockImplementation(() => mockManager as unknown as ConfigManager);

      const { setOutputOptions } = await import('../../utils/output.js');
      setOutputOptions({ json: false, verbose: false });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('should display connector counts', () => {
      const resources = {
        enabledCount: 2,
        totalCount: 3,
      };

      displayResources(resources, false);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('2'),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('3'),
      );
      // Check that resources title is displayed (Japanese: リソース:)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('リソース'),
      );
    });

    it('should display warning when present', () => {
      const resources = {
        enabledCount: 2,
        totalCount: 3,
        toolCount: 200,
        estimatedTokens: 8000,
        warning: 'Context usage exceeds recommended limit',
      };

      displayResources(resources, false);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('⚠️'),
      );
      // Warning message is displayed after the emoji
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Context usage'),
      );
    });

    it('should display no connectors message when totalCount is zero', () => {
      const resources = {
        enabledCount: 0,
        totalCount: 0,
      };

      displayResources(resources, false);

      // Japanese message: コネクタが設定されていません。
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('コネクタが設定されていません'),
      );
    });

    it('should display tool count and estimated tokens when available', () => {
      const resources = {
        enabledCount: 2,
        totalCount: 3,
        toolCount: 10,
        estimatedTokens: 1200,
      };

      displayResources(resources, false);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('10'),
      );
      // Japanese format with comma: ~1,200 トークン
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('1,200'),
      );
    });
  });
});
