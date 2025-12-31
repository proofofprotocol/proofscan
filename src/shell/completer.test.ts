/**
 * Tests for shell TAB completion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCompletions, type DynamicDataProvider } from './completer.js';
import type { ShellContext } from './types.js';

// Mock data provider
function createMockDataProvider(): DynamicDataProvider {
  return {
    getConnectorIds: vi.fn(() => ['mcp-server', 'my-connector', 'test-conn']),
    getSessionPrefixes: vi.fn(() => ['abc12345', 'def67890', 'xyz99999']),
    getRpcIds: vi.fn(() => ['1', '2', '3']),
  };
}

describe('getCompletions', () => {
  let dataProvider: DynamicDataProvider;

  beforeEach(() => {
    dataProvider = createMockDataProvider();
  });

  describe('empty line (command completion)', () => {
    it('should return all available commands', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('', context, dataProvider);

      // Should include shell builtins
      expect(completions).toContain('help');
      expect(completions).toContain('exit');
      expect(completions).toContain('use');

      // Should include router commands
      expect(completions).toContain('cd');
      expect(completions).toContain('cc');
      expect(completions).toContain('ls');
      expect(completions).toContain('show');

      // Should include pfscan commands
      expect(completions).toContain('view');
      expect(completions).toContain('tree');
      expect(completions).toContain('scan');

      // Should NOT include blocked commands
      expect(completions).not.toContain('explore');
      expect(completions).not.toContain('e');
    });
  });

  describe('help command', () => {
    it('should complete help with all available commands', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('help ', context, dataProvider);

      expect(completions).toContain('view');
      expect(completions).toContain('tree');
      expect(completions).not.toContain('explore');
      expect(completions).not.toContain('e');
    });

    it('should filter help completions by prefix', () => {
      const context: ShellContext = {};
      const [completions, prefix] = getCompletions('help v', context, dataProvider);

      expect(prefix).toBe('v');
      expect(completions).toContain('view');
      expect(completions).not.toContain('tree');
    });
  });

  describe('cd/cc command (router navigation)', () => {
    it('should complete with navigation shortcuts at root', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('cd ', context, dataProvider);

      // Navigation shortcuts
      expect(completions).toContain('/');
      expect(completions).toContain('..');
      expect(completions).toContain('-');

      // Connector ids at root
      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).toContain('test-conn');
    });

    it('should complete with session prefixes at connector level', () => {
      const context: ShellContext = { connector: 'mcp-server' };
      const [completions] = getCompletions('cd ', context, dataProvider);

      // Navigation shortcuts
      expect(completions).toContain('/');
      expect(completions).toContain('..');
      expect(completions).toContain('-');

      // Session prefixes (not connector ids)
      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });

    it('should complete cc the same as cd', () => {
      const context: ShellContext = {};
      const [cdCompletions] = getCompletions('cd ', context, dataProvider);
      const [ccCompletions] = getCompletions('cc ', context, dataProvider);

      expect(cdCompletions).toEqual(ccCompletions);
    });

    it('should filter by prefix', () => {
      const context: ShellContext = {};
      const [completions, prefix] = getCompletions('cd m', context, dataProvider);

      expect(prefix).toBe('m');
      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).not.toContain('test-conn');
    });
  });

  describe('show command', () => {
    it('should complete with connector ids at root', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('show ', context, dataProvider);

      expect(completions).toContain('--json');
      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
    });

    it('should complete with session prefixes at connector level', () => {
      const context: ShellContext = { connector: 'mcp-server' };
      const [completions] = getCompletions('show ', context, dataProvider);

      expect(completions).toContain('--json');
      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });

    it('should complete with rpc ids at session level', () => {
      const context: ShellContext = { connector: 'mcp-server', session: 'abc12345-full-id' };
      const [completions] = getCompletions('show ', context, dataProvider);

      expect(completions).toContain('--json');
      expect(completions).toContain('1');
      expect(completions).toContain('2');
      expect(completions).toContain('3');
    });
  });

  describe('ls command', () => {
    it('should complete with options', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('ls ', context, dataProvider);

      expect(completions).toContain('-l');
      expect(completions).toContain('--long');
      expect(completions).toContain('--json');
      expect(completions).toContain('--ids');
    });
  });

  describe('view/tree commands', () => {
    it('should complete view with connector ids', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('view ', context, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      // Also includes options
      expect(completions).toContain('--limit');
      expect(completions).toContain('--json');
    });

    it('should complete tree with connector ids', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('tree ', context, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).toContain('--sessions');
    });

    it('should complete --connector option value', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('view --connector ', context, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).toContain('test-conn');
    });

    it('should complete --session option value', () => {
      const context: ShellContext = { connector: 'mcp-server' };
      const [completions] = getCompletions('tree --session ', context, dataProvider);

      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });
  });

  describe('use command', () => {
    it('should complete with session keyword and connector ids', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('use ', context, dataProvider);

      expect(completions).toContain('session');
      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
    });

    it('should complete use session with session prefixes', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('use session ', context, dataProvider);

      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });
  });

  describe('scan command', () => {
    it('should complete scan start with connector ids', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('scan start ', context, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
      expect(completions).toContain('--id');
      expect(completions).toContain('--timeout');
    });

    it('should complete --id with connector ids', () => {
      const context: ShellContext = {};
      const [completions] = getCompletions('scan start --id ', context, dataProvider);

      expect(completions).toContain('mcp-server');
      expect(completions).toContain('my-connector');
    });
  });
});
