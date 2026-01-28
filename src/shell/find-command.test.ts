/**
 * Find Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFindArgs, executeFind, type FindOptions } from './find-command.js';
import type { ShellContext } from './types.js';
import type { RpcRow, SessionRow } from './pipeline-types.js';

// Mock EventLineStore
vi.mock('../eventline/store.js', () => ({
  EventLineStore: vi.fn().mockImplementation(() => ({
    getConnectors: vi.fn(() => [
      { id: 'conn-1', session_count: 2 },
      { id: 'conn-2', session_count: 1 },
    ]),
    getSessions: vi.fn((connectorId?: string, limit?: number) => {
      if (connectorId === 'conn-1') {
        return [
          { session_id: 'session-1', started_at: '2025-01-01T00:00:00Z', event_count: 10, rpc_count: 5 },
          { session_id: 'session-2', started_at: '2025-01-01T01:00:00Z', event_count: 20, rpc_count: 10 },
        ];
      }
      if (connectorId === 'conn-2') {
        return [
          { session_id: 'session-3', started_at: '2025-01-01T02:00:00Z', event_count: 15, rpc_count: 7 },
        ];
      }
      // All sessions (no connector filter)
      return [
        { session_id: 'session-1', started_at: '2025-01-01T00:00:00Z', event_count: 10, rpc_count: 5 },
        { session_id: 'session-2', started_at: '2025-01-01T01:00:00Z', event_count: 20, rpc_count: 10 },
        { session_id: 'session-3', started_at: '2025-01-01T02:00:00Z', event_count: 15, rpc_count: 7 },
      ];
    }),
    getRpcCalls: vi.fn((sessionId: string) => {
      if (sessionId === 'session-1') {
        return [
          { rpc_id: 'rpc-1', session_id: 'session-1', method: 'tools/call', success: 1, request_ts: '2025-01-01T00:00:00Z', response_ts: '2025-01-01T00:00:00.100Z' },
          { rpc_id: 'rpc-2', session_id: 'session-1', method: 'tools/list', success: 1, request_ts: '2025-01-01T00:00:01Z', response_ts: '2025-01-01T00:00:01.050Z' },
        ];
      }
      if (sessionId === 'session-2') {
        return [
          { rpc_id: 'rpc-3', session_id: 'session-2', method: 'initialize', success: 1, request_ts: '2025-01-01T01:00:00Z', response_ts: '2025-01-01T01:00:00.200Z' },
          { rpc_id: 'rpc-4', session_id: 'session-2', method: 'tools/call', success: 0, request_ts: '2025-01-01T01:00:01Z', response_ts: '2025-01-01T01:00:01.300Z', error_code: -32000 },
        ];
      }
      if (sessionId === 'session-3') {
        return [
          { rpc_id: 'rpc-5', session_id: 'session-3', method: 'tools/call', success: 1, request_ts: '2025-01-01T02:00:00Z', response_ts: '2025-01-01T02:00:00.150Z' },
        ];
      }
      return [];
    }),
    getRawEvent: vi.fn((sessionId: string, rpcId: string) => {
      if (rpcId === 'rpc-1') {
        return { request: { raw_json: '{"method":"tools/call","params":{"name":"read_file"}}' } };
      }
      if (rpcId === 'rpc-4') {
        return { request: { raw_json: '{"method":"tools/call","params":{"name":"write_file"}}' } };
      }
      if (rpcId === 'rpc-5') {
        return { request: { raw_json: '{"method":"tools/call","params":{"name":"search"}}' } };
      }
      return null;
    }),
  })),
}));

// Mock ConfigManager
vi.mock('../config/index.js', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    getConfigDir: vi.fn(() => '/mock/config'),
  })),
}));

describe('parseFindArgs', () => {
  describe('kind parsing', () => {
    it('parses session kind', () => {
      const result = parseFindArgs(['session']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.kind).toBe('session');
      }
    });

    it('parses rpc kind', () => {
      const result = parseFindArgs(['rpc']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.kind).toBe('rpc');
      }
    });

    it('parses event kind', () => {
      const result = parseFindArgs(['event']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.kind).toBe('event');
      }
    });

    it('rejects invalid kind', () => {
      const result = parseFindArgs(['invalid']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Invalid kind');
      }
    });

    it('shows help with no args', () => {
      const result = parseFindArgs([]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('find - cross-session search');
        expect('help' in result && result.help).toBe(true);
      }
    });

    it('shows help with -h flag', () => {
      const result = parseFindArgs(['-h']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('find - cross-session search');
        expect('help' in result && result.help).toBe(true);
      }
    });

    it('shows help with --help flag', () => {
      const result = parseFindArgs(['--help']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Usage: find <kind>');
        expect('help' in result && result.help).toBe(true);
      }
    });
  });

  describe('option parsing', () => {
    it('parses --limit option', () => {
      const result = parseFindArgs(['rpc', '--limit', '100']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.limit).toBe(100);
      }
    });

    it('parses --sessions option', () => {
      const result = parseFindArgs(['rpc', '--sessions', '25']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.sessions).toBe(25);
      }
    });

    it('parses --errors-only flag', () => {
      const result = parseFindArgs(['rpc', '--errors-only']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.errorsOnly).toBe(true);
      }
    });

    it('parses multiple options', () => {
      const result = parseFindArgs(['rpc', '--limit', '50', '--sessions', '10', '--errors-only']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.limit).toBe(50);
        expect(result.options.sessions).toBe(10);
        expect(result.options.errorsOnly).toBe(true);
      }
    });

    it('uses default values', () => {
      const result = parseFindArgs(['rpc']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.limit).toBe(200);
        expect(result.options.sessions).toBe(50);
        expect(result.options.errorsOnly).toBe(false);
      }
    });

    it('rejects --limit without number', () => {
      const result = parseFindArgs(['rpc', '--limit']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--limit requires a number');
      }
    });

    it('rejects --limit with zero', () => {
      const result = parseFindArgs(['rpc', '--limit', '0']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--limit must be a positive number');
      }
    });

    it('rejects --limit with negative number', () => {
      const result = parseFindArgs(['rpc', '--limit', '-5']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--limit must be a positive number');
      }
    });

    it('rejects --sessions without number', () => {
      const result = parseFindArgs(['rpc', '--sessions']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--sessions requires a number');
      }
    });

    it('rejects --sessions with zero', () => {
      const result = parseFindArgs(['rpc', '--sessions', '0']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--sessions must be a positive number');
      }
    });

    it('rejects --sessions with negative number', () => {
      const result = parseFindArgs(['rpc', '--sessions', '-10']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('--sessions must be a positive number');
      }
    });

    it('rejects unknown option', () => {
      const result = parseFindArgs(['rpc', '--unknown']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unknown option');
      }
    });
  });
});

describe('executeFind', () => {
  const configPath = '/mock/config.yaml';

  describe('scope detection', () => {
    it('searches all connectors at root level', () => {
      const context: ShellContext = {};
      const result = executeFind(context, configPath, { kind: 'session', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        // Should include sessions from both connectors
        const rows = result.result.rows as SessionRow[];
        expect(rows.length).toBeGreaterThan(0);
        expect(result.result.rowType).toBe('session');
      }
    });

    it('searches single connector at connector level', () => {
      const context: ShellContext = { connector: 'conn-1' };
      const result = executeFind(context, configPath, { kind: 'session', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as SessionRow[];
        // Should only include sessions from conn-1
        expect(rows.every(r => r.target_id === 'conn-1')).toBe(true);
      }
    });

    it('searches single session at session level', () => {
      const context: ShellContext = { connector: 'conn-1', session: 'session-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as RpcRow[];
        // Should only include RPCs from session-1
        expect(rows.every(r => r.session_id === 'session-1')).toBe(true);
      }
    });
  });

  describe('find session', () => {
    it('returns session rows', () => {
      const context: ShellContext = { connector: 'conn-1' };
      const result = executeFind(context, configPath, { kind: 'session', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rowType).toBe('session');
        const rows = result.result.rows as SessionRow[];
        expect(rows.length).toBe(2);
        expect(rows[0].session_id).toBe('session-1');
        expect(rows[1].session_id).toBe('session-2');
      }
    });
  });

  describe('find rpc', () => {
    it('returns rpc rows from connector scope', () => {
      const context: ShellContext = { connector: 'conn-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rowType).toBe('rpc');
        const rows = result.result.rows as RpcRow[];
        // Should include RPCs from session-1 and session-2
        expect(rows.length).toBe(4);
      }
    });

    it('returns rpc rows from root scope', () => {
      const context: ShellContext = {};
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as RpcRow[];
        // Should include RPCs from all sessions (session-1, session-2, session-3)
        expect(rows.length).toBe(5);
      }
    });

    it('extracts tool_name for tools/call', () => {
      const context: ShellContext = { connector: 'conn-1', session: 'session-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as RpcRow[];
        const toolsCall = rows.find(r => r.method === 'tools/call');
        expect(toolsCall?.tool_name).toBe('read_file');
      }
    });

    it('filters errors only', () => {
      const context: ShellContext = { connector: 'conn-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: true });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as RpcRow[];
        // Only rpc-4 has success: 0 (ERR)
        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe('ERR');
        expect(rows[0].rpc_id).toBe('rpc-4');
      }
    });

    it('calculates latency', () => {
      const context: ShellContext = { connector: 'conn-1', session: 'session-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        const rows = result.result.rows as RpcRow[];
        // rpc-1: 100ms latency
        expect(rows[0].latency_ms).toBe(100);
        // rpc-2: 50ms latency
        expect(rows[1].latency_ms).toBe(50);
      }
    });
  });

  describe('limit handling', () => {
    it('respects limit option', () => {
      const context: ShellContext = {};
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 2, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows.length).toBe(2);
      }
    });

    it('returns stats with count and sessions', () => {
      const context: ShellContext = { connector: 'conn-1' };
      const result = executeFind(context, configPath, { kind: 'rpc', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stats.count).toBe(4);
        expect(result.stats.sessions).toBe(2);
      }
    });
  });

  describe('event kind', () => {
    it('returns not implemented error for event kind', () => {
      const context: ShellContext = {};
      const result = executeFind(context, configPath, { kind: 'event', limit: 200, sessions: 50, errorsOnly: false });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not yet implemented');
      }
    });
  });
});
