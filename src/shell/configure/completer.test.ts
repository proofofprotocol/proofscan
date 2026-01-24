/**
 * Tests for configure mode TAB completion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfigureCompletions, type ConfigureDataProvider } from './completer.js';
import { ConfigureMode } from './mode.js';
import { ConfigManager } from '../../config/index.js';

// Mock ConfigManager
vi.mock('../../config/index.js', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({ connectors: [] }),
    getConfigDir: vi.fn().mockReturnValue('/tmp/test-config'),
    addConnector: vi.fn(),
    updateConnector: vi.fn(),
  })),
}));

// Mock IPC client
vi.mock('../../proxy/ipc-client.js', () => ({
  IpcClient: vi.fn().mockImplementation(() => ({
    isRunning: vi.fn().mockResolvedValue(false),
    reload: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock('../../proxy/ipc-types.js', () => ({
  getSocketPath: vi.fn().mockReturnValue('/tmp/test.sock'),
}));

// Mock data provider
function createMockDataProvider(): ConfigureDataProvider {
  return {
    getConnectorIds: vi.fn(() => ['mcp-server', 'my-connector', 'test-conn']),
  };
}

describe('getConfigureCompletions', () => {
  let mode: ConfigureMode;
  let dataProvider: ConfigureDataProvider;

  beforeEach(() => {
    const mockConfigManager = new ConfigManager('/tmp/test');
    mode = new ConfigureMode(mockConfigManager);
    dataProvider = createMockDataProvider();
  });

  describe('root level (not editing)', () => {
    beforeEach(() => {
      mode.enter();
    });

    it('should return root commands on empty line', () => {
      const [completions] = getConfigureCompletions('', mode, dataProvider);

      expect(completions).toContain('connector');
      expect(completions).toContain('edit');
      expect(completions).toContain('ls');
      expect(completions).toContain('exit');
      expect(completions).toContain('help');
    });

    it('should complete partial command', () => {
      const [completions, prefix] = getConfigureCompletions('con', mode, dataProvider);

      expect(prefix).toBe('con');
      expect(completions).toContain('connector');
      expect(completions).not.toContain('exit');
    });

    it('should complete connector ids after "connector "', () => {
      const [completions] = getConfigureCompletions('connector ', mode, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).toContain('test-conn');
    });

    it('should complete "connector" after "edit "', () => {
      const [completions] = getConfigureCompletions('edit ', mode, dataProvider);

      expect(completions).toContain('connector');
    });

    it('should complete connector ids after "edit connector "', () => {
      const [completions] = getConfigureCompletions('edit connector ', mode, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
    });

    it('should complete ls options', () => {
      const [completions] = getConfigureCompletions('ls ', mode, dataProvider);

      expect(completions).toContain('--detail');
    });

    it('should complete help with root commands', () => {
      const [completions] = getConfigureCompletions('help ', mode, dataProvider);

      expect(completions).toContain('connector');
      expect(completions).toContain('edit');
      expect(completions).toContain('exit');
    });
  });

  describe('edit session (editing connector)', () => {
    beforeEach(async () => {
      mode.enter();
      await mode.editConnector('test-connector');
    });

    it('should return edit session commands on empty line', () => {
      const [completions] = getConfigureCompletions('', mode, dataProvider);

      expect(completions).toContain('set');
      expect(completions).toContain('unset');
      expect(completions).toContain('show');
      expect(completions).toContain('commit');
      expect(completions).toContain('discard');
      expect(completions).toContain('exit');
      expect(completions).toContain('help');
    });

    it('should complete partial command', () => {
      const [completions, prefix] = getConfigureCompletions('se', mode, dataProvider);

      expect(prefix).toBe('se');
      expect(completions).toContain('set');
      expect(completions).not.toContain('show');
    });

    describe('set command', () => {
      it('should complete field paths after "set "', () => {
        const [completions] = getConfigureCompletions('set ', mode, dataProvider);

        expect(completions).toContain('enabled');
        expect(completions).toContain('command');
        expect(completions).toContain('cwd');
        expect(completions).toContain('args');
        expect(completions).toContain('args[0]');
      });

      it('should complete partial field path', () => {
        const [completions, prefix] = getConfigureCompletions('set en', mode, dataProvider);

        expect(prefix).toBe('en');
        expect(completions).toContain('enabled');
        expect(completions).not.toContain('command');
      });

      it('should suggest true/false for "set enabled "', () => {
        const [completions] = getConfigureCompletions('set enabled ', mode, dataProvider);

        expect(completions).toContain('true');
        expect(completions).toContain('false');
      });

      it('should suggest common commands for "set command "', () => {
        const [completions] = getConfigureCompletions('set command ', mode, dataProvider);

        expect(completions).toContain('npx');
        expect(completions).toContain('uvx');
        expect(completions).toContain('node');
        expect(completions).toContain('python');
      });

      it('should suggest --secret after value', () => {
        const [completions] = getConfigureCompletions('set env.API_KEY myvalue ', mode, dataProvider);

        expect(completions).toContain('--secret');
      });

      it('should not suggest --secret if already used', () => {
        const [completions] = getConfigureCompletions('set env.API_KEY myvalue --secret ', mode, dataProvider);

        expect(completions).not.toContain('--secret');
      });

      it('should suggest common env vars for env path', () => {
        const [completions] = getConfigureCompletions('set env.', mode, dataProvider);

        expect(completions.some(c => c.startsWith('env.'))).toBe(true);
      });
    });

    describe('unset command', () => {
      it('should return empty list for new connector with no optional fields set', () => {
        const [completions] = getConfigureCompletions('unset ', mode, dataProvider);

        // New connector has no optional fields set, so nothing to unset
        // (enabled and command cannot be unset)
        expect(completions).toEqual([]);
      });
    });

    describe('show command', () => {
      it('should complete show options', () => {
        const [completions] = getConfigureCompletions('show ', mode, dataProvider);

        expect(completions).toContain('--json');
        expect(completions).toContain('candidate-config');
        expect(completions).toContain('diff');
      });
    });

    describe('commit command', () => {
      it('should complete commit options', () => {
        const [completions] = getConfigureCompletions('commit ', mode, dataProvider);

        expect(completions).toContain('--dry-run');
        expect(completions).toContain('--no-reload');
      });

      it('should filter already used options', () => {
        const [completions] = getConfigureCompletions('commit --dry-run ', mode, dataProvider);

        expect(completions).not.toContain('--dry-run');
        expect(completions).toContain('--no-reload');
      });
    });

    describe('help command', () => {
      it('should complete help with edit session commands', () => {
        const [completions] = getConfigureCompletions('help ', mode, dataProvider);

        expect(completions).toContain('set');
        expect(completions).toContain('unset');
        expect(completions).toContain('commit');
      });
    });
  });

  describe('with existing connector data', () => {
    beforeEach(async () => {
      mode.enter();
      await mode.editConnector('test-connector');

      // Set some values on the connector
      const manager = mode.getSessionManager()!;
      manager.set('command', 'npx');
      manager.set('cwd', '/tmp/test');
      manager.set('args[0]', '-y');
      manager.set('args[1]', 'some-package');
      manager.set('env.MY_VAR', 'value');
    });

    it('should suggest current env vars', () => {
      const [completions] = getConfigureCompletions('set env.', mode, dataProvider);

      expect(completions).toContain('env.MY_VAR');
    });

    it('should suggest existing args indices', () => {
      const [completions] = getConfigureCompletions('set args', mode, dataProvider);

      expect(completions).toContain('args[0]');
      expect(completions).toContain('args[1]');
      expect(completions).toContain('args[2]'); // Next available
    });

    it('should show settable fields for unset', () => {
      const [completions] = getConfigureCompletions('unset ', mode, dataProvider);

      expect(completions).toContain('cwd');
      expect(completions).toContain('args');
      expect(completions).toContain('args[0]');
      expect(completions).toContain('args[1]');
      expect(completions).toContain('env.MY_VAR');
    });
  });

  describe('case insensitivity', () => {
    beforeEach(() => {
      mode.enter();
    });

    it('should match commands case-insensitively', () => {
      const [completions] = getConfigureCompletions('CON', mode, dataProvider);

      expect(completions).toContain('connector');
    });

    it('should match connector IDs case-insensitively', () => {
      const [completions] = getConfigureCompletions('connector MCP', mode, dataProvider);

      expect(completions).toContain('mcp-server');
    });
  });

  describe('quoted value handling', () => {
    beforeEach(async () => {
      mode.enter();
      await mode.editConnector('test-connector');
    });

    it('should handle quoted values in tokenization', () => {
      // After a quoted value, should still suggest --secret
      const [completions] = getConfigureCompletions('set command "npx -y" ', mode, dataProvider);

      expect(completions).toContain('--secret');
    });
  });
});
