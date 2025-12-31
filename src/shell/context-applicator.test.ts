/**
 * Context Applicator tests
 */

import { describe, it, expect } from 'vitest';
import { applyContext, getContextHint } from './context-applicator.js';
import type { ShellContext } from './types.js';

describe('applyContext', () => {
  describe('view command', () => {
    it('should add --connector from context', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['view'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('mcp');
    });

    it('should add --session from context', () => {
      const context: ShellContext = { connector: 'mcp', session: 'abc123' };
      const result = applyContext(['view'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should not override explicit --connector', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['view', '--connector', 'other'], context);
      expect(result.args.filter(a => a === '--connector').length).toBe(1);
      expect(result.args).toContain('other');
      expect(result.args).not.toContain('mcp');
    });

    it('should convert positional to --connector', () => {
      const context: ShellContext = {};
      const result = applyContext(['view', 'yfinance'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('yfinance');
    });

    it('should work with alias v', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['v'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('mcp');
    });
  });

  describe('tree command', () => {
    it('should add connector as positional argument', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['tree'], context);
      expect(result.args).toEqual(['tree', 'mcp']);
    });

    it('should add --session from context', () => {
      const context: ShellContext = { connector: 'mcp', session: 'abc123' };
      const result = applyContext(['tree'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should not add connector if positional already exists', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['tree', 'other'], context);
      expect(result.args).toEqual(['tree', 'other']);
    });

    it('should work with alias t', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['t'], context);
      expect(result.args).toEqual(['t', 'mcp']);
    });
  });

  describe('scan command', () => {
    it('should add --id from context for scan start', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['scan', 'start'], context);
      expect(result.args).toContain('--id');
      expect(result.args).toContain('mcp');
    });

    it('should not override explicit --id', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['scan', 'start', '--id', 'other'], context);
      expect(result.args.filter(a => a === '--id').length).toBe(1);
      expect(result.args).toContain('other');
    });

    it('should work with alias s', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['s', 'start'], context);
      expect(result.args).toContain('--id');
      expect(result.args).toContain('mcp');
    });
  });

  describe('sessions show command', () => {
    it('should add --id from context.session', () => {
      const context: ShellContext = { connector: 'mcp', session: 'abc123' };
      const result = applyContext(['sessions', 'show'], context);
      expect(result.args).toContain('--id');
      expect(result.args).toContain('abc123');
    });

    it('should warn when no session in context', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['sessions', 'show'], context);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('No session');
    });
  });

  describe('rpc command', () => {
    it('should add --session from context for rpc list', () => {
      const context: ShellContext = { session: 'abc123' };
      const result = applyContext(['rpc', 'list'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should add --session from context for rpc show', () => {
      const context: ShellContext = { session: 'abc123' };
      const result = applyContext(['rpc', 'show'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should warn when no session in context', () => {
      const context: ShellContext = {};
      const result = applyContext(['rpc', 'list'], context);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('summary command', () => {
    it('should add --session from context', () => {
      const context: ShellContext = { session: 'abc123' };
      const result = applyContext(['summary'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should warn when no session in context', () => {
      const context: ShellContext = {};
      const result = applyContext(['summary'], context);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('permissions command', () => {
    it('should add --session from context', () => {
      const context: ShellContext = { session: 'abc123' };
      const result = applyContext(['permissions'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });
  });

  describe('events command', () => {
    it('should add --session from context', () => {
      const context: ShellContext = { session: 'abc123' };
      const result = applyContext(['events'], context);
      expect(result.args).toContain('--session');
      expect(result.args).toContain('abc123');
    });

    it('should not warn when no session (events can work without)', () => {
      const context: ShellContext = {};
      const result = applyContext(['events'], context);
      expect(result.warnings.length).toBe(0);
    });
  });

  describe('connectors show command', () => {
    it('should add --id from context.connector', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['connectors', 'show'], context);
      expect(result.args).toContain('--id');
      expect(result.args).toContain('mcp');
    });

    it('should work with connector alias', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['connector', 'show'], context);
      expect(result.args).toContain('--id');
      expect(result.args).toContain('mcp');
    });
  });

  describe('boolean flags handling', () => {
    it('should not skip next arg after --json', () => {
      const context: ShellContext = { connector: 'mcp' };
      // view --json should still add --connector from context
      const result = applyContext(['view', '--json'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('mcp');
    });

    it('should handle --errors boolean flag', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['view', '--errors'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('mcp');
    });

    it('should handle -v verbose flag', () => {
      const context: ShellContext = { connector: 'mcp' };
      const result = applyContext(['view', '-v'], context);
      expect(result.args).toContain('--connector');
      expect(result.args).toContain('mcp');
    });
  });

  describe('no context', () => {
    it('should return args unchanged when no context', () => {
      const context: ShellContext = {};
      const result = applyContext(['view'], context);
      expect(result.args).toEqual(['view']);
    });

    it('should not add warnings for commands that work without context', () => {
      const context: ShellContext = {};
      const result = applyContext(['status'], context);
      expect(result.warnings.length).toBe(0);
    });
  });
});

describe('getContextHint', () => {
  it('should suggest cc when no context', () => {
    const context: ShellContext = {};
    const hint = getContextHint(context);
    expect(hint).toContain('cc');
  });

  it('should suggest session navigation when connector is set', () => {
    const context: ShellContext = { connector: 'mcp' };
    const hint = getContextHint(context);
    expect(hint).toContain('session');
  });

  it('should return empty when full context', () => {
    const context: ShellContext = { connector: 'mcp', session: 'abc123' };
    const hint = getContextHint(context);
    expect(hint).toBe('');
  });
});
