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
