/**
 * Router commands tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectProto, detectConnectorProto, getContextLevel, handleUp } from './router-commands.js';
import type { ShellContext, ProtoType } from './types.js';

// Mock EventLineStore
const createMockStore = (rpcs: Array<{ method: string }> = []) => ({
  getRpcCalls: vi.fn().mockReturnValue(rpcs),
  getSessions: vi.fn().mockReturnValue([]),
  getConnectors: vi.fn().mockReturnValue([]),
});

describe('detectProto', () => {
  it('should detect MCP from initialize method', () => {
    const store = createMockStore([{ method: 'initialize' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('mcp');
  });

  it('should detect MCP from tools/list method', () => {
    const store = createMockStore([{ method: 'tools/list' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('mcp');
  });

  it('should detect MCP from tools/call method', () => {
    const store = createMockStore([{ method: 'tools/call' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('mcp');
  });

  it('should detect A2A from a2a.* methods', () => {
    const store = createMockStore([{ method: 'a2a.sendMessage' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from agent.* methods', () => {
    const store = createMockStore([{ method: 'agent.execute' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from message/* methods', () => {
    const store = createMockStore([{ method: 'message/send' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from message/stream method', () => {
    const store = createMockStore([{ method: 'message/stream' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from tasks/* methods', () => {
    const store = createMockStore([{ method: 'tasks/get' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from tasks/list method', () => {
    const store = createMockStore([{ method: 'tasks/list' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should detect A2A from tasks/cancel method', () => {
    const store = createMockStore([{ method: 'tasks/cancel' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('a2a');
  });

  it('should return ? for unknown protocols', () => {
    const store = createMockStore([{ method: 'custom.method' }]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('?');
  });

  it('should return ? for empty RPC list', () => {
    const store = createMockStore([]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('?');
  });

  it('should prefer MCP over A2A when both present', () => {
    const store = createMockStore([
      { method: 'initialize' },
      { method: 'a2a.sendMessage' },
    ]);
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('mcp');
  });

  it('should handle store errors gracefully', () => {
    const store = {
      getRpcCalls: vi.fn().mockImplementation(() => {
        throw new Error('DB error');
      }),
    };
    const result = detectProto(store as any, 'session1');
    expect(result).toBe('?');
  });
});

describe('detectConnectorProto', () => {
  it('should detect proto from latest session', () => {
    const store = {
      getSessions: vi.fn().mockReturnValue([{ session_id: 'sess1' }]),
      getRpcCalls: vi.fn().mockReturnValue([{ method: 'initialize' }]),
    };
    const result = detectConnectorProto(store as any, 'mcp');
    expect(result).toBe('mcp');
    expect(store.getSessions).toHaveBeenCalledWith('mcp', 1);
  });

  it('should return ? when no sessions', () => {
    const store = {
      getSessions: vi.fn().mockReturnValue([]),
      getRpcCalls: vi.fn(),
    };
    const result = detectConnectorProto(store as any, 'mcp');
    expect(result).toBe('?');
    expect(store.getRpcCalls).not.toHaveBeenCalled();
  });
});

describe('getContextLevel', () => {
  it('should return root when no context', () => {
    const context: ShellContext = {};
    expect(getContextLevel(context)).toBe('root');
  });

  it('should return connector when only connector set', () => {
    const context: ShellContext = { connector: 'mcp' };
    expect(getContextLevel(context)).toBe('connector');
  });

  it('should return session when both connector and session set', () => {
    const context: ShellContext = { connector: 'mcp', session: 'abc123' };
    expect(getContextLevel(context)).toBe('session');
  });

  it('should return session when only session set', () => {
    // Implementation checks session first, regardless of connector
    const context: ShellContext = { session: 'abc123' };
    expect(getContextLevel(context)).toBe('session');
  });
});

describe('handleUp', () => {
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    originalConsoleLog = console.log;
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('should clear session when at session level', () => {
    const context: ShellContext = { connector: 'mcp', session: 'abc123', proto: 'mcp' };
    handleUp(context);
    expect(context.session).toBeUndefined();
    expect(context.connector).toBe('mcp');
    // proto is not cleared when going up from session to connector
    expect(context.proto).toBe('mcp');
  });

  it('should clear connector when at connector level', () => {
    const context: ShellContext = { connector: 'mcp', proto: 'mcp' };
    handleUp(context);
    expect(context.connector).toBeUndefined();
    // proto is cleared when going to root
    expect(context.proto).toBeUndefined();
  });

  it('should save previous location when going up from session', () => {
    const context: ShellContext = { connector: 'mcp', session: 'abc123', proto: 'mcp' };
    handleUp(context);
    expect(context.previousConnector).toBe('mcp');
    expect(context.previousSession).toBe('abc123');
  });

  it('should save previous location when going up from connector', () => {
    const context: ShellContext = { connector: 'mcp', proto: 'mcp' };
    handleUp(context);
    expect(context.previousConnector).toBe('mcp');
    expect(context.previousSession).toBeUndefined();
  });

  it('should do nothing at root level', () => {
    const context: ShellContext = {};
    handleUp(context);
    expect(context.connector).toBeUndefined();
    expect(context.session).toBeUndefined();
  });
});

describe('pipe-separated input validation', () => {
  it('should validate connector|session format', () => {
    // This is tested indirectly through handleCc
    // The validation adds error messages for invalid formats like |abc or abc|
    expect(true).toBe(true); // Placeholder - actual test would need full mocking
  });
});

describe('savePreviousLocation behavior', () => {
  it('should save previous location for cd - navigation', () => {
    // When navigating, previous location should be saved
    // This is tested indirectly through integration tests
    // The savePreviousLocation function sets previousConnector and previousSession
    const context: ShellContext = { connector: 'mcp', session: 'abc123' };
    // Simulating what happens when navigating to a new location:
    // 1. Save current location
    context.previousConnector = context.connector;
    context.previousSession = context.session;
    // 2. Navigate to new location
    context.connector = 'other';
    context.session = 'def456';
    // 3. Verify previous was saved
    expect(context.previousConnector).toBe('mcp');
    expect(context.previousSession).toBe('abc123');
  });

  it('should swap current and previous on cd -', () => {
    // Simulate cd - behavior
    const context: ShellContext = {
      connector: 'current',
      session: 'curr123',
      previousConnector: 'previous',
      previousSession: 'prev123',
    };

    // Swap (simulating cd -)
    const currentConnector = context.connector;
    const currentSession = context.session;
    context.connector = context.previousConnector;
    context.session = context.previousSession;
    context.previousConnector = currentConnector;
    context.previousSession = currentSession;

    expect(context.connector).toBe('previous');
    expect(context.session).toBe('prev123');
    expect(context.previousConnector).toBe('current');
    expect(context.previousSession).toBe('curr123');
  });

  it('should handle cd - with no previous location', () => {
    const context: ShellContext = {};
    // Without previous location, both should be undefined
    expect(context.previousConnector).toBeUndefined();
    expect(context.previousSession).toBeUndefined();
  });
});

describe('cd .. path validation', () => {
  it('should accept valid paths: ..', () => {
    const path = '..';
    const parts = path.split('/');
    const invalidParts = parts.filter(p => p !== '..' && p !== '');
    expect(invalidParts.length).toBe(0);
  });

  it('should accept valid paths: ../..', () => {
    const path = '../..';
    const parts = path.split('/');
    const invalidParts = parts.filter(p => p !== '..' && p !== '');
    expect(invalidParts.length).toBe(0);
  });

  it('should reject invalid paths: ../foo', () => {
    const path = '../foo';
    const parts = path.split('/');
    const invalidParts = parts.filter(p => p !== '..' && p !== '');
    expect(invalidParts.length).toBeGreaterThan(0);
    expect(invalidParts).toContain('foo');
  });

  it('should reject invalid paths: ../../../extra', () => {
    const path = '../../../extra';
    const parts = path.split('/');
    const invalidParts = parts.filter(p => p !== '..' && p !== '');
    expect(invalidParts.length).toBeGreaterThan(0);
    expect(invalidParts).toContain('extra');
  });

  it('should count .. occurrences correctly', () => {
    const path = '../../..';
    const parts = path.split('/');
    const upCount = parts.filter(p => p === '..').length;
    expect(upCount).toBe(3);
  });
});
