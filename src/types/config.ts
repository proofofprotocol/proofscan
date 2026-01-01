/**
 * Configuration types for proofscan
 */

export type TransportType = 'stdio' | 'rpc-http' | 'rpc-sse';

export interface StdioTransport {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTransport {
  type: 'rpc-http';
  url: string;
  headers?: Record<string, string>;
}

export interface SseTransport {
  type: 'rpc-sse';
  url: string;
  headers?: Record<string, string>;
}

export type Transport = StdioTransport | HttpTransport | SseTransport;

export interface ConnectorPlugins {
  debug_monitor?: boolean;
  inscribe?: boolean;
}

export interface Connector {
  id: string;
  enabled: boolean;
  transport: Transport;
  plugins?: ConnectorPlugins;
}

export interface RetentionConfig {
  keep_last_sessions?: number; // Keep last N sessions per connector
  raw_days?: number;           // Delete raw_json after N days
  max_db_mb?: number;          // Maximum events.db size in MB
}

/**
 * Inscriber configuration for inscribe command (Phase 4.3)
 */
export interface InscriberConfig {
  /** Connector ID for the inscribe-mcp server (default: 'inscribe') */
  connectorId?: string;
  /** Tool name to call on the inscriber connector (default: 'inscribe') */
  toolName?: string;
  /** Default inscription type (default: 'proofscan.rpc') */
  type?: string;
}

export interface Config {
  version: 1;
  connectors: Connector[];
  retention?: RetentionConfig;
  /** Inscriber configuration for inscribe command */
  inscriber?: InscriberConfig;
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  connectors: [],
};

export const DEFAULT_RETENTION: RetentionConfig = {
  keep_last_sessions: 50,
  raw_days: 7,
  max_db_mb: 500,
};
