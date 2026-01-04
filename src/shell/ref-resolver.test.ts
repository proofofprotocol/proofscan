/**
 * Tests for RefResolver (Phase 4.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRef,
  isRef,
  RefResolver,
  createRefFromContext,
  refToJson,
  refFromJson,
  type RefDataProvider,
  type RefStruct,
} from './ref-resolver.js';
import type { ShellContext } from './types.js';

describe('parseRef', () => {
  it('should parse @this', () => {
    const result = parseRef('@this');
    expect(result.type).toBe('this');
    expect(result.raw).toBe('@this');
  });

  it('should parse @last', () => {
    const result = parseRef('@last');
    expect(result.type).toBe('last');
    expect(result.raw).toBe('@last');
  });

  it('should parse @rpc:<id>', () => {
    const result = parseRef('@rpc:abc123');
    expect(result.type).toBe('rpc');
    expect(result.id).toBe('abc123');
    expect(result.raw).toBe('@rpc:abc123');
  });

  it('should parse @session:<id>', () => {
    const result = parseRef('@session:xyz789');
    expect(result.type).toBe('session');
    expect(result.id).toBe('xyz789');
    expect(result.raw).toBe('@session:xyz789');
  });

  it('should parse @fav:<name>', () => {
    const result = parseRef('@fav:myname');
    expect(result.type).toBe('fav');
    expect(result.id).toBe('myname');
    expect(result.raw).toBe('@fav:myname');
  });

  it('should parse @ref:<name>', () => {
    const result = parseRef('@ref:myref');
    expect(result.type).toBe('ref');
    expect(result.id).toBe('myref');
    expect(result.raw).toBe('@ref:myref');
  });

  it('should return literal for non-@ strings', () => {
    const result = parseRef('myref');
    expect(result.type).toBe('literal');
    expect(result.raw).toBe('myref');
  });

  it('should return literal for unknown @ types', () => {
    const result = parseRef('@unknown:value');
    expect(result.type).toBe('literal');
  });

  it('should return literal for empty id', () => {
    const result = parseRef('@rpc:');
    expect(result.type).toBe('literal');
  });

  it('should parse @popl:<id>', () => {
    const result = parseRef('@popl:01KE4EKCVK');
    expect(result.type).toBe('popl');
    expect(result.id).toBe('01KE4EKCVK');
    expect(result.raw).toBe('@popl:01KE4EKCVK');
  });
});

describe('isRef', () => {
  it('should return true for valid refs', () => {
    expect(isRef('@this')).toBe(true);
    expect(isRef('@last')).toBe(true);
    expect(isRef('@rpc:123')).toBe(true);
    expect(isRef('@session:abc')).toBe(true);
    expect(isRef('@fav:name')).toBe(true);
    expect(isRef('@ref:name')).toBe(true);
    expect(isRef('@popl:01KE4EKCVK')).toBe(true);
  });

  it('should return false for non-refs', () => {
    expect(isRef('myref')).toBe(false);
    expect(isRef('@unknown:value')).toBe(false);
    expect(isRef('@rpc:')).toBe(false);
    expect(isRef('')).toBe(false);
  });
});

describe('RefResolver', () => {
  let mockDataProvider: RefDataProvider;
  let resolver: RefResolver;

  beforeEach(() => {
    mockDataProvider = {
      getLatestSession: vi.fn(),
      getLatestRpc: vi.fn(),
      getRpcById: vi.fn(),
      getSessionByPrefix: vi.fn(),
      getUserRef: vi.fn(),
      getFavorite: vi.fn(),
    };
    resolver = new RefResolver(mockDataProvider);
  });

  describe('resolveThis', () => {
    it('should resolve @this at root level', () => {
      const context: ShellContext = {};
      const result = resolver.resolveThis(context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('context');
      expect(result.ref?.level).toBe('root');
    });

    it('should resolve @this at connector level', () => {
      const context: ShellContext = { connector: 'mcp-server' };
      const result = resolver.resolveThis(context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('connector');
      expect(result.ref?.connector).toBe('mcp-server');
      expect(result.ref?.level).toBe('connector');
    });

    it('should resolve @this at session level', () => {
      const context: ShellContext = {
        connector: 'mcp-server',
        session: 'session-123',
        proto: 'mcp',
      };
      const result = resolver.resolveThis(context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('session');
      expect(result.ref?.connector).toBe('mcp-server');
      expect(result.ref?.session).toBe('session-123');
      expect(result.ref?.proto).toBe('mcp');
      expect(result.ref?.level).toBe('session');
    });
  });

  describe('resolveLast', () => {
    it('should resolve @last to latest RPC at session level', () => {
      const context: ShellContext = {
        connector: 'mcp-server',
        session: 'session-123',
        proto: 'mcp',
      };

      vi.mocked(mockDataProvider.getLatestRpc).mockReturnValue({
        rpc_id: 'rpc-456',
        method: 'tools/call',
      });

      const result = resolver.resolveLast(context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('rpc');
      expect(result.ref?.rpc).toBe('rpc-456');
      expect(result.ref?.session).toBe('session-123');
    });

    it('should resolve @last to latest session at connector level', () => {
      const context: ShellContext = { connector: 'mcp-server' };

      vi.mocked(mockDataProvider.getLatestSession).mockReturnValue({
        session_id: 'session-789',
        connector_id: 'mcp-server',
      });

      const result = resolver.resolveLast(context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('session');
      expect(result.ref?.session).toBe('session-789');
    });

    it('should fail when no RPC calls in session', () => {
      const context: ShellContext = {
        connector: 'mcp-server',
        session: 'session-123',
      };

      vi.mocked(mockDataProvider.getLatestRpc).mockReturnValue(null);

      const result = resolver.resolveLast(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No RPC calls');
    });

    it('should fail when no sessions found', () => {
      const context: ShellContext = { connector: 'mcp-server' };

      vi.mocked(mockDataProvider.getLatestSession).mockReturnValue(null);

      const result = resolver.resolveLast(context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No sessions');
    });
  });

  describe('resolveRpc', () => {
    it('should resolve @rpc:<id>', () => {
      const context: ShellContext = { connector: 'mcp-server' };

      vi.mocked(mockDataProvider.getRpcById).mockReturnValue({
        rpc_id: 'rpc-123',
        session_id: 'session-456',
        method: 'tools/call',
      });

      const result = resolver.resolveRpc('rpc-123', context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('rpc');
      expect(result.ref?.rpc).toBe('rpc-123');
      expect(result.ref?.session).toBe('session-456');
    });

    it('should fail when RPC not found', () => {
      const context: ShellContext = {};

      vi.mocked(mockDataProvider.getRpcById).mockReturnValue(null);

      const result = resolver.resolveRpc('nonexistent', context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('RPC not found');
    });
  });

  describe('resolveSession', () => {
    it('should resolve @session:<id>', () => {
      const context: ShellContext = {};

      vi.mocked(mockDataProvider.getSessionByPrefix).mockReturnValue({
        session_id: 'session-full-id',
        connector_id: 'mcp-server',
      });

      const result = resolver.resolveSession('session', context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('session');
      expect(result.ref?.session).toBe('session-full-id');
      expect(result.ref?.connector).toBe('mcp-server');
    });

    it('should fail when session not found', () => {
      const context: ShellContext = {};

      vi.mocked(mockDataProvider.getSessionByPrefix).mockReturnValue(null);

      const result = resolver.resolveSession('nonexistent', context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });
  });

  describe('resolveUserRef', () => {
    it('should resolve @ref:<name>', () => {
      vi.mocked(mockDataProvider.getUserRef).mockReturnValue({
        kind: 'session',
        connector: 'mcp-server',
        session: 'session-123',
      });

      const result = resolver.resolveUserRef('myref');

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('session');
      expect(result.ref?.connector).toBe('mcp-server');
    });

    it('should fail when ref not found', () => {
      vi.mocked(mockDataProvider.getUserRef).mockReturnValue(null);

      const result = resolver.resolveUserRef('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reference not found');
    });

    it('should resolve @ref:<name> for popl kind', () => {
      vi.mocked(mockDataProvider.getUserRef).mockReturnValue({
        kind: 'popl',
        entry_id: '01KE4EKCVK',
        target: 'popl/01KE4EKCVK',
        captured_at: '2024-01-01T00:00:00.000Z',
      });

      const result = resolver.resolveUserRef('mypopl');

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('popl');
      expect(result.ref?.entry_id).toBe('01KE4EKCVK');
      expect(result.ref?.target).toBe('popl/01KE4EKCVK');
    });
  });

  describe('resolvePopl', () => {
    it('should resolve @popl:<id>', () => {
      const result = resolver.resolvePopl('01KE4EKCVK');

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('popl');
      expect(result.ref?.entry_id).toBe('01KE4EKCVK');
      expect(result.ref?.target).toBe('popl/01KE4EKCVK');
      expect(result.ref?.source).toBe('@popl:01KE4EKCVK');
      expect(result.ref?.captured_at).toBeDefined();
    });

    it('should fail when entry_id is empty', () => {
      const result = resolver.resolvePopl('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('entry ID');
    });
  });

  describe('resolve (unified)', () => {
    it('should resolve @this', () => {
      const context: ShellContext = { connector: 'mcp-server' };
      const result = resolver.resolve('@this', context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('connector');
    });

    it('should resolve @rpc:<id>', () => {
      const context: ShellContext = {};

      vi.mocked(mockDataProvider.getRpcById).mockReturnValue({
        rpc_id: 'rpc-123',
        session_id: 'session-456',
        method: 'tools/call',
      });

      const result = resolver.resolve('@rpc:rpc-123', context);

      expect(result.success).toBe(true);
      expect(result.ref?.rpc).toBe('rpc-123');
    });

    it('should resolve @popl:<id>', () => {
      const context: ShellContext = {};
      const result = resolver.resolve('@popl:01KE4EKCVK', context);

      expect(result.success).toBe(true);
      expect(result.ref?.kind).toBe('popl');
      expect(result.ref?.entry_id).toBe('01KE4EKCVK');
      expect(result.ref?.target).toBe('popl/01KE4EKCVK');
    });

    it('should fail for @popl without id', () => {
      const context: ShellContext = {};
      const result = resolver.resolve('@popl:', context);

      expect(result.success).toBe(false);
    });

    it('should fail for literal strings', () => {
      const context: ShellContext = {};
      const result = resolver.resolve('notaref', context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a valid reference');
    });
  });

  describe('resolveArgs', () => {
    it('should resolve refs in args array', () => {
      const context: ShellContext = { connector: 'mcp-server' };

      vi.mocked(mockDataProvider.getSessionByPrefix).mockReturnValue({
        session_id: 'session-full',
        connector_id: 'mcp-server',
      });

      const { resolved, errors } = resolver.resolveArgs(
        ['--flag', '@session:sess', 'literal'],
        context
      );

      expect(errors).toHaveLength(0);
      expect(resolved).toEqual(['--flag', 'session-full', 'literal']);
    });

    it('should collect errors for failed refs', () => {
      const context: ShellContext = {};

      vi.mocked(mockDataProvider.getRpcById).mockReturnValue(null);

      const { resolved, errors } = resolver.resolveArgs(
        ['@rpc:nonexistent'],
        context
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('RPC not found');
      expect(resolved).toEqual(['@rpc:nonexistent']); // Keep original on error
    });

    it('should resolve @popl:<id> to entry_id', () => {
      const context: ShellContext = {};

      const { resolved, errors } = resolver.resolveArgs(
        ['@popl:01KE4EKCVK'],
        context
      );

      expect(errors).toHaveLength(0);
      expect(resolved).toEqual(['01KE4EKCVK']);
    });
  });
});

describe('createRefFromContext', () => {
  it('should create ref from root context', () => {
    const context: ShellContext = {};
    const ref = createRefFromContext(context);

    expect(ref.kind).toBe('context');
    expect(ref.level).toBe('root');
    expect(ref.captured_at).toBeDefined();
  });

  it('should create ref from connector context', () => {
    const context: ShellContext = { connector: 'mcp-server', proto: 'mcp' };
    const ref = createRefFromContext(context);

    expect(ref.kind).toBe('connector');
    expect(ref.connector).toBe('mcp-server');
    expect(ref.proto).toBe('mcp');
    expect(ref.level).toBe('connector');
  });

  it('should create ref from session context', () => {
    const context: ShellContext = {
      connector: 'mcp-server',
      session: 'session-123',
      proto: 'mcp',
    };
    const ref = createRefFromContext(context);

    expect(ref.kind).toBe('session');
    expect(ref.connector).toBe('mcp-server');
    expect(ref.session).toBe('session-123');
    expect(ref.proto).toBe('mcp');
    expect(ref.level).toBe('session');
  });
});

describe('refToJson / refFromJson', () => {
  it('should serialize and deserialize RefStruct', () => {
    const ref: RefStruct = {
      kind: 'session',
      connector: 'mcp-server',
      session: 'session-123',
      proto: 'mcp',
      level: 'session',
      captured_at: '2024-01-01T00:00:00.000Z',
    };

    const json = refToJson(ref);
    const parsed = refFromJson(json);

    expect(parsed).toEqual(ref);
  });

  it('should return null for invalid JSON', () => {
    expect(refFromJson('not json')).toBeNull();
  });

  it('should return null for missing kind', () => {
    expect(refFromJson('{}')).toBeNull();
  });

  it('should return null for invalid kind', () => {
    expect(refFromJson('{"kind": "invalid"}')).toBeNull();
  });

  it('should parse POPL-style JSON with target', () => {
    const json = '{"kind":"popl","target":"popl/01KE4EKCVK","entry_id":"01KE4EKCVK"}';
    const ref = refFromJson(json);

    expect(ref?.kind).toBe('popl');
    expect(ref?.entry_id).toBe('01KE4EKCVK');
    expect(ref?.target).toBe('popl/01KE4EKCVK');
  });

  it('should infer entry_id from target if missing', () => {
    const json = '{"target":"popl/01KE4EKCVK"}';
    const ref = refFromJson(json);

    expect(ref?.kind).toBe('popl');
    expect(ref?.entry_id).toBe('01KE4EKCVK');
    expect(ref?.target).toBe('popl/01KE4EKCVK');
  });

  it('should serialize and deserialize POPL RefStruct', () => {
    const ref: RefStruct = {
      kind: 'popl',
      entry_id: '01KE4EKCVK',
      target: 'popl/01KE4EKCVK',
      captured_at: '2024-01-01T00:00:00.000Z',
    };

    const json = refToJson(ref);
    const parsed = refFromJson(json);

    expect(parsed).toEqual(ref);
  });
});
