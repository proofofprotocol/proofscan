/**
 * Where Command Tests
 */

import { describe, it, expect } from 'vitest';
import { applyWhere } from './where-command.js';
import type { PipelineValue, RpcRow, SessionRow } from './pipeline-types.js';

const sampleRpcRows: RpcRow[] = [
  {
    rpc_id: 'rpc-1',
    session_id: 'session-1',
    method: 'tools/call',
    status: 'OK',
    latency_ms: 100,
    request_ts: '2025-01-01T00:00:00Z',
    response_ts: '2025-01-01T00:00:00.100Z',
    error_code: null,
    tool_name: 'read_file',
  },
  {
    rpc_id: 'rpc-2',
    session_id: 'session-1',
    method: 'tools/call',
    status: 'ERR',
    latency_ms: 200,
    request_ts: '2025-01-01T00:00:01Z',
    response_ts: '2025-01-01T00:00:01.200Z',
    error_code: -32000,
    tool_name: 'write_file',
  },
  {
    rpc_id: 'rpc-3',
    session_id: 'session-1',
    method: 'initialize',
    status: 'OK',
    latency_ms: 50,
    request_ts: '2025-01-01T00:00:02Z',
    response_ts: '2025-01-01T00:00:02.050Z',
    error_code: null,
  },
  {
    rpc_id: 'rpc-4',
    session_id: 'session-1',
    method: 'tools/list',
    status: 'OK',
    latency_ms: 1500,
    request_ts: '2025-01-01T00:00:03Z',
    response_ts: '2025-01-01T00:00:04.500Z',
    error_code: null,
  },
];

const rpcInput: PipelineValue = {
  kind: 'rows',
  rows: sampleRpcRows,
  rowType: 'rpc',
};

const sampleSessionRows: SessionRow[] = [
  {
    session_id: 'session-1',
    connector_id: 'conn-1',
    started_at: '2025-01-01T00:00:00Z',
    ended_at: '2025-01-01T01:00:00Z',
    event_count: 100,
    rpc_count: 50,
    total_latency_ms: 5000,
  },
  {
    session_id: 'session-2',
    connector_id: 'conn-1',
    started_at: '2025-01-01T02:00:00Z',
    ended_at: '2025-01-01T03:00:00Z',
    event_count: 200,
    rpc_count: 100,
    total_latency_ms: 10000,
  },
];

const sessionInput: PipelineValue = {
  kind: 'rows',
  rows: sampleSessionRows,
  rowType: 'session',
};

describe('applyWhere', () => {
  describe('empty expression', () => {
    it('passes all rows through with empty expression', () => {
      const result = applyWhere(rpcInput, '');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.kind).toBe('rows');
        if (result.result.kind === 'rows') {
          expect(result.result.rows).toHaveLength(4);
        }
        expect(result.stats).toEqual({ matched: 4, total: 4 });
      }
    });

    it('passes all rows through with whitespace only', () => {
      const result = applyWhere(rpcInput, '   ');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stats).toEqual({ matched: 4, total: 4 });
      }
    });
  });

  describe('filter: prefix handling', () => {
    it('strips filter: prefix', () => {
      const result = applyWhere(rpcInput, 'filter: rpc.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(2);
      }
    });

    it('strips FILTER: prefix (case insensitive)', () => {
      const result = applyWhere(rpcInput, 'FILTER: rpc.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(2);
      }
    });
  });

  describe('RPC filtering', () => {
    it('filters by rpc.method equality', () => {
      const result = applyWhere(rpcInput, 'rpc.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(2);
        expect((result.result.rows as RpcRow[]).every((r) => r.method === 'tools/call')).toBe(true);
        expect(result.stats).toEqual({ matched: 2, total: 4 });
      }
    });

    it('filters by rpc.status (case insensitive)', () => {
      const result = applyWhere(rpcInput, 'rpc.status == ok');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(3);
      }
    });

    it('filters by rpc.status inequality', () => {
      const result = applyWhere(rpcInput, 'rpc.status != ok');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        expect((result.result.rows[0] as RpcRow).status).toBe('ERR');
      }
    });

    it('filters by rpc.latency greater than', () => {
      const result = applyWhere(rpcInput, 'rpc.latency > 1000');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        expect((result.result.rows[0] as RpcRow).latency_ms).toBe(1500);
      }
    });

    it('filters by rpc.latency less than', () => {
      const result = applyWhere(rpcInput, 'rpc.latency < 100');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        expect((result.result.rows[0] as RpcRow).latency_ms).toBe(50);
      }
    });

    it('filters by tools.name substring match', () => {
      const result = applyWhere(rpcInput, 'tools.name ~= read');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        expect((result.result.rows[0] as RpcRow).tool_name).toBe('read_file');
      }
    });

    it('filters by tools.method (maps to rpc.method)', () => {
      const result = applyWhere(rpcInput, 'tools.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(2);
      }
    });

    it('handles multiple conditions (implicit AND)', () => {
      const result = applyWhere(rpcInput, 'rpc.method == "tools/call" rpc.status == ok');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        const row = result.result.rows[0] as RpcRow;
        expect(row.method).toBe('tools/call');
        expect(row.status).toBe('OK');
      }
    });

    it('returns empty when no matches', () => {
      const result = applyWhere(rpcInput, 'rpc.method == "nonexistent"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(0);
        expect(result.stats).toEqual({ matched: 0, total: 4 });
      }
    });
  });

  describe('Session filtering', () => {
    it('filters by session.id', () => {
      const result = applyWhere(sessionInput, 'session.id == "session-1"');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
      }
    });

    it('filters by session.latency', () => {
      const result = applyWhere(sessionInput, 'session.latency > 6000');
      expect(result.ok).toBe(true);
      if (result.ok && result.result.kind === 'rows') {
        expect(result.result.rows).toHaveLength(1);
        expect((result.result.rows[0] as SessionRow).session_id).toBe('session-2');
      }
    });
  });

  describe('error cases', () => {
    it('reports unknown field', () => {
      const result = applyWhere(rpcInput, 'invalid.field == "test"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unknown field 'invalid.field'");
        expect(result.position).toBe(0);
      }
    });

    it('reports missing operator', () => {
      const result = applyWhere(rpcInput, 'rpc.method "test"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Expected operator');
      }
    });

    it('reports missing value', () => {
      const result = applyWhere(rpcInput, 'rpc.method ==');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Expected value');
      }
    });

    it('reports unterminated string', () => {
      const result = applyWhere(rpcInput, 'rpc.method == "unterminated');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unterminated string');
      }
    });

    it('rejects text input', () => {
      const textInput: PipelineValue = { kind: 'text', text: 'some text' };
      const result = applyWhere(textInput, 'rpc.method == "test"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('where expects rows');
      }
    });

    it('rejects unsupported row type', () => {
      const connectorInput: PipelineValue = {
        kind: 'rows',
        rows: [],
        rowType: 'connector',
      };
      const result = applyWhere(connectorInput, 'rpc.method == "test"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unsupported row type: connector');
      }
    });
  });
});
