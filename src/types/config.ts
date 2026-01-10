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

/**
 * Security configuration for catalog operations (Phase 7.1)
 */
export interface CatalogSecurityConfig {
  /**
   * Block installation of untrusted/unknown servers
   * - New configs (via init): true (safe default)
   * - Existing configs without security section: false (backward compatibility)
   */
  trustedOnly?: boolean;

  /**
   * npm scopes considered trusted
   * Packages from these scopes are marked as trusted.
   * Default: ['@modelcontextprotocol', '@anthropic']
   */
  trustedNpmScopes?: string[];

  /**
   * Enable/disable specific sources for installation
   * Note: search/view always work regardless of this setting
   * Only install is blocked when source is disabled.
   * Example: { smithery: false } to block smithery installs
   */
  allowSources?: Record<string, boolean>;
}

/**
 * Catalog configuration for registry source (Phase 7.0)
 */
export interface CatalogConfig {
  /** Default catalog source name (default: 'official') */
  defaultSource?: string;
  /** Namespace secrets for catalog sources (e.g., 'catalog.smithery.apiKey' -> encrypted value) */
  secrets?: Record<string, string>;
  /** Security configuration for trust policy (Phase 7.1) */
  security?: CatalogSecurityConfig;
}

export interface Config {
  version: 1;
  connectors: Connector[];
  retention?: RetentionConfig;
  /** Inscriber configuration for inscribe command */
  inscriber?: InscriberConfig;
  /** Catalog configuration for registry source */
  catalog?: CatalogConfig;
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
