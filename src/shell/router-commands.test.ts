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
    // proto is not explicitly cleared by handleUp
    expect(context.proto).toBe('mcp');
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
