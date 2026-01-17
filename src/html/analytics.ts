/**
 * Analytics computation for Connector HTML reports (Phase 5.2)
 *
 * Computes KPIs, heatmap, latency histogram, and top tools
 * from session report data.
 */

import type {
  HtmlSessionReportV1,
  SessionRpcDetail,
  HtmlConnectorAnalyticsV1,
  HtmlConnectorKpis,
  HtmlHeatmapData,
  HtmlHeatmapCell,
  HtmlLatencyHistogram,
  HtmlLatencyBucket,
  HtmlMethodLatencyData,
  HtmlMethodLatencyEntry,
  HtmlTopToolsData,
  HtmlTopTool,
  HtmlMethodDistribution,
  HtmlMethodSlice,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum sample size for P95 calculation.
 * Below this threshold, P95 returns null to avoid statistical noise.
 */
export const P95_MIN_SAMPLES = 20;

/**
 * Fixed latency histogram buckets.
 * to_ms: null means +infinity (for "1000+" bucket)
 */
export const LATENCY_BUCKETS = [
  { label: '0-10', from_ms: 0, to_ms: 10 },
  { label: '10-25', from_ms: 10, to_ms: 25 },
  { label: '25-50', from_ms: 25, to_ms: 50 },
  { label: '50-100', from_ms: 50, to_ms: 100 },
  { label: '100-250', from_ms: 100, to_ms: 250 },
  { label: '250-500', from_ms: 250, to_ms: 500 },
  { label: '500-1000', from_ms: 500, to_ms: 1000 },
  { label: '1000+', from_ms: 1000, to_ms: null }, // null = +infinity
] as const;

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Compute all analytics for a connector report.
 */
export function computeConnectorAnalytics(args: {
  sessionReports: Record<string, HtmlSessionReportV1>;
  sessionsTotal: number;
  sessionsDisplayed: number;
}): HtmlConnectorAnalyticsV1 {
  const { sessionReports, sessionsTotal, sessionsDisplayed } = args;

  // Collect all RPCs from all sessions
  const allRpcs: SessionRpcDetail[] = [];
  for (const report of Object.values(sessionReports)) {
    allRpcs.push(...report.rpcs);
  }

  // Compute each analytics component
  const topTools = computeTopTools(allRpcs);
  const kpis = computeKpis(allRpcs, sessionsTotal, sessionsDisplayed, topTools);
  const heatmap = computeHeatmap(allRpcs);
  const latency = computeLatencyHistogram(allRpcs);
  const methodLatency = computeMethodLatency(allRpcs);
  const methodDistribution = computeMethodDistribution(allRpcs);

  return {
    kpis,
    heatmap,
    latency,
    method_latency: methodLatency,
    top_tools: topTools,
    method_distribution: methodDistribution,
  };
}

// ============================================================================
// KPI Computation
// ============================================================================

/**
 * Compute KPI metrics from RPCs.
 */
function computeKpis(
  rpcs: SessionRpcDetail[],
  sessionsTotal: number,
  sessionsDisplayed: number,
  topTools: HtmlTopToolsData
): HtmlConnectorKpis {
  // Count by status
  let okCount = 0;
  let errCount = 0;
  let pendingCount = 0;

  // Latency collection
  const latencies: number[] = [];

  // Bytes
  let totalRequestBytes = 0;
  let totalResponseBytes = 0;

  for (const rpc of rpcs) {
    // Status counting
    switch (rpc.status) {
      case 'OK':
        okCount++;
        break;
      case 'ERR':
        errCount++;
        break;
      case 'PENDING':
        pendingCount++;
        break;
    }

    // Latency
    if (rpc.latency_ms !== null) {
      latencies.push(rpc.latency_ms);
    }

    // Bytes
    totalRequestBytes += rpc.request.size;
    totalResponseBytes += rpc.response.size;
  }

  // Latency statistics
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const p95Latency = computeP95(latencies);
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;

  // Top tool from topTools
  const topToolName = topTools.items.length > 0 ? topTools.items[0].name : null;
  const topToolCalls = topTools.items.length > 0 ? topTools.items[0].count : null;

  return {
    rpc_total: rpcs.length,
    rpc_ok: okCount,
    rpc_err: errCount,
    rpc_pending: pendingCount,
    avg_latency_ms: avgLatency,
    p95_latency_ms: p95Latency,
    max_latency_ms: maxLatency,
    total_request_bytes: totalRequestBytes,
    total_response_bytes: totalResponseBytes,
    sessions_total: sessionsTotal,
    sessions_displayed: sessionsDisplayed,
    top_tool_name: topToolName,
    top_tool_calls: topToolCalls,
  };
}

/**
 * Compute P95 latency using nearest-rank method.
 * Returns null if sample size < P95_MIN_SAMPLES.
 *
 * Algorithm: k = ceil(0.95 * n), take sorted[k-1]
 */
function computeP95(latencies: number[]): number | null {
  const n = latencies.length;
  if (n < P95_MIN_SAMPLES) {
    return null;
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const k = Math.ceil(0.95 * n);
  return sorted[k - 1];
}

// ============================================================================
// Heatmap Computation
// ============================================================================

/**
 * Compute activity heatmap from RPCs.
 * Groups RPCs by UTC date and fills gaps with zero-count days.
 *
 * Note: request_ts is stored in UTC ISO8601 format (Z suffix),
 * so slice(0, 10) gives the UTC date.
 */
function computeHeatmap(rpcs: SessionRpcDetail[]): HtmlHeatmapData {
  if (rpcs.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      start_date: today,
      end_date: today,
      cells: [{ date: today, count: 0 }],
      max_count: 0,
    };
  }

  // Count RPCs per UTC date
  const dateCounts = new Map<string, number>();
  for (const rpc of rpcs) {
    // request_ts is stored in UTC ISO8601 (Z suffix), so slice(0, 10) gives UTC date
    const date = rpc.request_ts.slice(0, 10);
    dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
  }

  // Find date range
  const dates = Array.from(dateCounts.keys()).sort();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  // Fill gaps with zero-count days
  const cells: HtmlHeatmapCell[] = [];
  const current = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    cells.push({
      date: dateStr,
      count: dateCounts.get(dateStr) || 0,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Calculate max count for intensity scaling
  const maxCount = Math.max(...cells.map((c) => c.count));

  return {
    start_date: startDate,
    end_date: endDate,
    cells,
    max_count: maxCount,
  };
}

// ============================================================================
// Latency Histogram Computation
// ============================================================================

/**
 * Compute latency histogram using fixed buckets.
 */
function computeLatencyHistogram(rpcs: SessionRpcDetail[]): HtmlLatencyHistogram {
  // Initialize buckets with zero counts
  const buckets: HtmlLatencyBucket[] = LATENCY_BUCKETS.map((b) => ({
    label: b.label,
    from_ms: b.from_ms,
    to_ms: b.to_ms,
    count: 0,
  }));

  let sampleSize = 0;
  let excludedCount = 0;

  for (const rpc of rpcs) {
    if (rpc.latency_ms === null) {
      excludedCount++;
      continue;
    }

    sampleSize++;
    const latency = rpc.latency_ms;

    // Find matching bucket
    // Bucket condition: from_ms <= latency < to_ms (or to_ms is null for +infinity)
    for (const bucket of buckets) {
      const inLowerBound = latency >= bucket.from_ms;
      const inUpperBound = bucket.to_ms === null || latency < bucket.to_ms;
      if (inLowerBound && inUpperBound) {
        bucket.count++;
        break;
      }
    }
  }

  return {
    buckets,
    sample_size: sampleSize,
    excluded_count: excludedCount,
  };
}

// ============================================================================
// Method Latency Computation
// ============================================================================

/**
 * Compute method-based latency data for bar chart.
 * Groups latencies by method name (e.g., initialize, tools/list, tools/call).
 */
function computeMethodLatency(rpcs: SessionRpcDetail[]): HtmlMethodLatencyData {
  if (rpcs.length === 0) {
    return {
      methods: [],
      sample_size: 0,
      max_latency_ms: 0,
    };
  }

  // Group latencies by method
  const methodLatencies = new Map<string, number[]>();
  let sampleSize = 0;
  let maxLatency = 0;

  for (const rpc of rpcs) {
    if (rpc.latency_ms === null) {
      continue;
    }

    sampleSize++;
    if (rpc.latency_ms > maxLatency) {
      maxLatency = rpc.latency_ms;
    }

    const existing = methodLatencies.get(rpc.method);
    if (existing) {
      existing.push(rpc.latency_ms);
    } else {
      methodLatencies.set(rpc.method, [rpc.latency_ms]);
    }
  }

  // Convert to entries with statistics
  const methods: HtmlMethodLatencyEntry[] = [];

  for (const [method, latencies] of methodLatencies.entries()) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const count = latencies.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / count);
    // Median (P50)
    const p50Idx = Math.floor(count / 2);
    const p50 = count % 2 === 0
      ? Math.round((sorted[p50Idx - 1] + sorted[p50Idx]) / 2)
      : sorted[p50Idx];

    methods.push({
      method,
      latencies: sorted,
      min_ms: min,
      max_ms: max,
      avg_ms: avg,
      p50_ms: p50,
      count,
    });
  }

  // Sort by total call count descending, take top 6 methods
  methods.sort((a, b) => b.count - a.count);
  const topMethods = methods.slice(0, 6);

  return {
    methods: topMethods,
    sample_size: sampleSize,
    max_latency_ms: maxLatency,
  };
}

// ============================================================================
// Top Tools Computation
// ============================================================================

/**
 * Compute top 5 tools from tools/call RPCs.
 *
 * Tool name extraction fallback chain: params.name ?? params.tool ?? params.toolName
 * If none found, the RPC is skipped (not counted as "unknown").
 */
function computeTopTools(rpcs: SessionRpcDetail[]): HtmlTopToolsData {
  const toolCounts = new Map<string, number>();
  let totalCalls = 0;

  for (const rpc of rpcs) {
    if (rpc.method !== 'tools/call') {
      continue;
    }

    // Extract tool name from request payload
    const toolName = extractToolName(rpc.request.json);
    if (toolName === null) {
      continue; // Skip if no tool name found
    }

    toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
    totalCalls++;
  }

  // Sort by count descending and take top 5
  const sorted = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const items: HtmlTopTool[] = sorted.map(([name, count]) => ({
    name,
    count,
    pct: totalCalls > 0 ? Math.round((count / totalCalls) * 100) : 0,
  }));

  return {
    items,
    total_calls: totalCalls,
  };
}

/**
 * Extract tool name from request JSON.
 * Fallback chain: params.name ?? params.tool ?? params.toolName
 */
function extractToolName(json: unknown): string | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }

  const obj = json as Record<string, unknown>;
  const params = obj.params;

  if (params === null || typeof params !== 'object') {
    return null;
  }

  const p = params as Record<string, unknown>;

  // Fallback chain: params.name ?? params.tool ?? params.toolName
  if (typeof p.name === 'string' && p.name.length > 0) {
    return p.name;
  }
  if (typeof p.tool === 'string' && p.tool.length > 0) {
    return p.tool;
  }
  if (typeof p.toolName === 'string' && p.toolName.length > 0) {
    return p.toolName;
  }

  return null;
}

// ============================================================================
// Method Distribution Computation
// ============================================================================

/**
 * Compute method distribution for donut chart.
 * Shows top 5 methods + "Others" bucket.
 */
function computeMethodDistribution(rpcs: SessionRpcDetail[]): HtmlMethodDistribution {
  if (rpcs.length === 0) {
    return {
      slices: [],
      total_rpcs: 0,
    };
  }

  // Count by method
  const methodCounts = new Map<string, number>();
  for (const rpc of rpcs) {
    methodCounts.set(rpc.method, (methodCounts.get(rpc.method) || 0) + 1);
  }

  // Sort by count descending
  const sorted = Array.from(methodCounts.entries()).sort((a, b) => b[1] - a[1]);

  const totalRpcs = rpcs.length;
  const slices: HtmlMethodSlice[] = [];

  // Take top 5
  const top5 = sorted.slice(0, 5);
  let top5Total = 0;

  for (const [method, count] of top5) {
    top5Total += count;
    slices.push({
      method,
      count,
      pct: Math.round((count / totalRpcs) * 100),
    });
  }

  // Add "Others" if there are more than 5 methods
  if (sorted.length > 5) {
    const othersCount = totalRpcs - top5Total;
    if (othersCount > 0) {
      slices.push({
        method: 'Others',
        count: othersCount,
        pct: Math.round((othersCount / totalRpcs) * 100),
      });
    }
  }

  return {
    slices,
    total_rpcs: totalRpcs,
  };
}
