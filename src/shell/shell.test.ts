/**
 * Shell module tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generatePrompt, generatePlainPrompt, supportsColor, shortenSessionId } from './prompt.js';
import { getCompletions } from './completer.js';
import { loadHistory, saveHistory, addToHistory, getHistoryPath } from './history.js';
import { isValidArg, parsePipeCommand } from './repl.js';
import { isRef, parseRef } from './ref-resolver.js';
import type { ShellContext } from './types.js';
import type { DynamicDataProvider } from './completer.js';
import { TOP_LEVEL_COMMANDS, COMMAND_SUBCOMMANDS, BLOCKED_SUBCOMMANDS_IN_SHELL, TOOL_COMMANDS } from './types.js';
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

describe('secrets command in shell', () => {
  describe('TOP_LEVEL_COMMANDS', () => {
    it('should include secrets command', () => {
      expect(TOP_LEVEL_COMMANDS).toContain('secrets');
    });

    it('should include secret alias', () => {
      expect(TOP_LEVEL_COMMANDS).toContain('secret');
    });
  });

  describe('COMMAND_SUBCOMMANDS', () => {
    it('should have secrets subcommands', () => {
      expect(COMMAND_SUBCOMMANDS.secrets).toBeDefined();
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('list');
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('set');
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('edit');
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('prune');
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('export');
      expect(COMMAND_SUBCOMMANDS.secrets).toContain('import');
    });

    it('should have secret alias subcommands', () => {
      expect(COMMAND_SUBCOMMANDS.secret).toEqual(COMMAND_SUBCOMMANDS.secrets);
    });
  });

  describe('BLOCKED_SUBCOMMANDS_IN_SHELL', () => {
    it('should block secrets set (requires hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secrets set');
    });

    it('should block secrets edit (requires hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secrets edit');
    });

    it('should block secrets export (requires hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secrets export');
    });

    it('should block secrets import (requires hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secrets import');
    });

    it('should block secret alias subcommands too', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secret set');
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secret edit');
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secret export');
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).toContain('secret import');
    });

    it('should NOT block secrets list (no hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).not.toContain('secrets list');
    });

    it('should NOT block secrets prune (no hidden input)', () => {
      expect(BLOCKED_SUBCOMMANDS_IN_SHELL).not.toContain('secrets prune');
    });
  });

  describe('completion', () => {
    const mockDataProvider: DynamicDataProvider = {
      getConnectorIds: () => ['mcp'],
      getSessionPrefixes: () => [],
      getRpcIds: () => [],
    };
    const context: ShellContext = {};

    it('should complete secrets command', () => {
      const [completions] = getCompletions('sec', context, mockDataProvider);
      expect(completions).toContain('secrets');
      expect(completions).toContain('secret');
    });

    it('should complete secrets subcommands', () => {
      const [completions] = getCompletions('secrets ', context, mockDataProvider);
      expect(completions).toContain('list');
      expect(completions).toContain('set');
      expect(completions).toContain('prune');
      expect(completions).toContain('export');
      expect(completions).toContain('import');
    });

    it('should complete secret alias subcommands', () => {
      const [completions] = getCompletions('secret ', context, mockDataProvider);
      expect(completions).toContain('list');
      expect(completions).toContain('set');
    });
  });
});

describe('tool commands in shell', () => {
  describe('TOOL_COMMANDS', () => {
    it('should include tool command', () => {
      expect(TOOL_COMMANDS).toContain('tool');
    });

    it('should include send command', () => {
      expect(TOOL_COMMANDS).toContain('send');
    });
  });

  describe('COMMAND_SUBCOMMANDS', () => {
    it('should have tool subcommands', () => {
      expect(COMMAND_SUBCOMMANDS.tool).toBeDefined();
      expect(COMMAND_SUBCOMMANDS.tool).toContain('ls');
      expect(COMMAND_SUBCOMMANDS.tool).toContain('list');
      expect(COMMAND_SUBCOMMANDS.tool).toContain('show');
    });
  });

  describe('completion', () => {
    const mockDataProvider: DynamicDataProvider = {
      getConnectorIds: () => ['mcp'],
      getSessionPrefixes: () => [],
      getRpcIds: () => [],
    };
    const context: ShellContext = {};

    it('should complete tool command', () => {
      const [completions] = getCompletions('too', context, mockDataProvider);
      expect(completions).toContain('tool');
    });

    it('should complete send command', () => {
      const [completions] = getCompletions('sen', context, mockDataProvider);
      expect(completions).toContain('send');
    });

    it('should complete tool subcommands', () => {
      const [completions] = getCompletions('tool ', context, mockDataProvider);
      expect(completions).toContain('ls');
      expect(completions).toContain('show');
    });

    it('should complete tool show options', () => {
      const [completions] = getCompletions('tool show ', context, mockDataProvider);
      expect(completions).toContain('--json');
    });

    it('should complete send options', () => {
      const [completions] = getCompletions('send ', context, mockDataProvider);
      expect(completions).toContain('--json');
      expect(completions).toContain('--dry-run');
    });
  });
});

describe('parsePipeCommand', () => {
  describe('should parse pipe with spaces', () => {
    it('should parse "pwd --json | ref add name"', () => {
      const result = parsePipeCommand('pwd --json | ref add name');
      expect(result).toEqual({ left: 'pwd --json', right: 'ref add name' });
    });

    it('should parse commands with extra spaces', () => {
      const result = parsePipeCommand('pwd --json  |  ref add name');
      expect(result).toEqual({ left: 'pwd --json', right: 'ref add name' });
    });
  });

  describe('should parse pipe without spaces', () => {
    it('should parse "pwd --json|ref add name"', () => {
      const result = parsePipeCommand('pwd --json|ref add name');
      expect(result).toEqual({ left: 'pwd --json', right: 'ref add name' });
    });

    it('should parse "--json|ref" attached form', () => {
      const result = parsePipeCommand('pwd --json|ref add myref');
      expect(result).toEqual({ left: 'pwd --json', right: 'ref add myref' });
    });
  });

  describe('should return null for non-pipe commands', () => {
    it('should return null for simple command', () => {
      const result = parsePipeCommand('pwd --json');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parsePipeCommand('');
      expect(result).toBeNull();
    });

    it('should return null for pipe at start', () => {
      const result = parsePipeCommand('| ref add name');
      expect(result).toBeNull();
    });

    it('should return null for pipe at end', () => {
      const result = parsePipeCommand('pwd --json |');
      expect(result).toBeNull();
    });
  });

  describe('should prefer spaced pipe over unspaced', () => {
    it('should prefer " | " when both are present', () => {
      // If someone writes "a|b | c|d", the first ' | ' should be used
      const result = parsePipeCommand('a|b | c|d');
      expect(result).toEqual({ left: 'a|b', right: 'c|d' });
    });
  });
});

describe('ref-resolver', () => {
  describe('isRef', () => {
    it('should recognize @this as a reference', () => {
      expect(isRef('@this')).toBe(true);
    });

    it('should recognize @last as a reference', () => {
      expect(isRef('@last')).toBe(true);
    });

    it('should recognize @rpc:<id> as a reference', () => {
      expect(isRef('@rpc:abc123')).toBe(true);
    });

    it('should recognize @session:<id> as a reference', () => {
      expect(isRef('@session:xyz789')).toBe(true);
    });

    it('should recognize @ref:<name> as a reference', () => {
      expect(isRef('@ref:myref')).toBe(true);
    });

    it('should recognize @fav:<name> as a reference', () => {
      expect(isRef('@fav:myfav')).toBe(true);
    });

    it('should NOT recognize plain text as a reference', () => {
      expect(isRef('add')).toBe(false);
      expect(isRef('ls')).toBe(false);
      expect(isRef('myname')).toBe(false);
    });

    it('should NOT recognize @ without valid type as a reference', () => {
      expect(isRef('@unknown')).toBe(false);
      expect(isRef('@')).toBe(false);
      expect(isRef('@:')).toBe(false);
    });
  });

  describe('parseRef', () => {
    it('should parse @this correctly', () => {
      const result = parseRef('@this');
      expect(result.type).toBe('this');
      expect(result.raw).toBe('@this');
    });

    it('should parse @last correctly', () => {
      const result = parseRef('@last');
      expect(result.type).toBe('last');
      expect(result.raw).toBe('@last');
    });

    it('should parse @rpc:<id> correctly', () => {
      const result = parseRef('@rpc:abc123');
      expect(result.type).toBe('rpc');
      expect(result.id).toBe('abc123');
      expect(result.raw).toBe('@rpc:abc123');
    });

    it('should parse @session:<id> correctly', () => {
      const result = parseRef('@session:xyz789');
      expect(result.type).toBe('session');
      expect(result.id).toBe('xyz789');
      expect(result.raw).toBe('@session:xyz789');
    });

    it('should parse @ref:<name> correctly', () => {
      const result = parseRef('@ref:myref');
      expect(result.type).toBe('ref');
      expect(result.id).toBe('myref');
      expect(result.raw).toBe('@ref:myref');
    });

    it('should return literal for non-@ strings', () => {
      const result = parseRef('add');
      expect(result.type).toBe('literal');
      expect(result.raw).toBe('add');
    });

    it('should return literal for unknown @ types', () => {
      const result = parseRef('@unknown');
      expect(result.type).toBe('literal');
    });

    it('should return literal for empty ID after colon', () => {
      const result = parseRef('@rpc:');
      expect(result.type).toBe('literal');
    });
  });
});
