/**
 * Filter Mappers Tests
 */

import { describe, it, expect } from 'vitest';
import { rpcRowToFilterContext, sessionRowToFilterContext } from './filter-mappers.js';
import type { RpcRow, SessionRow } from './pipeline-types.js';

describe('rpcRowToFilterContext', () => {
  const baseRow: RpcRow = {
    rpc_id: 'rpc-123',
    session_id: 'session-456',
    method: 'tools/call',
    status: 'OK',
    latency_ms: 150,
    request_ts: '2025-01-01T00:00:00Z',
    response_ts: '2025-01-01T00:00:00.150Z',
    error_code: null,
    tool_name: 'convert_time',
  };

  it('maps basic RPC fields', () => {
    const ctx = rpcRowToFilterContext(baseRow);

    expect(ctx['rpc.id']).toBe('rpc-123');
    expect(ctx['rpc.method']).toBe('tools/call');
    expect(ctx['rpc.latency']).toBe(150);
    expect(ctx['session.id']).toBe('session-456');
  });

  it('normalizes status to lowercase', () => {
    expect(rpcRowToFilterContext({ ...baseRow, status: 'OK' })['rpc.status']).toBe('ok');
    expect(rpcRowToFilterContext({ ...baseRow, status: 'ERR' })['rpc.status']).toBe('err');
    expect(rpcRowToFilterContext({ ...baseRow, status: 'pending' })['rpc.status']).toBe('pending');
  });

  it('maps tools.name to tool_name (案A)', () => {
    const ctx = rpcRowToFilterContext(baseRow);
    expect(ctx['tools.name']).toBe('convert_time');
  });

  it('maps tools.method to rpc method (案A)', () => {
    const ctx = rpcRowToFilterContext(baseRow);
    expect(ctx['tools.method']).toBe('tools/call');
  });

  it('handles null tool_name', () => {
    const row = { ...baseRow, tool_name: undefined };
    const ctx = rpcRowToFilterContext(row);
    expect(ctx['tools.name']).toBeNull();
  });

  it('handles null latency', () => {
    const row = { ...baseRow, latency_ms: null };
    const ctx = rpcRowToFilterContext(row);
    expect(ctx['rpc.latency']).toBeNull();
  });
});

describe('sessionRowToFilterContext', () => {
  const baseRow: SessionRow = {
    session_id: 'session-789',
    connector_id: 'connector-abc',
    started_at: '2025-01-01T00:00:00Z',
    ended_at: '2025-01-01T01:00:00Z',
    event_count: 100,
    rpc_count: 50,
    total_latency_ms: 5000,
  };

  it('maps session fields', () => {
    const ctx = sessionRowToFilterContext(baseRow);

    expect(ctx['session.id']).toBe('session-789');
    expect(ctx['session.latency']).toBe(5000);
  });

  it('handles undefined total_latency_ms', () => {
    const row = { ...baseRow, total_latency_ms: undefined };
    const ctx = sessionRowToFilterContext(row);
    expect(ctx['session.latency']).toBeNull();
  });
});
