/**
 * Tests for analytics computation (Phase 5.2)
 */

import { describe, it, expect } from 'vitest';
import {
  computeConnectorAnalytics,
  LATENCY_BUCKETS,
  P95_MIN_SAMPLES,
} from './analytics.js';
import type {
  HtmlSessionReportV1,
  SessionRpcDetail,
  PayloadData,
} from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createPayload(size: number = 100): PayloadData {
  return {
    json: { test: 'data' },
    size,
    truncated: false,
    preview: null,
  };
}

function createRpc(overrides: Partial<SessionRpcDetail> = {}): SessionRpcDetail {
  return {
    rpc_id: 'rpc-001',
    method: 'test/method',
    status: 'OK',
    latency_ms: 50,
    request_ts: '2024-01-15T10:00:00.000Z',
    response_ts: '2024-01-15T10:00:00.050Z',
    error_code: null,
    request: createPayload(),
    response: createPayload(),
    ...overrides,
  };
}

function createSessionReport(rpcs: SessionRpcDetail[]): HtmlSessionReportV1 {
  return {
    meta: {
      schemaVersion: 1,
      generatedAt: '2024-01-15T12:00:00.000Z',
      generatedBy: 'proofscan v0.1.0',
      redacted: false,
    },
    session: {
      session_id: 'session-001',
      connector_id: 'test-connector',
      started_at: '2024-01-15T10:00:00.000Z',
      ended_at: '2024-01-15T11:00:00.000Z',
      exit_reason: null,
      rpc_count: rpcs.length,
      event_count: rpcs.length * 2,
      total_latency_ms: rpcs.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0),
    },
    rpcs,
  };
}

// ============================================================================
// KPI Tests
// ============================================================================

describe('computeConnectorAnalytics - KPIs', () => {
  it('counts status correctly (OK/ERR/PENDING)', () => {
    const rpcs = [
      createRpc({ status: 'OK' }),
      createRpc({ status: 'OK' }),
      createRpc({ status: 'ERR' }),
      createRpc({ status: 'PENDING' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.rpc_total).toBe(4);
    expect(result.kpis.rpc_ok).toBe(2);
    expect(result.kpis.rpc_err).toBe(1);
    expect(result.kpis.rpc_pending).toBe(1);
  });

  it('calculates average latency correctly', () => {
    const rpcs = [
      createRpc({ latency_ms: 10 }),
      createRpc({ latency_ms: 20 }),
      createRpc({ latency_ms: 30 }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.avg_latency_ms).toBe(20); // (10+20+30)/3 = 20
  });

  it('returns null for avg_latency_ms when no RPCs have latency', () => {
    const rpcs = [
      createRpc({ latency_ms: null }),
      createRpc({ latency_ms: null }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.avg_latency_ms).toBeNull();
  });

  it('calculates P95 latency with nearest-rank method when n >= 20', () => {
    // Create 20 RPCs with latencies 1-20
    const rpcs = Array.from({ length: 20 }, (_, i) =>
      createRpc({ latency_ms: i + 1, rpc_id: `rpc-${i}` })
    );
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    // P95 with nearest-rank: k = ceil(0.95 * 20) = 19, sorted[18] = 19
    expect(result.kpis.p95_latency_ms).toBe(19);
  });

  it('returns null for P95 when n < 20', () => {
    const rpcs = Array.from({ length: 19 }, (_, i) =>
      createRpc({ latency_ms: i + 1, rpc_id: `rpc-${i}` })
    );
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.p95_latency_ms).toBeNull();
  });

  it('calculates max latency correctly', () => {
    const rpcs = [
      createRpc({ latency_ms: 10 }),
      createRpc({ latency_ms: 100 }),
      createRpc({ latency_ms: 50 }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.max_latency_ms).toBe(100);
  });

  it('sums request and response bytes correctly', () => {
    const rpcs = [
      createRpc({
        request: createPayload(100),
        response: createPayload(200),
      }),
      createRpc({
        request: createPayload(150),
        response: createPayload(250),
      }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.total_request_bytes).toBe(250); // 100 + 150
    expect(result.kpis.total_response_bytes).toBe(450); // 200 + 250
  });

  it('extracts top tool from top_tools', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', request: { json: { params: { name: 'read_file' } }, size: 100, truncated: false, preview: null } }),
      createRpc({ method: 'tools/call', request: { json: { params: { name: 'read_file' } }, size: 100, truncated: false, preview: null } }),
      createRpc({ method: 'tools/call', request: { json: { params: { name: 'write_file' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.kpis.top_tool_name).toBe('read_file');
    expect(result.kpis.top_tool_calls).toBe(2);
  });
});

// ============================================================================
// Heatmap Tests
// ============================================================================

describe('computeConnectorAnalytics - Heatmap', () => {
  it('groups RPCs by UTC date', () => {
    const rpcs = [
      createRpc({ request_ts: '2024-01-15T10:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-15T23:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-16T05:00:00.000Z' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.heatmap.start_date).toBe('2024-01-15');
    expect(result.heatmap.end_date).toBe('2024-01-16');
    expect(result.heatmap.cells.length).toBe(2); // 2 days
    expect(result.heatmap.cells[0]).toEqual({ date: '2024-01-15', count: 2 });
    expect(result.heatmap.cells[1]).toEqual({ date: '2024-01-16', count: 1 });
  });

  it('fills gaps with count=0 days', () => {
    const rpcs = [
      createRpc({ request_ts: '2024-01-15T10:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-18T10:00:00.000Z' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.heatmap.cells.length).toBe(4); // 15, 16, 17, 18
    expect(result.heatmap.cells[0]).toEqual({ date: '2024-01-15', count: 1 });
    expect(result.heatmap.cells[1]).toEqual({ date: '2024-01-16', count: 0 });
    expect(result.heatmap.cells[2]).toEqual({ date: '2024-01-17', count: 0 });
    expect(result.heatmap.cells[3]).toEqual({ date: '2024-01-18', count: 1 });
  });

  it('calculates max_count correctly', () => {
    const rpcs = [
      createRpc({ request_ts: '2024-01-15T10:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-15T11:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-15T12:00:00.000Z' }),
      createRpc({ request_ts: '2024-01-16T10:00:00.000Z' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.heatmap.max_count).toBe(3);
  });

  it('handles empty RPCs gracefully', () => {
    const sessionReports = { 'session-001': createSessionReport([]) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.heatmap.cells.length).toBe(1);
    expect(result.heatmap.cells[0].count).toBe(0);
    expect(result.heatmap.max_count).toBe(0);
  });
});

// ============================================================================
// Latency Histogram Tests
// ============================================================================

describe('computeConnectorAnalytics - Latency Histogram', () => {
  it('has correct fixed bucket definitions', () => {
    expect(LATENCY_BUCKETS).toHaveLength(8);
    expect(LATENCY_BUCKETS[0]).toEqual({ label: '0-10', from_ms: 0, to_ms: 10 });
    expect(LATENCY_BUCKETS[7]).toEqual({ label: '1000+', from_ms: 1000, to_ms: null });
  });

  it('places latencies in correct buckets (boundary conditions)', () => {
    const rpcs = [
      createRpc({ latency_ms: 0, rpc_id: 'rpc-0' }),    // 0-10 bucket
      createRpc({ latency_ms: 9, rpc_id: 'rpc-9' }),    // 0-10 bucket
      createRpc({ latency_ms: 10, rpc_id: 'rpc-10' }),  // 10-25 bucket (from_ms <= x < to_ms)
      createRpc({ latency_ms: 24, rpc_id: 'rpc-24' }),  // 10-25 bucket
      createRpc({ latency_ms: 25, rpc_id: 'rpc-25' }),  // 25-50 bucket
      createRpc({ latency_ms: 1000, rpc_id: 'rpc-1000' }), // 1000+ bucket
      createRpc({ latency_ms: 5000, rpc_id: 'rpc-5000' }), // 1000+ bucket
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    const buckets = result.latency.buckets;
    expect(buckets[0].count).toBe(2);  // 0-10: 0, 9
    expect(buckets[1].count).toBe(2);  // 10-25: 10, 24
    expect(buckets[2].count).toBe(1);  // 25-50: 25
    expect(buckets[7].count).toBe(2);  // 1000+: 1000, 5000
  });

  it('tracks sample_size and excluded_count correctly', () => {
    const rpcs = [
      createRpc({ latency_ms: 50 }),
      createRpc({ latency_ms: 100 }),
      createRpc({ latency_ms: null }),
      createRpc({ latency_ms: null }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.latency.sample_size).toBe(2);
    expect(result.latency.excluded_count).toBe(2);
  });
});

// ============================================================================
// Top Tools Tests
// ============================================================================

describe('computeConnectorAnalytics - Top Tools', () => {
  it('only counts tools/call RPCs', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', request: { json: { params: { name: 'read_file' } }, size: 100, truncated: false, preview: null } }),
      createRpc({ method: 'tools/list', request: createPayload() }),
      createRpc({ method: 'initialize', request: createPayload() }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.total_calls).toBe(1);
    expect(result.top_tools.items).toHaveLength(1);
  });

  it('extracts tool name from params.name', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', request: { json: { params: { name: 'my_tool' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.items[0].name).toBe('my_tool');
  });

  it('falls back to params.tool when params.name is missing', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', request: { json: { params: { tool: 'fallback_tool' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.items[0].name).toBe('fallback_tool');
  });

  it('falls back to params.toolName when params.name and params.tool are missing', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', request: { json: { params: { toolName: 'alt_tool' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.items[0].name).toBe('alt_tool');
  });

  it('sorts by count descending and takes top 5', () => {
    const rpcs = [
      // Tool A: 5 calls
      ...Array.from({ length: 5 }, (_, i) =>
        createRpc({ method: 'tools/call', rpc_id: `a-${i}`, request: { json: { params: { name: 'tool_a' } }, size: 100, truncated: false, preview: null } })
      ),
      // Tool B: 4 calls
      ...Array.from({ length: 4 }, (_, i) =>
        createRpc({ method: 'tools/call', rpc_id: `b-${i}`, request: { json: { params: { name: 'tool_b' } }, size: 100, truncated: false, preview: null } })
      ),
      // Tool C: 3 calls
      ...Array.from({ length: 3 }, (_, i) =>
        createRpc({ method: 'tools/call', rpc_id: `c-${i}`, request: { json: { params: { name: 'tool_c' } }, size: 100, truncated: false, preview: null } })
      ),
      // Tool D: 2 calls
      ...Array.from({ length: 2 }, (_, i) =>
        createRpc({ method: 'tools/call', rpc_id: `d-${i}`, request: { json: { params: { name: 'tool_d' } }, size: 100, truncated: false, preview: null } })
      ),
      // Tool E: 1 call
      createRpc({ method: 'tools/call', rpc_id: 'e-0', request: { json: { params: { name: 'tool_e' } }, size: 100, truncated: false, preview: null } }),
      // Tool F: 1 call (should be excluded from top 5 as 6th)
      createRpc({ method: 'tools/call', rpc_id: 'f-0', request: { json: { params: { name: 'tool_f' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.items).toHaveLength(5);
    expect(result.top_tools.items[0].name).toBe('tool_a');
    expect(result.top_tools.items[0].count).toBe(5);
    expect(result.top_tools.items[4].name).toBe('tool_e');
  });

  it('calculates percentage correctly', () => {
    const rpcs = [
      ...Array.from({ length: 3 }, (_, i) =>
        createRpc({ method: 'tools/call', rpc_id: `a-${i}`, request: { json: { params: { name: 'tool_a' } }, size: 100, truncated: false, preview: null } })
      ),
      createRpc({ method: 'tools/call', rpc_id: 'b-0', request: { json: { params: { name: 'tool_b' } }, size: 100, truncated: false, preview: null } }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.total_calls).toBe(4);
    expect(result.top_tools.items[0].pct).toBe(75); // 3/4 = 75%
    expect(result.top_tools.items[1].pct).toBe(25); // 1/4 = 25%
  });

  it('returns empty items when no tools/call RPCs exist', () => {
    const rpcs = [
      createRpc({ method: 'tools/list' }),
      createRpc({ method: 'initialize' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.top_tools.items).toHaveLength(0);
    expect(result.top_tools.total_calls).toBe(0);
  });
});

// ============================================================================
// Method Distribution Tests
// ============================================================================

describe('computeConnectorAnalytics - Method Distribution', () => {
  it('counts RPCs by method', () => {
    const rpcs = [
      createRpc({ method: 'tools/call', rpc_id: 'rpc-1' }),
      createRpc({ method: 'tools/call', rpc_id: 'rpc-2' }),
      createRpc({ method: 'tools/list', rpc_id: 'rpc-3' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.method_distribution.total_rpcs).toBe(3);
    expect(result.method_distribution.slices).toHaveLength(2);
    expect(result.method_distribution.slices[0]).toEqual({
      method: 'tools/call',
      count: 2,
      pct: 67, // 2/3 = 66.67% rounded to 67%
    });
    expect(result.method_distribution.slices[1]).toEqual({
      method: 'tools/list',
      count: 1,
      pct: 33, // 1/3 = 33.33% rounded to 33%
    });
  });

  it('sorts by count descending and takes top 5 + Others', () => {
    const rpcs = [
      // Method A: 10 calls
      ...Array.from({ length: 10 }, (_, i) =>
        createRpc({ method: 'method_a', rpc_id: `a-${i}` })
      ),
      // Method B: 8 calls
      ...Array.from({ length: 8 }, (_, i) =>
        createRpc({ method: 'method_b', rpc_id: `b-${i}` })
      ),
      // Method C: 6 calls
      ...Array.from({ length: 6 }, (_, i) =>
        createRpc({ method: 'method_c', rpc_id: `c-${i}` })
      ),
      // Method D: 4 calls
      ...Array.from({ length: 4 }, (_, i) =>
        createRpc({ method: 'method_d', rpc_id: `d-${i}` })
      ),
      // Method E: 2 calls
      ...Array.from({ length: 2 }, (_, i) =>
        createRpc({ method: 'method_e', rpc_id: `e-${i}` })
      ),
      // Method F: 1 call (should go to "Others")
      createRpc({ method: 'method_f', rpc_id: 'f-0' }),
      // Method G: 1 call (should go to "Others")
      createRpc({ method: 'method_g', rpc_id: 'g-0' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    // Total: 32 RPCs
    expect(result.method_distribution.total_rpcs).toBe(32);
    expect(result.method_distribution.slices).toHaveLength(6); // Top 5 + Others

    // Verify top 5 order
    expect(result.method_distribution.slices[0].method).toBe('method_a');
    expect(result.method_distribution.slices[0].count).toBe(10);
    expect(result.method_distribution.slices[4].method).toBe('method_e');
    expect(result.method_distribution.slices[4].count).toBe(2);

    // Verify "Others" bucket
    expect(result.method_distribution.slices[5].method).toBe('Others');
    expect(result.method_distribution.slices[5].count).toBe(2); // F + G
  });

  it('does not include Others when 5 or fewer methods', () => {
    const rpcs = [
      createRpc({ method: 'method_a', rpc_id: 'rpc-1' }),
      createRpc({ method: 'method_b', rpc_id: 'rpc-2' }),
      createRpc({ method: 'method_c', rpc_id: 'rpc-3' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.method_distribution.slices).toHaveLength(3);
    expect(result.method_distribution.slices.some((s) => s.method === 'Others')).toBe(false);
  });

  it('returns empty slices for no RPCs', () => {
    const sessionReports = { 'session-001': createSessionReport([]) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.method_distribution.slices).toHaveLength(0);
    expect(result.method_distribution.total_rpcs).toBe(0);
  });

  it('calculates percentages correctly', () => {
    const rpcs = [
      createRpc({ method: 'method_a', rpc_id: 'rpc-1' }),
      createRpc({ method: 'method_a', rpc_id: 'rpc-2' }),
      createRpc({ method: 'method_a', rpc_id: 'rpc-3' }),
      createRpc({ method: 'method_b', rpc_id: 'rpc-4' }),
    ];
    const sessionReports = { 'session-001': createSessionReport(rpcs) };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 1,
      sessionsDisplayed: 1,
    });

    expect(result.method_distribution.slices[0].pct).toBe(75); // 3/4 = 75%
    expect(result.method_distribution.slices[1].pct).toBe(25); // 1/4 = 25%
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('computeConnectorAnalytics - Integration', () => {
  it('handles multiple sessions correctly', () => {
    const rpcs1 = [
      createRpc({ status: 'OK', latency_ms: 10, rpc_id: 'rpc-1-1' }),
      createRpc({ status: 'OK', latency_ms: 20, rpc_id: 'rpc-1-2' }),
    ];
    const rpcs2 = [
      createRpc({ status: 'ERR', latency_ms: 30, rpc_id: 'rpc-2-1' }),
    ];

    const sessionReports = {
      'session-001': createSessionReport(rpcs1),
      'session-002': {
        ...createSessionReport(rpcs2),
        session: { ...createSessionReport(rpcs2).session, session_id: 'session-002' },
      },
    };

    const result = computeConnectorAnalytics({
      sessionReports,
      sessionsTotal: 2,
      sessionsDisplayed: 2,
    });

    expect(result.kpis.rpc_total).toBe(3);
    expect(result.kpis.rpc_ok).toBe(2);
    expect(result.kpis.rpc_err).toBe(1);
    expect(result.kpis.avg_latency_ms).toBe(20); // (10+20+30)/3 = 20
    expect(result.kpis.sessions_total).toBe(2);
    expect(result.kpis.sessions_displayed).toBe(2);
  });

  it('handles empty session reports', () => {
    const result = computeConnectorAnalytics({
      sessionReports: {},
      sessionsTotal: 0,
      sessionsDisplayed: 0,
    });

    expect(result.kpis.rpc_total).toBe(0);
    expect(result.kpis.avg_latency_ms).toBeNull();
    expect(result.kpis.p95_latency_ms).toBeNull();
    expect(result.kpis.max_latency_ms).toBeNull();
    expect(result.heatmap.max_count).toBe(0);
    expect(result.latency.sample_size).toBe(0);
    expect(result.top_tools.items).toHaveLength(0);
    expect(result.method_distribution.slices).toHaveLength(0);
  });
});
