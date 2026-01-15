/**
 * HTML Report Types (Phase 5.0)
 *
 * Data models for HTML export functionality.
 * Supports RPC detail and Session reports with embedded JSON.
 */

/**
 * Schema version for HTML reports
 */
export const HTML_REPORT_SCHEMA_VERSION = 1;

/**
 * Default embed limit for payload JSON (256KB)
 */
export const DEFAULT_EMBED_MAX_BYTES = 262144;

/**
 * Preview length for truncated payloads
 */
export const TRUNCATION_PREVIEW_LENGTH = 4096;

/**
 * Short ID length for display (e.g., session IDs, RPC IDs)
 */
export const SHORT_ID_LENGTH = 8;

/**
 * Report metadata
 */
export interface HtmlReportMeta {
  schemaVersion: number;
  generatedAt: string;      // ISO8601
  generatedBy: string;      // "proofscan v0.x.x"
  redacted: boolean;
}

/**
 * RPC status values (uppercase for consistency)
 */
export type RpcStatus = 'OK' | 'ERR' | 'PENDING';

/**
 * HTML export options
 */
export interface HtmlExportOptions {
  /** Output directory */
  outDir: string;
  /** Open in browser after export */
  open: boolean;
  /** Redact sensitive values */
  redact: boolean;
  /** Max bytes per payload before truncation */
  embedMaxBytes: number;
  /** Write oversized payloads to separate files */
  spill: boolean;
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: HtmlExportOptions = {
  outDir: './pfscan_reports',
  open: false,
  redact: false,
  embedMaxBytes: DEFAULT_EMBED_MAX_BYTES,
  spill: false,
};

/**
 * RPC payload with truncation support
 */
export interface PayloadData {
  /** Full JSON (null if truncated) */
  json: unknown | null;
  /** Size in bytes */
  size: number;
  /** Whether payload was truncated */
  truncated: boolean;
  /** Preview string if truncated (first N chars) */
  preview: string | null;
  /** Relative path to spill file if --spill enabled */
  spillFile?: string;
}

/**
 * RPC detail for HTML report
 */
export interface HtmlRpcData {
  rpc_id: string;
  session_id: string;
  connector_id: string;
  method: string;
  status: RpcStatus;
  latency_ms: number | null;
  error_code: number | null;
  request_ts: string;
  response_ts: string | null;
  request: PayloadData;
  response: PayloadData;
}

/**
 * RPC Report V1
 */
export interface HtmlRpcReportV1 {
  meta: HtmlReportMeta;
  rpc: HtmlRpcData;
}

/**
 * Session RPC detail for table rows
 */
export interface SessionRpcDetail {
  rpc_id: string;
  method: string;
  status: RpcStatus;
  latency_ms: number | null;
  request_ts: string;
  response_ts: string | null;
  error_code: number | null;
  request: PayloadData;
  response: PayloadData;
}

/**
 * Session data for HTML report
 */
export interface HtmlSessionData {
  session_id: string;
  connector_id: string;
  started_at: string;
  ended_at: string | null;
  exit_reason: string | null;
  rpc_count: number;
  event_count: number;
  /** Total latency across all RPCs in milliseconds */
  total_latency_ms: number | null;
}

/**
 * Session Report V1
 */
export interface HtmlSessionReportV1 {
  meta: HtmlReportMeta;
  session: HtmlSessionData;
  rpcs: SessionRpcDetail[];
}

/**
 * Convert DB status to RpcStatus
 */
export function toRpcStatus(success: number | null): RpcStatus {
  if (success === 1) return 'OK';
  if (success === 0) return 'ERR';
  return 'PENDING';
}

/**
 * Get status symbol for display
 */
export function getStatusSymbol(status: RpcStatus): string {
  switch (status) {
    case 'OK': return '✓';
    case 'ERR': return '✗';
    case 'PENDING': return '?';
  }
}

/**
 * Create payload data with truncation handling
 */
export function createPayloadData(
  json: unknown | null,
  rawJson: string | null,
  embedMaxBytes: number,
  spillFile?: string
): PayloadData {
  if (rawJson === null || json === null) {
    return {
      json: null,
      size: 0,
      truncated: false,
      preview: null,
    };
  }

  const size = Buffer.byteLength(rawJson, 'utf8');
  const truncated = size > embedMaxBytes;

  if (truncated) {
    return {
      json: null,
      size,
      truncated: true,
      preview: rawJson.slice(0, TRUNCATION_PREVIEW_LENGTH),
      spillFile,
    };
  }

  return {
    json,
    size,
    truncated: false,
    preview: null,
  };
}

/**
 * Generate output filename for RPC HTML
 */
export function getRpcHtmlFilename(rpcId: string): string {
  return `rpc_${rpcId}.html`;
}

/**
 * Generate output filename for Session HTML
 */
export function getSessionHtmlFilename(sessionId: string): string {
  const short = sessionId.slice(0, 8);
  return `session_${short}.html`;
}

/**
 * Generate spill filename for payload
 */
export function getSpillFilename(
  sessionId: string,
  rpcId: string,
  type: 'req' | 'res'
): string {
  const sessionShort = sessionId.slice(0, 8);
  return `payload_${sessionShort}_${rpcId}_${type}.json`;
}

// ============================================================================
// Connector HTML Report Types (Phase 5.1)
// ============================================================================

/**
 * MCP Server capabilities from initialize response
 */
export interface HtmlMcpCapabilities {
  tools: boolean;       // capabilities.tools is present
  resources: boolean;   // capabilities.resources is present
  prompts: boolean;     // capabilities.prompts is present
}

/**
 * MCP Server info extracted from initialize response
 */
export interface HtmlMcpServerInfo {
  name: string | null;          // serverInfo.name from initialize response
  version: string | null;       // serverInfo.version
  protocolVersion: string | null; // protocolVersion from initialize response
  capabilities: HtmlMcpCapabilities;  // supported capabilities
}

/**
 * Connector configuration info for HTML display
 */
export interface HtmlConnectorInfo {
  connector_id: string;
  enabled: boolean;
  transport: {
    type: 'stdio' | 'rpc-http' | 'rpc-sse';
    /** For stdio: command + args joined */
    command?: string;
    /** For http/sse: URL */
    url?: string;
  };
  /** MCP server info from latest initialize response (if available) */
  server?: HtmlMcpServerInfo;
  /** Total session count in DB */
  session_count: number;
  /** Sessions included in this export */
  displayed_sessions: number;
  /** Pagination offset */
  offset: number;
}

/**
 * Connector session row for left pane list
 */
export interface HtmlConnectorSessionRow {
  session_id: string;
  short_id: string;         // 8文字プレフィックス
  started_at: string;
  ended_at: string | null;
  rpc_count: number;
  event_count: number;
  error_count: number;      // For ERR badge (success=0 count)
  total_latency_ms: number | null;
}

/**
 * Connector Report V1 - embeds multiple session reports
 */
export interface HtmlConnectorReportV1 {
  meta: HtmlReportMeta;
  connector: HtmlConnectorInfo;
  /** セッション一覧（左ペイン用） */
  sessions: HtmlConnectorSessionRow[];
  /** セッション詳細（右ペイン用）- session_id をキーとするマップ */
  session_reports: Record<string, HtmlSessionReportV1>;
  /** Analytics data (Phase 5.2) */
  analytics: HtmlConnectorAnalyticsV1;
}

/**
 * Generate output filename for Connector HTML
 * Sanitizes connector ID (replaces non-alphanumeric with hyphen)
 */
export function getConnectorHtmlFilename(connectorId: string): string {
  const sanitized = connectorId.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `connector_${sanitized}.html`;
}

// ============================================================================
// Connector HTML Analytics Types (Phase 5.2)
// ============================================================================

/**
 * Connector-level KPIs
 */
export interface HtmlConnectorKpis {
  rpc_total: number;
  rpc_ok: number;
  rpc_err: number;
  rpc_pending: number;
  avg_latency_ms: number | null;    // null if no RPCs with latency
  p95_latency_ms: number | null;    // null if < 20 samples (nearest-rank method)
  max_latency_ms: number | null;
  total_request_bytes: number;
  total_response_bytes: number;
  sessions_total: number;
  sessions_displayed: number;
  top_tool_name: string | null;
  top_tool_calls: number | null;
}

/**
 * Heatmap cell (GitHub contributions style)
 */
export interface HtmlHeatmapCell {
  date: string;    // YYYY-MM-DD (UTC)
  count: number;   // RPC count
}

/**
 * Heatmap data with intensity calculation
 */
export interface HtmlHeatmapData {
  start_date: string;
  end_date: string;
  cells: HtmlHeatmapCell[];   // Full range including 0-count days
  max_count: number;          // For intensity scaling
}

/**
 * Latency histogram bucket
 */
export interface HtmlLatencyBucket {
  label: string;      // e.g., "0-10", "1000+"
  from_ms: number;
  to_ms: number | null;  // null = +∞ (for "1000+" bucket)
  count: number;
}

/**
 * Latency histogram data
 */
export interface HtmlLatencyHistogram {
  buckets: HtmlLatencyBucket[];
  sample_size: number;      // RPCs with latency_ms
  excluded_count: number;   // RPCs without latency_ms
}

/**
 * Top tool entry
 */
export interface HtmlTopTool {
  name: string;
  count: number;
  pct: number;    // 0-100
}

/**
 * Top tools data
 */
export interface HtmlTopToolsData {
  items: HtmlTopTool[];   // Top 5
  total_calls: number;    // Total tools/call count
}

/**
 * Method distribution slice (for donut chart)
 */
export interface HtmlMethodSlice {
  method: string;
  count: number;
  pct: number;    // 0-100
}

/**
 * Method distribution data
 */
export interface HtmlMethodDistribution {
  slices: HtmlMethodSlice[];   // Top 5 methods + "Others"
  total_rpcs: number;
}

/**
 * Complete analytics data
 */
export interface HtmlConnectorAnalyticsV1 {
  kpis: HtmlConnectorKpis;
  heatmap: HtmlHeatmapData;
  latency: HtmlLatencyHistogram;
  top_tools: HtmlTopToolsData;
  method_distribution: HtmlMethodDistribution;
}
