/**
 * Configure Mode Manager Tests
 *
 * Tests for the ConfigureMode class commit logic:
 * - New connector addition (isNew=true)
 * - Existing connector update
 * - No changes case
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigureMode } from './mode.js';
import type { ConfigManager } from '../../config/index.js';
import type { Config, Connector } from '../../types/config.js';

// Mock IpcClient
vi.mock('../../proxy/ipc-client.js', () => ({
  IpcClient: vi.fn().mockImplementation(() => ({
    isRunning: vi.fn().mockResolvedValue(false),
    reload: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

// Mock getSocketPath
vi.mock('../../proxy/ipc-types.js', () => ({
  getSocketPath: vi.fn().mockReturnValue('/tmp/test.sock'),
}));

// Create mock ConfigManager
function createMockConfigManager(connectors: Connector[] = []): ConfigManager {
  const config: Config = { connectors };

  return {
    load: vi.fn().mockResolvedValue(config),
    save: vi.fn().mockResolvedValue(undefined),
    getConfigDir: vi.fn().mockReturnValue('/tmp/test-config'),
    getConfigPath: vi.fn().mockReturnValue('/tmp/test-config/config.json'),
    addConnector: vi.fn().mockImplementation(async (connector: Connector) => {
      config.connectors.push(connector);
    }),
    updateConnector: vi.fn().mockImplementation(async (id: string, updates: Partial<Connector>) => {
      const index = config.connectors.findIndex(c => c.id === id);
      if (index !== -1) {
        config.connectors[index] = { ...config.connectors[index], ...updates };
      }
    }),
  } as unknown as ConfigManager;
}

// Sample connectors
const existingConnector: Connector = {
  id: 'time',
  enabled: true,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-time'],
  },
};

describe('ConfigureMode', () => {
  describe('commit', () => {
    describe('new connector (Case A)', () => {
      it('should add new connector even with no field changes', async () => {
        const configManager = createMockConfigManager([]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('weather');

        // Verify session is marked as new
        const session = mode.getSession();
        expect(session?.isNew).toBe(true);

        // Commit without setting any fields
        const result = await mode.commit({ noReload: true });

        expect(result.success).toBe(true);
        expect(result.commitType).toBe('added');
        expect(configManager.addConnector).toHaveBeenCalled();
        expect(configManager.updateConnector).not.toHaveBeenCalled();
      });

      it('should add new connector with field changes', async () => {
        const configManager = createMockConfigManager([]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('weather');

        // Set some fields
        const manager = mode.getSessionManager()!;
        manager.set('command', 'npx');
        manager.set('args', '-y qweather-mcp@1.0.12');

        const result = await mode.commit({ noReload: true });

        expect(result.success).toBe(true);
        expect(result.commitType).toBe('added');
        expect(configManager.addConnector).toHaveBeenCalled();
      });
    });

    describe('no changes (Case B)', () => {
      it('should not commit when no changes made to existing connector', async () => {
        const configManager = createMockConfigManager([existingConnector]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('time');

        // Verify session is not new
        const session = mode.getSession();
        expect(session?.isNew).toBe(false);

        // Commit without making any changes
        const result = await mode.commit({ noReload: true });

        expect(result.success).toBe(true);
        expect(result.commitType).toBe('none');
        expect(configManager.addConnector).not.toHaveBeenCalled();
        expect(configManager.updateConnector).not.toHaveBeenCalled();
      });
    });

    describe('update existing (Case C)', () => {
      it('should update existing connector with changes', async () => {
        const configManager = createMockConfigManager([existingConnector]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('time');

        // Make a change
        const manager = mode.getSessionManager()!;
        manager.set('enabled', 'false');

        const result = await mode.commit({ noReload: true });

        expect(result.success).toBe(true);
        expect(result.commitType).toBe('updated');
        expect(configManager.addConnector).not.toHaveBeenCalled();
        expect(configManager.updateConnector).toHaveBeenCalled();
      });
    });

    describe('isDirty behavior', () => {
      it('should be dirty for new connector even without changes', async () => {
        const configManager = createMockConfigManager([]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('new-connector');

        expect(mode.isDirty()).toBe(true);
      });

      it('should not be dirty for existing connector without changes', async () => {
        const configManager = createMockConfigManager([existingConnector]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('time');

        expect(mode.isDirty()).toBe(false);
      });

      it('should be dirty for existing connector with changes', async () => {
        const configManager = createMockConfigManager([existingConnector]);
        const mode = new ConfigureMode(configManager);

        mode.enter();
        await mode.editConnector('time');

        const manager = mode.getSessionManager()!;
        manager.set('enabled', 'false');

        expect(mode.isDirty()).toBe(true);
      });
    });
  });
});
