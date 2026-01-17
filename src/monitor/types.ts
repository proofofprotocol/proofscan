/**
 * ProofScan Web Monitor - Type definitions
 */

/**
 * Connector status based on recent observations (independent of enabled/disabled)
 */
export type ConnectorStatus = 'OK' | 'WARN' | 'ERR' | 'OFFLINE';

/**
 * Protocol tag based on observed traffic patterns
 * - MCP: Model Context Protocol (serverInfo in initialize response)
 * - A2A: Agent-to-Agent protocol (placeholder for future)
 * - JSON-RPC: Generic JSON-RPC 2.0 without MCP evidence
 * - Unknown: Cannot determine from observed traffic
 */
export type ProtocolTag = 'MCP' | 'A2A' | 'JSON-RPC' | 'Unknown';

/**
 * Transport type for connector
 */
export type TransportType = 'stdio' | 'sse' | 'http';

/**
 * Connector capabilities (fact-based detection)
 */
export interface MonitorConnectorCapabilities {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
  /** subscriptions is true only if tasks/* or progress/* RPCs observed */
  subscriptions: boolean;
}

/**
 * Connector KPI totals
 */
export interface MonitorConnectorKpis {
  sessions: number;
  rpcs: number;
  errors: number;
  avg_latency_ms: number | null;
}

/**
 * Connector card data for Home page display
 */
export interface MonitorConnectorCard {
  connector_id: string;

  // Package identification (required)
  package_name: string; // serverInfo.name from initialize response
  package_version: string; // serverInfo.version ?? 'unknown'

  // Protocol detection (fact-based)
  protocol: ProtocolTag; // Detected from observed traffic
  protocol_version?: string; // e.g., MCP protocolVersion if known

  // Status (independent states)
  status: ConnectorStatus; // Based on recent observations
  enabled: boolean; // Config setting (disabled shows with dimmed style)

  // Capabilities (fact-based)
  capabilities: MonitorConnectorCapabilities;

  // Transport
  transport: TransportType;

  // KPI totals
  kpis: MonitorConnectorKpis;

  // Last activity
  last_activity: string | null; // ISO timestamp
  last_activity_relative: string; // "2 hours ago", "never"
}

/**
 * POPL KPI summary for Home page
 */
export interface MonitorPoplKpis {
  entries: number;
  inscribed: number; // HCS inscribed (trust.level > 0)
  ipfs_only: number; // Has IPFS CID but not inscribed
  failed: number; // Processing failed
  latest_entry_id: string | null;
  latest_entries: MonitorPoplSummary[]; // Latest N entries for display
}

/**
 * Aggregated analytics for home page
 */
export interface MonitorAggregatedAnalytics {
  heatmap: import('../html/types.js').HtmlHeatmapData;
  method_distribution: import('../html/types.js').HtmlMethodDistribution;
}

/**
 * Home page data structure
 */
export interface MonitorHomeData {
  generated_at: string; // ISO timestamp
  connectors: MonitorConnectorCard[];
  popl: MonitorPoplKpis | null;
  aggregated_analytics: MonitorAggregatedAnalytics;
}

/**
 * Monitor server options
 */
export interface MonitorServerOptions {
  configPath: string;
  port: number;
  host: string;
}

// =============================================================================
// Phase 10: POPL × Monitor 相互リンク型定義
// =============================================================================

/**
 * POPL Entry 詳細データ
 */
export interface MonitorPoplEntry {
  id: string; // ULID (26 chars) = proof_id
  created_at: string; // ISO8601
  title: string;
  author_name: string;
  trust_level: number; // 0=Recorded, 1=Verified, 2=Attested, 3=Certified
  trust_label: string;

  // ターゲットリンク
  target_kind: 'session' | 'connector' | 'plan' | 'run';
  connector_id: string;
  session_id: string | null;

  // キャプチャサマリー
  capture: {
    started_at: string;
    ended_at: string;
    rpc_total: number;
    errors: number;
    latency_ms_p50: number | null;
    latency_ms_p95: number | null;
    mcp_servers: string[];
  };

  // エビデンス
  artifacts: Array<{
    name: string;
    path: string;
    sha256: string;
  }>;
}

/**
 * POPL Entry サマリー（一覧表示用）
 */
export interface MonitorPoplSummary {
  id: string;
  created_at: string;
  trust_level: number;
  trust_label: string;
  rpc_total: number;
  errors: number;
  session_id: string | null;
}

// =============================================================================
// Phase Issue #59: Events View 型定義
// =============================================================================

/**
 * Event direction
 */
export type EventDirection = 'client_to_server' | 'server_to_client';

/**
 * Event kind
 */
export type EventKind = 'request' | 'response' | 'notification' | 'transport_event';

/**
 * Session event for Events View display
 */
export interface MonitorSessionEvent {
  event_id: string;
  session_id: string;
  rpc_id: string | null;
  direction: EventDirection;
  kind: EventKind;
  ts: string; // ISO timestamp
  seq: number | null;
  summary: string | null;
  method: string | null; // Extracted from raw_json if available
  payload_type: string | null; // Extracted from raw_json.type (for transport_event)
  has_payload: boolean; // Whether raw_json exists
}
