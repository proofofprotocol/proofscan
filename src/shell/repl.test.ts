/**
 * REPL Tests - grep text search functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShellRepl } from './repl.js';

// Mock console methods to avoid noise during tests
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(mockConsole.log);
  vi.spyOn(console, 'error').mockImplementation(mockConsole.error);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSimpleTextSearch', () => {
  it('returns true for simple text without operators', () => {
    // Create a minimal REPL instance to access private method
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('d20')).toBe(true);
    expect(method('hello')).toBe(true);
    expect(method('search text')).toBe(true);
    expect(method('123')).toBe(true);
    expect(method('"quoted text"')).toBe(true);
    expect(method('')).toBe(true);
  });

  it('returns false for filter expressions with == operator', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('rpc.method == "tools/call"')).toBe(false);
    expect(method('status == ok')).toBe(false);
    expect(method('a == b')).toBe(false);
  });

  it('returns false for filter expressions with != operator', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('rpc.status != ok')).toBe(false);
    expect(method('a != b')).toBe(false);
  });

  it('returns false for filter expressions with ~= operator', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('message.content ~= "test"')).toBe(false);
    expect(method('a ~= b')).toBe(false);
  });

  it('returns false for filter expressions with > operator', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('rpc.latency > 100')).toBe(false);
    expect(method('a > b')).toBe(false);
  });

  it('returns false for filter expressions with < operator', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    expect(method('rpc.latency < 100')).toBe(false);
    expect(method('a < b')).toBe(false);
  });

  it('returns true for text containing operators without whitespace context', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    // These contain operators but not with proper whitespace context
    // so they should be treated as simple text search
    expect(method('d20')).toBe(true);
    expect(method('5==5')).toBe(true); // No whitespace around ==
    expect(method('<script>')).toBe(true); // < is part of word
    expect(method('a!=b')).toBe(true); // No whitespace around !=
    expect(method('x>y')).toBe(true); // No whitespace around >
  });

  it('returns false for operators with proper whitespace', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    // These have proper whitespace context
    expect(method('field == value')).toBe(false);
    expect(method('x != y')).toBe(false);
    expect(method('a > 5')).toBe(false);
    expect(method('b < 10')).toBe(false);
    expect(method('== value')).toBe(false); // Operator at start
    expect(method('field ==')).toBe(false); // Operator at end
  });
});

describe('textToFilterExpr', () => {
  it('converts simple text to message.content filter for a2a-message', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('d20', 'a2a-message')).toBe('message.content ~= "d20"');
    expect(method('hello world', 'a2a-message')).toBe('message.content ~= "hello world"');
    expect(method('"test"', 'a2a-message')).toBe('message.content ~= "\\"test\\""');
  });

  it('converts simple text to rpc.method filter for rpc', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('tools/call', 'rpc')).toBe('rpc.method ~= "tools/call"');
    expect(method('read', 'rpc')).toBe('rpc.method ~= "read"');
  });

  it('converts simple text to session.id filter for session', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('abc123', 'session')).toBe('session.id ~= "abc123"');
    expect(method('test-session', 'session')).toBe('session.id ~= "test-session"');
  });

  it('defaults to message.content filter for unknown row type', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('test', 'unknown')).toBe('message.content ~= "test"');
    expect(method('test', 'connector')).toBe('message.content ~= "test"');
  });

  it('escapes quotes in text', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('say "hello"', 'a2a-message')).toBe('message.content ~= "say \\"hello\\""');
  });

  it('escapes backslashes before quotes', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    // Backslash should be escaped first
    expect(method('path\\to\\file', 'a2a-message')).toBe('message.content ~= "path\\\\to\\\\file"');
    // Backslash followed by quote
    expect(method('test\\"value', 'a2a-message')).toBe('message.content ~= "test\\\\\\"value"');
  });

  it('trims whitespace from text', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('  d20  ', 'a2a-message')).toBe('message.content ~= "d20"');
    expect(method('  hello  world  ', 'a2a-message')).toBe('message.content ~= "hello  world"');
  });
});
