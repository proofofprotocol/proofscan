/**
 * Tests for command-resolver.ts
 */

import { describe, it, expect } from 'vitest';
import { resolveCommand, canAbbreviate, getCanonicalCommand } from './command-resolver.js';
import type { ShellContext } from './types.js';

describe('command-resolver', () => {
  describe('resolveCommand', () => {
    describe('empty input', () => {
      it('should return success with empty resolved for empty tokens', () => {
        const context: ShellContext = {};
        const result = resolveCommand([], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual([]);
        expect(result.original).toEqual([]);
      });
    });

    describe('passthrough commands', () => {
      it('should pass through shell builtins unchanged', () => {
        const context: ShellContext = {};
        const builtins = ['use', 'reset', 'pwd', 'help', 'exit', 'quit', 'clear'];

        for (const cmd of builtins) {
          const result = resolveCommand([cmd], context);
          expect(result.success).toBe(true);
          expect(result.resolved).toEqual([cmd]);
        }
      });

      it('should pass through router commands unchanged', () => {
        const context: ShellContext = {};
        const routerCmds = ['cc', 'cd', 'ls', 'show', '..'];

        for (const cmd of routerCmds) {
          const result = resolveCommand([cmd, 'arg'], context);
          expect(result.success).toBe(true);
          expect(result.resolved).toEqual([cmd, 'arg']);
        }
      });

      it('should pass through tool commands unchanged', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['tool', 'ls'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['tool', 'ls']);
      });

      it('should pass through ref commands unchanged', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['ref', 'add', 'name'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['ref', 'add', 'name']);
      });

      it('should pass through inscribe commands unchanged', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['inscribe', '@rpc:1'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['inscribe', '@rpc:1']);
      });
    });

    describe('unique prefix matching', () => {
      it('should resolve exact command match', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['connectors', 'list'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'list']);
      });

      it('should resolve unique prefix to full command', () => {
        const context: ShellContext = {};

        // "archi" is unique prefix for "archive"
        const result = resolveCommand(['archi', 'run'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['archive', 'run']);
      });

      it('should resolve "conn" prefix to connectors (unique match)', () => {
        const context: ShellContext = {};
        // "conn" uniquely matches "connectors" (no "connector" alias)
        const result = resolveCommand(['conn', 'list'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'list']);
      });

      it('should return error for ambiguous prefix', () => {
        const context: ShellContext = {};

        // "con" matches both "config" and "connectors"
        const result = resolveCommand(['con', 'ls'], context);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Ambiguous');
        expect(result.candidates).toContain('config');
        expect(result.candidates).toContain('connectors');
      });

      it('should resolve "v" prefix to view', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['v'], context);
        expect(result.success).toBe(true);
        // "v" is an exact match for the alias
        expect(result.resolved).toEqual(['v']);
      });

      it('should resolve "tre" prefix to tree', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['tre'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['tree']);
      });

      it('should resolve "catal" prefix to catalog', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['catal', 'search', 'time'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['catalog', 'search', 'time']);
      });

      it('should resolve "cat" exactly to cat alias', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['cat', 'view', 'mcp-server-time'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['cat', 'view', 'mcp-server-time']);
      });

      it('should resolve "cat se" to "cat search" (subcommand prefix)', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['cat', 'se', 'time'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['cat', 'search', 'time']);
      });

      it('should resolve "catalog v" to "catalog view" (subcommand prefix)', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['catalog', 'v', 'server', 'version'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['catalog', 'view', 'server', 'version']);
      });

      it('should pass through unknown commands', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['unknown', 'arg'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['unknown', 'arg']);
      });
    });

    describe('subcommand prefix matching', () => {
      it('should resolve subcommand prefix', () => {
        const context: ShellContext = {};

        // "connectors del" -> "connectors delete"
        const result = resolveCommand(['connectors', 'del'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'delete']);
      });

      it('should resolve exact subcommand match', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['connectors', 'list'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'list']);
      });

      it('should return error for ambiguous subcommand', () => {
        const context: ShellContext = {};

        // "connectors li" -> ambiguous (list vs... actually only list starts with "li")
        // Let's try "d" which matches "delete" and "disable"
        const result = resolveCommand(['connectors', 'd'], context);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Ambiguous');
        expect(result.candidates).toContain('delete');
        expect(result.candidates).toContain('disable');
      });

      it('should pass through remaining args after subcommand', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['connectors', 'del', 'myconnector', '--force'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'delete', 'myconnector', '--force']);
      });
    });

    describe('context expansion at root', () => {
      it('should expand connectors subcommands at root level', () => {
        const context: ShellContext = {}; // root level

        // "delete foo" at root -> "connectors delete foo"
        const result = resolveCommand(['delete', 'foo'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'delete', 'foo']);
      });

      it('should expand "add" to "connectors add" at root', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['add', 'myconn', '--stdio', 'cmd'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'add', 'myconn', '--stdio', 'cmd']);
      });

      it('should expand "enable" to "connectors enable" at root', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['enable', '--id', 'myconn'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'enable', '--id', 'myconn']);
      });

      it('should expand "disable" to "connectors disable" at root', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['disable', '--id', 'myconn'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'disable', '--id', 'myconn']);
      });

      it('should expand "import" to "connectors import" at root', () => {
        const context: ShellContext = {};
        const result = resolveCommand(['import', '--from', 'mcpServers'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'import', '--from', 'mcpServers']);
      });
    });

    describe('context expansion NOT at connector/session level', () => {
      it('should NOT expand connectors subcommands in connector context', () => {
        const context: ShellContext = { connector: 'myconnector' };

        // "delete" in connector context should pass through (not expand)
        const result = resolveCommand(['delete', 'foo'], context);
        expect(result.success).toBe(true);
        // "delete" is not a top-level command, so it passes through unchanged
        expect(result.resolved).toEqual(['delete', 'foo']);
      });

      it('should NOT expand connectors subcommands in session context', () => {
        const context: ShellContext = { connector: 'myconnector', session: 'session123' };

        const result = resolveCommand(['delete', 'foo'], context);
        expect(result.success).toBe(true);
        // Should NOT be expanded to connectors delete
        expect(result.resolved).toEqual(['delete', 'foo']);
      });

      it('should allow fully qualified connectors command in connector context', () => {
        const context: ShellContext = { connector: 'myconnector' };

        // "connectors delete foo" should still work
        const result = resolveCommand(['connectors', 'delete', 'foo'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'delete', 'foo']);
      });
    });

    describe('combined prefix matching and context expansion', () => {
      it('should NOT expand abbreviated subcommand at root (only exact matches)', () => {
        const context: ShellContext = {}; // root level

        // "del" is NOT an exact match for "delete" in CONNECTORS_SUBCOMMANDS
        // so context expansion does NOT happen
        // "del" is then checked against TOP_LEVEL_COMMANDS but doesn't match
        // so it passes through unchanged
        const result = resolveCommand(['del', 'foo'], context);
        expect(result.success).toBe(true);
        // Not expanded because "del" != "delete"
        expect(result.resolved).toEqual(['del', 'foo']);
      });

      it('should expand exact subcommand match at root', () => {
        const context: ShellContext = {}; // root level

        // "delete foo" at root -> "connectors delete foo"
        const result = resolveCommand(['delete', 'foo'], context);
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['connectors', 'delete', 'foo']);
      });
    });

    describe('edge cases', () => {
      it('should handle single token that matches multiple top-level aliases', () => {
        const context: ShellContext = {};

        // "s" could be scan or status or secrets
        const result = resolveCommand(['s'], context);
        // "s" is an exact match for the scan alias, so it should succeed
        expect(result.success).toBe(true);
        expect(result.resolved).toEqual(['s']);
      });

      it('should preserve original tokens in result', () => {
        const context: ShellContext = {};
        // Using fully expanded command to test original preservation
        const result = resolveCommand(['connectors', 'delete', 'test'], context);
        expect(result.original).toEqual(['connectors', 'delete', 'test']);
        expect(result.resolved).toEqual(['connectors', 'delete', 'test']);
      });

      it('should preserve original tokens when prefix resolved', () => {
        const context: ShellContext = {};
        // Using unique prefix "tre" for "tree"
        const result = resolveCommand(['tre', '--ids'], context);
        expect(result.original).toEqual(['tre', '--ids']);
        expect(result.resolved).toEqual(['tree', '--ids']);
      });
    });
  });

  describe('canAbbreviate', () => {
    it('should return true when input is prefix of full command', () => {
      expect(canAbbreviate('conn', 'connectors')).toBe(true);
      expect(canAbbreviate('del', 'delete')).toBe(true);
    });

    it('should return false for exact match', () => {
      expect(canAbbreviate('connectors', 'connectors')).toBe(false);
    });

    it('should return false when input is not a prefix', () => {
      expect(canAbbreviate('xyz', 'connectors')).toBe(false);
      expect(canAbbreviate('connectorsx', 'connectors')).toBe(false);
    });
  });

  describe('getCanonicalCommand', () => {
    it('should return full command for unique prefix', () => {
      const candidates = ['connectors', 'config', 'scan'];
      expect(getCanonicalCommand('conn', candidates)).toBe('connectors');
      expect(getCanonicalCommand('sc', candidates)).toBe('scan');
    });

    it('should return input for ambiguous prefix', () => {
      const candidates = ['connectors', 'config', 'scan'];
      // "con" matches both connectors and config
      expect(getCanonicalCommand('con', candidates)).toBe('con');
    });

    it('should return input for no match', () => {
      const candidates = ['connectors', 'config', 'scan'];
      expect(getCanonicalCommand('xyz', candidates)).toBe('xyz');
    });

    it('should return exact match', () => {
      const candidates = ['connectors', 'config', 'scan'];
      expect(getCanonicalCommand('connectors', candidates)).toBe('connectors');
    });
  });
});
