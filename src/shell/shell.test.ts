/**
 * Shell module tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generatePrompt, generatePlainPrompt, supportsColor, shortenSessionId } from './prompt.js';
import { getCompletions } from './completer.js';
import { loadHistory, saveHistory, addToHistory, getHistoryPath } from './history.js';
import { isValidArg } from './repl.js';
import type { ShellContext } from './types.js';
import type { DynamicDataProvider } from './completer.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';

describe('prompt', () => {
  describe('generatePlainPrompt', () => {
    it('should show proofscan:/ when no context', () => {
      const context: ShellContext = {};
      expect(generatePlainPrompt(context)).toBe('proofscan:/ > ');
    });

    it('should show path format when connector is set', () => {
      const context: ShellContext = { connector: 'mcp' };
      // No proto suffix when proto is not set
      expect(generatePlainPrompt(context)).toBe('proofscan:/mcp > ');
    });

    it('should show path format with proto when all set', () => {
      const context: ShellContext = { proto: 'mcp', connector: 'mcp-conn', session: 'abc123def456' };
      expect(generatePlainPrompt(context)).toBe('proofscan:/mcp-conn/abc123de (mcp) > ');
    });

    it('should show session in path format when session is set', () => {
      const context: ShellContext = { connector: 'myconn', session: 'abcdefghijklmnop' };
      // No proto suffix when proto is not set
      expect(generatePlainPrompt(context)).toBe('proofscan:/myconn/abcdefgh > ');
    });

    it('should not show proto suffix when proto is ?', () => {
      const context: ShellContext = { connector: 'mcp', proto: '?' };
      expect(generatePlainPrompt(context)).toBe('proofscan:/mcp > ');
    });
  });

  describe('shortenSessionId', () => {
    it('should return first 8 chars by default', () => {
      expect(shortenSessionId('abc123def456789')).toBe('abc123de');
    });

    it('should respect custom length', () => {
      expect(shortenSessionId('abc123def456789', 4)).toBe('abc1');
    });

    it('should handle short IDs', () => {
      expect(shortenSessionId('abc')).toBe('abc');
    });
  });
});

describe('completer', () => {
  const mockDataProvider: DynamicDataProvider = {
    getConnectorIds: () => ['mcp', 'yfinance', 'test-connector'],
    getSessionPrefixes: () => ['abc12345', 'def67890', 'ghi11111'],
    getRpcIds: () => ['1', '2', '3'],
  };

  const context: ShellContext = { connector: 'mcp' };

  describe('getCompletions', () => {
    it('should complete empty input with all commands', () => {
      const [completions] = getCompletions('', context, mockDataProvider);
      expect(completions).toContain('view');
      expect(completions).toContain('tree');
      expect(completions).toContain('help');
      expect(completions).toContain('exit');
    });

    it('should complete partial command', () => {
      const [completions] = getCompletions('vi', context, mockDataProvider);
      expect(completions).toContain('view');
    });

    it('should complete subcommands for scan', () => {
      const [completions] = getCompletions('scan ', context, mockDataProvider);
      expect(completions).toContain('start');
    });

    it('should complete options for view', () => {
      const [completions] = getCompletions('view --', context, mockDataProvider);
      expect(completions).toContain('--limit');
      expect(completions).toContain('--errors');
      expect(completions).toContain('--fulltime');
    });

    it('should complete connector IDs after --id', () => {
      const [completions] = getCompletions('scan start --id ', context, mockDataProvider);
      expect(completions).toContain('mcp');
      expect(completions).toContain('yfinance');
    });

    it('should complete session prefixes after --session', () => {
      const [completions] = getCompletions('rpc list --session ', context, mockDataProvider);
      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });

    it('should complete use command with connector and session', () => {
      const [completions] = getCompletions('use ', context, mockDataProvider);
      expect(completions).toContain('session');
      expect(completions).toContain('mcp');
      expect(completions).toContain('yfinance');
    });

    it('should complete use session with session prefixes', () => {
      const [completions] = getCompletions('use session ', context, mockDataProvider);
      expect(completions).toContain('abc12345');
      expect(completions).toContain('def67890');
    });
  });
});

describe('history', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `proofscan-shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  describe('addToHistory', () => {
    it('should add new entry', () => {
      const history = addToHistory([], 'view');
      expect(history).toEqual(['view']);
    });

    it('should not add empty lines', () => {
      const history = addToHistory(['view'], '  ');
      expect(history).toEqual(['view']);
    });

    it('should not add duplicate consecutive entries', () => {
      let history = addToHistory([], 'view');
      history = addToHistory(history, 'view');
      expect(history).toEqual(['view']);
    });

    it('should add non-consecutive duplicates', () => {
      let history = addToHistory([], 'view');
      history = addToHistory(history, 'tree');
      history = addToHistory(history, 'view');
      expect(history).toEqual(['view', 'tree', 'view']);
    });

    it('should trim whitespace', () => {
      const history = addToHistory([], '  view  ');
      expect(history).toEqual(['view']);
    });
  });
});

describe('isValidArg', () => {
  describe('should allow safe arguments', () => {
    it('should allow simple commands', () => {
      expect(isValidArg('view')).toBe(true);
      expect(isValidArg('tree')).toBe(true);
    });

    it('should allow options with dashes', () => {
      expect(isValidArg('--limit')).toBe(true);
      expect(isValidArg('-v')).toBe(true);
      expect(isValidArg('--connector')).toBe(true);
    });

    it('should allow option values with equals', () => {
      expect(isValidArg('--format=json')).toBe(true);
      expect(isValidArg('--limit=50')).toBe(true);
    });

    it('should allow file paths', () => {
      expect(isValidArg('/path/to/file')).toBe(true);
      expect(isValidArg('./relative/path')).toBe(true);
      expect(isValidArg('C:\\Windows\\path')).toBe(true);
    });

    it('should allow quoted strings with spaces', () => {
      expect(isValidArg('"My Connector"')).toBe(true);
      expect(isValidArg("'test name'")).toBe(true);
      expect(isValidArg('name with spaces')).toBe(true);
    });

    it('should allow parentheses and angle brackets', () => {
      expect(isValidArg('(test)')).toBe(true);
      expect(isValidArg('<value>')).toBe(true);
    });

    it('should allow colons for URLs and ports', () => {
      expect(isValidArg('http://localhost:8080')).toBe(true);
      expect(isValidArg('mcp:session')).toBe(true);
    });
  });

  describe('should block dangerous arguments', () => {
    it('should block command chaining with &', () => {
      expect(isValidArg('view & rm -rf /')).toBe(false);
      expect(isValidArg('test&&evil')).toBe(false);
    });

    it('should block piping with |', () => {
      expect(isValidArg('view | cat /etc/passwd')).toBe(false);
    });

    it('should block command separation with ;', () => {
      expect(isValidArg('view; rm -rf /')).toBe(false);
    });

    it('should block command substitution with backticks', () => {
      expect(isValidArg('`whoami`')).toBe(false);
    });

    it('should block variable expansion with $', () => {
      expect(isValidArg('$HOME')).toBe(false);
      expect(isValidArg('$(whoami)')).toBe(false);
      expect(isValidArg('${PATH}')).toBe(false);
    });

    it('should block newline injection', () => {
      expect(isValidArg('view\nrm -rf /')).toBe(false);
      expect(isValidArg('view\r\nrm -rf /')).toBe(false);
    });

    it('should block null byte injection', () => {
      expect(isValidArg('view\0rm')).toBe(false);
    });
  });
});
