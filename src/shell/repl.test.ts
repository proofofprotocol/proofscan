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

  it('returns true for text containing partial operator strings', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['isSimpleTextSearch'] as (expr: string) => boolean;

    // 'd20' contains '>' character but that's part of 'd20', not the operator
    expect(method('d20')).toBe(true);
    // '5==5' contains '==' as part of the text (edge case)
    expect(method('5==5')).toBe(false);
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

  it('trims whitespace from text', () => {
    const repl = new ShellRepl('/tmp/test-config.json');
    const method = repl['textToFilterExpr'] as (text: string, rowType: string) => string;

    expect(method('  d20  ', 'a2a-message')).toBe('message.content ~= "d20"');
    expect(method('  hello  world  ', 'a2a-message')).toBe('message.content ~= "hello  world"');
  });
});
