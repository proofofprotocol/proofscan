/**
 * ProofScan Web Monitor - Cross-connector analytics aggregation
 */

import { getEventsDb } from '../../db/connection.js';
import type {
  HtmlHeatmapData,
  HtmlHeatmapCell,
  HtmlMethodDistribution,
  HtmlMethodSlice,
} from '../../html/types.js';

/**
 * Compute aggregated heatmap across all connectors
 */
export function computeAggregatedHeatmap(configDir: string): HtmlHeatmapData {
  const db = getEventsDb(configDir);

  // Get RPC counts by date across all connectors
  const stmt = db.prepare(`
    SELECT DATE(r.request_ts) as date, COUNT(*) as count
    FROM rpc_calls r
    WHERE r.request_ts IS NOT NULL
    GROUP BY DATE(r.request_ts)
    ORDER BY date ASC
  `);
  const rows = stmt.all() as { date: string; count: number }[];

  if (rows.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      start_date: today,
      end_date: today,
      cells: [{ date: today, count: 0 }],
      max_count: 0,
    };
  }

  // Find date range
  const startDate = rows[0].date;
  const endDate = rows[rows.length - 1].date;

  // Create map for quick lookup
  const dateMap = new Map(rows.map((r) => [r.date, r.count]));

  // Fill gaps with zero-count days
  const cells: HtmlHeatmapCell[] = [];
  const current = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  let maxCount = 0;

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const count = dateMap.get(dateStr) || 0;
    cells.push({ date: dateStr, count });
    if (count > maxCount) maxCount = count;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return {
    start_date: startDate,
    end_date: endDate,
    cells,
    max_count: maxCount,
  };
}

/**
 * Compute aggregated method distribution across all connectors
 */
export function computeAggregatedMethodDistribution(
  configDir: string
): HtmlMethodDistribution {
  const db = getEventsDb(configDir);

  // Get method counts across all connectors
  const stmt = db.prepare(`
    SELECT r.method, COUNT(*) as count
    FROM rpc_calls r
    GROUP BY r.method
    ORDER BY count DESC
  `);
  const rows = stmt.all() as { method: string; count: number }[];

  if (rows.length === 0) {
    return {
      slices: [],
      total_rpcs: 0,
    };
  }

  const totalRpcs = rows.reduce((sum, r) => sum + r.count, 0);
  const slices: HtmlMethodSlice[] = [];

  // Take top 5
  const top5 = rows.slice(0, 5);
  let top5Total = 0;

  for (const row of top5) {
    top5Total += row.count;
    slices.push({
      method: row.method,
      count: row.count,
      pct: Math.round((row.count / totalRpcs) * 100),
    });
  }

  // Add "Others" if there are more than 5 methods
  if (rows.length > 5) {
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
