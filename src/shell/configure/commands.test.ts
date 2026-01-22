/**
 * Configure Mode Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processConfigureCommand, CommandResult } from './commands.js';
import type { ConfigureMode } from './mode.js';
import type { Connector } from '../../types/config.js';
import type { EditSession } from './types.js';
import type { EditSessionManager } from './session.js';

// Mock ConfigureMode
function createMockMode(overrides: Partial<{
  isActive: boolean;
  isEditing: boolean;
  isDirty: boolean;
  currentConnector: Connector | null;
  session: EditSession | null;
  sessionManager: EditSessionManager | null;
  connectors: Connector[];
}> = {}): ConfigureMode {
  const defaults = {
    isActive: true,
    isEditing: false,
    isDirty: false,
    currentConnector: null,
    session: null,
    sessionManager: null,
    connectors: [],
  };
  const config = { ...defaults, ...overrides };

  return {
    isActive: () => config.isActive,
    isEditing: () => config.isEditing,
    isDirty: () => config.isDirty,
    getCurrentConnector: () => config.currentConnector,
    getSession: () => config.session,
    getSessionManager: () => config.sessionManager,
    listConnectors: vi.fn().mockResolvedValue(config.connectors),
    editConnector: vi.fn().mockResolvedValue({ isNew: false, connector: {} }),
    endEditSession: vi.fn().mockReturnValue({ wasDirty: false }),
    forceExit: vi.fn(),
    discard: vi.fn().mockReturnValue({ hadChanges: false }),
    commit: vi.fn().mockResolvedValue({ success: true, proxyReloaded: false, secretsStored: 0 }),
    enter: vi.fn(),
    exit: vi.fn().mockReturnValue({ canExit: true, isDirty: false }),
    getPrompt: vi.fn().mockReturnValue('proofscan(config)# '),
  } as unknown as ConfigureMode;
}

// Sample connectors for testing
const sampleStdioConnector: Connector = {
  id: 'test-connector',
  enabled: true,
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@test/mcp-server'],
    env: { API_KEY: 'test-value' },
  },
};

const sampleHttpConnector: Connector = {
  id: 'http-connector',
  enabled: false,
  transport: {
    type: 'rpc-http',
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer token' },
  },
};

const sampleSseConnector: Connector = {
  id: 'sse-connector',
  enabled: true,
  transport: {
    type: 'rpc-sse',
    url: 'https://api.example.com/sse',
  },
};

describe('processConfigureCommand', () => {
  describe('empty input', () => {
    it('should return success for empty line', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, '');
      expect(result.success).toBe(true);
    });

    it('should return success for whitespace-only line', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, '   ');
      expect(result.success).toBe(true);
    });
  });

  describe('unknown command', () => {
    it('should return error for unknown command', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, 'foobar');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command');
    });
  });

  describe('help command', () => {
    it('should return help text when not editing', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'help');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.some(line => line.includes('connector <id>'))).toBe(true);
      expect(result.output!.some(line => line.includes('ls'))).toBe(true);
    });

    it('should return help text with set/unset when editing', async () => {
      const mode = createMockMode({ isEditing: true });
      const result = await processConfigureCommand(mode, 'help');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.some(line => line.includes('set'))).toBe(true);
      expect(result.output!.some(line => line.includes('unset'))).toBe(true);
      expect(result.output!.some(line => line.includes('commit'))).toBe(true);
    });

    it('should also work with ? alias', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, '?');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });
  });

  describe('exit command', () => {
    it('should exit configure mode when not editing', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'exit');
      expect(result.success).toBe(true);
      expect(result.exitMode).toBe(true);
      expect(mode.forceExit).toHaveBeenCalled();
    });

    it('should exit edit session when editing without changes', async () => {
      const mode = createMockMode({ isEditing: true, isDirty: false });
      const result = await processConfigureCommand(mode, 'exit');
      expect(result.success).toBe(true);
      expect(result.exitSession).toBe(true);
      expect(mode.endEditSession).toHaveBeenCalled();
    });

    it('should warn about unsaved changes when dirty', async () => {
      const mode = createMockMode({ isEditing: true, isDirty: true });
      const result = await processConfigureCommand(mode, 'exit');
      expect(result.success).toBe(false);
      expect(result.needsConfirmation).toBe('exit');
      expect(result.message).toContain('unsaved changes');
    });
  });

  describe('connector command (IOS-style shortcut)', () => {
    it('should require connector id', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, 'connector');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage: connector <id>');
    });

    it('should delegate to edit connector', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, 'connector yfinance');
      expect(result.success).toBe(true);
      expect(mode.editConnector).toHaveBeenCalledWith('yfinance');
    });
  });

  describe('edit command', () => {
    it('should require "connector" keyword', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, 'edit');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage: edit connector');
    });

    it('should require connector id', async () => {
      const mode = createMockMode();
      const result = await processConfigureCommand(mode, 'edit connector');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage: edit connector');
    });

    it('should edit existing connector', async () => {
      const mode = createMockMode();
      (mode.editConnector as ReturnType<typeof vi.fn>).mockResolvedValue({
        isNew: false,
        connector: sampleStdioConnector,
      });

      const result = await processConfigureCommand(mode, 'edit connector test-connector');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Editing connector');
      expect(mode.editConnector).toHaveBeenCalledWith('test-connector');
    });

    it('should create new connector if not found', async () => {
      const mode = createMockMode();
      (mode.editConnector as ReturnType<typeof vi.fn>).mockResolvedValue({
        isNew: true,
        connector: { id: 'new-connector' },
      });

      const result = await processConfigureCommand(mode, 'edit connector new-connector');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Creating new connector');
    });

    it('should warn about unsaved changes when switching connectors', async () => {
      const mode = createMockMode({
        isEditing: true,
        isDirty: true,
        currentConnector: sampleStdioConnector,
      });

      const result = await processConfigureCommand(mode, 'edit connector other-connector');
      expect(result.success).toBe(false);
      expect(result.error).toContain('unsaved changes');
    });
  });

  describe('ls command', () => {
    it('should list connectors', async () => {
      const mode = createMockMode({
        connectors: [sampleStdioConnector, sampleHttpConnector],
      });

      const result = await processConfigureCommand(mode, 'ls');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.some(line => line.includes('test-connector'))).toBe(true);
      expect(result.output!.some(line => line.includes('http-connector'))).toBe(true);
    });

    it('should show message when no connectors', async () => {
      const mode = createMockMode({ connectors: [] });

      const result = await processConfigureCommand(mode, 'ls');
      expect(result.success).toBe(true);
      expect(result.output).toContain('No connectors configured.');
    });

    it('should show full command/url with --detail', async () => {
      const mode = createMockMode({
        connectors: [sampleStdioConnector],
      });

      const result = await processConfigureCommand(mode, 'ls --detail');
      expect(result.success).toBe(true);
      expect(result.output!.some(line => line.includes('npx'))).toBe(true);
    });

    it('should handle different transport types', async () => {
      const mode = createMockMode({
        connectors: [sampleStdioConnector, sampleHttpConnector, sampleSseConnector],
      });

      const result = await processConfigureCommand(mode, 'ls --detail');
      expect(result.success).toBe(true);
      // stdio shows command
      expect(result.output!.some(line => line.includes('npx'))).toBe(true);
      // http shows url
      expect(result.output!.some(line => line.includes('https://api.example.com/mcp'))).toBe(true);
      // sse shows url
      expect(result.output!.some(line => line.includes('https://api.example.com/sse'))).toBe(true);
    });

    it('should truncate long commands in simple view', async () => {
      const longCommandConnector: Connector = {
        id: 'long-cmd',
        enabled: true,
        transport: {
          type: 'stdio',
          command: '/very/long/path/to/some/command',
        },
      };
      const mode = createMockMode({ connectors: [longCommandConnector] });

      const result = await processConfigureCommand(mode, 'ls');
      expect(result.success).toBe(true);
      // Should be truncated with ...
      expect(result.output!.some(line => line.includes('...'))).toBe(true);
    });

    it('should handle load error gracefully', async () => {
      const mode = createMockMode();
      (mode.listConnectors as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Config file not found'));

      const result = await processConfigureCommand(mode, 'ls');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to load connectors');
    });
  });

  describe('set command', () => {
    it('should require editing mode', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'set enabled true');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connector being edited');
    });

    it('should require path and value', async () => {
      const mockManager = {
        set: vi.fn().mockReturnValue({ success: true, isSecret: false, path: 'enabled' }),
      };
      const mode = createMockMode({
        isEditing: true,
        sessionManager: mockManager as unknown as EditSessionManager,
      });

      const result = await processConfigureCommand(mode, 'set');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage: set');
    });

    it('should set field value', async () => {
      const mockManager = {
        set: vi.fn().mockReturnValue({ success: true, isSecret: false, path: 'enabled' }),
      };
      const mode = createMockMode({
        isEditing: true,
        sessionManager: mockManager as unknown as EditSessionManager,
      });

      const result = await processConfigureCommand(mode, 'set enabled true');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Set enabled');
      expect(mockManager.set).toHaveBeenCalledWith('enabled', 'true', expect.any(Object));
    });

    it('should handle --secret flag', async () => {
      const mockManager = {
        set: vi.fn().mockReturnValue({ success: true, isSecret: true, path: 'env.API_KEY' }),
      };
      const mode = createMockMode({
        isEditing: true,
        sessionManager: mockManager as unknown as EditSessionManager,
      });

      const result = await processConfigureCommand(mode, 'set env.API_KEY myvalue --secret');
      expect(result.success).toBe(true);
      expect(result.message).toContain('secret');
      expect(mockManager.set).toHaveBeenCalledWith('env.API_KEY', 'myvalue', { forceSecret: true });
    });
  });

  describe('unset command', () => {
    it('should require editing mode', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'unset cwd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connector being edited');
    });

    it('should unset field', async () => {
      const mockManager = {
        unset: vi.fn().mockReturnValue({ success: true, wasSecret: false, path: 'cwd' }),
      };
      const mode = createMockMode({
        isEditing: true,
        sessionManager: mockManager as unknown as EditSessionManager,
      });

      const result = await processConfigureCommand(mode, 'unset cwd');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Unset cwd');
    });
  });

  describe('show command', () => {
    it('should require editing mode for default show', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'show');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connector being edited');
    });

    it('should show connector config', async () => {
      const session: EditSession = {
        original: sampleStdioConnector,
        candidate: sampleStdioConnector,
        modifiedFields: new Set(),
        pendingSecrets: new Map(),
        isNew: false,
      };
      const mode = createMockMode({
        isEditing: true,
        session,
      });

      const result = await processConfigureCommand(mode, 'show');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.some(line => line.includes('test-connector'))).toBe(true);
      expect(result.output!.some(line => line.includes('npx'))).toBe(true);
    });

    it('should output JSON with --json flag', async () => {
      const session: EditSession = {
        original: sampleStdioConnector,
        candidate: sampleStdioConnector,
        modifiedFields: new Set(),
        pendingSecrets: new Map(),
        isNew: false,
      };
      const mode = createMockMode({
        isEditing: true,
        session,
      });

      const result = await processConfigureCommand(mode, 'show --json');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.length).toBe(1);

      const json = JSON.parse(result.output![0]);
      expect(json.id).toBe('test-connector');
      expect(json.transport.command).toBe('npx');
    });

    it('should mask secrets in JSON output', async () => {
      const connectorWithSecret: Connector = {
        id: 'secret-conn',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          env: { API_KEY: 'dpapi:12345' },
        },
      };
      const session: EditSession = {
        original: connectorWithSecret,
        candidate: connectorWithSecret,
        modifiedFields: new Set(),
        pendingSecrets: new Map([['PENDING_SECRET', 'plaintext']]),
        isNew: false,
      };
      const mode = createMockMode({
        isEditing: true,
        session,
      });

      const result = await processConfigureCommand(mode, 'show --json');
      expect(result.success).toBe(true);

      const json = JSON.parse(result.output![0]);
      expect(json.transport.env.API_KEY).toBe('[secret]');
    });

    it('should handle HTTP transport in JSON output', async () => {
      const session: EditSession = {
        original: sampleHttpConnector,
        candidate: sampleHttpConnector,
        modifiedFields: new Set(),
        pendingSecrets: new Map(),
        isNew: false,
      };
      const mode = createMockMode({
        isEditing: true,
        session,
      });

      const result = await processConfigureCommand(mode, 'show --json');
      expect(result.success).toBe(true);

      const json = JSON.parse(result.output![0]);
      expect(json.id).toBe('http-connector');
      expect(json.transport.type).toBe('rpc-http');
      expect(json.transport.url).toBe('https://api.example.com/mcp');
    });
  });

  describe('discard command', () => {
    it('should require editing mode', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'discard');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connector being edited');
    });

    it('should discard changes', async () => {
      const mode = createMockMode({ isEditing: true });
      (mode.discard as ReturnType<typeof vi.fn>).mockReturnValue({ hadChanges: true });

      const result = await processConfigureCommand(mode, 'discard');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Discarded changes');
      expect(result.exitSession).toBe(true);
    });
  });

  describe('commit command', () => {
    it('should require editing mode', async () => {
      const mode = createMockMode({ isEditing: false });
      const result = await processConfigureCommand(mode, 'commit');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No connector being edited');
    });

    it('should commit changes', async () => {
      const mode = createMockMode({ isEditing: true });
      (mode.commit as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        proxyReloaded: true,
        secretsStored: 1,
      });

      const result = await processConfigureCommand(mode, 'commit');
      expect(result.success).toBe(true);
      expect(result.output!.some(line => line.includes('Committed'))).toBe(true);
      expect(result.output!.some(line => line.includes('Proxy reloaded'))).toBe(true);
      expect(result.exitSession).toBe(true);
    });

    it('should handle --dry-run', async () => {
      const mockManager = {
        getDiff: vi.fn().mockReturnValue({
          hasChanges: true,
          added: new Map([['cwd', '/path']]),
          modified: new Map(),
          removed: new Map(),
        }),
      };
      const session: EditSession = {
        original: sampleStdioConnector,
        candidate: sampleStdioConnector,
        modifiedFields: new Set(['cwd']),
        pendingSecrets: new Map(),
        isNew: false,
      };
      const mode = createMockMode({
        isEditing: true,
        sessionManager: mockManager as unknown as EditSessionManager,
        session,
      });

      const result = await processConfigureCommand(mode, 'commit --dry-run');
      expect(result.success).toBe(true);
      expect(result.output!.some(line => line.includes('dry-run'))).toBe(true);
      expect(mode.commit).not.toHaveBeenCalled();
    });
  });
});
