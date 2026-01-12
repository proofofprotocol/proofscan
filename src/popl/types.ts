/**
 * POPL Types (Phase 6.0)
 *
 * Public Observable Proof Ledger - Type definitions for POPL.yml schema.
 *
 * IMPORTANT: POPL is designed for PUBLIC disclosure.
 * - No local absolute paths
 * - No secrets/tokens/PII
 * - Only sanitized evidence with hashes
 */

/** POPL schema version */
export const POPL_VERSION = 1;

/** Trust levels */
export type TrustLevel = 0 | 1 | 2 | 3;

/** Trust level labels */
export const TRUST_LABELS: Record<TrustLevel, string> = {
  0: 'Recorded',
  1: 'Verified',
  2: 'Attested',
  3: 'Certified',
};

/** Target kinds for POPL entries */
export type TargetKind = 'session' | 'connector' | 'proxy' | 'plan' | 'run';

/** Redaction policy */
export type RedactionPolicy = 'default' | 'strict' | 'none';

/** Author information */
export interface PoplAuthor {
  /** Display name */
  name: string;
  /** Handle (e.g., GitHub username) */
  handle?: string;
}

/** Trust information */
export interface PoplTrust {
  /** Trust level (0-3) */
  level: TrustLevel;
  /** Human-readable label */
  label: string;
}

/** Target identifiers */
export interface PoplTargetIds {
  /** Proxy instance ID (optional) */
  proxy_id?: string;
  /** Connector ID (optional for proxy-level entries) */
  connector_id?: string;
  /** Session ID (required for session-level entries) */
  session_id?: string;
  /** Plan name (required for plan-level entries) */
  plan_name?: string;
  /** Run ID (required for run-level entries) */
  run_id?: string;
}

/** Target specification */
export interface PoplTarget {
  /** Target kind */
  kind: TargetKind;
  /** Display name */
  name: string;
  /** Target identifiers */
  ids: PoplTargetIds;
}

/** Capture summary statistics */
export interface PoplCaptureSummary {
  /** Total RPC calls */
  rpc_total: number;
  /** Error count */
  errors: number;
  /** P50 latency in milliseconds */
  latency_ms_p50?: number;
  /** P95 latency in milliseconds */
  latency_ms_p95?: number;
}

/** MCP client information */
export interface PoplMcpClient {
  /** Communication mode */
  mode: 'stdio' | 'http';
  /** Client name (if known) */
  name?: string;
}

/** MCP server information */
export interface PoplMcpServer {
  /** Server/connector name */
  name: string;
  /** Number of tools */
  tools?: number;
}

/** MCP metadata */
export interface PoplMcp {
  /** Client info */
  client?: PoplMcpClient;
  /** Server(s) info */
  servers?: PoplMcpServer[];
}

/** Capture window */
export interface PoplCaptureWindow {
  /** Start timestamp (ISO 8601) */
  started_at: string;
  /** End timestamp (ISO 8601) */
  ended_at: string;
}

/** Capture metadata */
export interface PoplCapture {
  /** Time window */
  window: PoplCaptureWindow;
  /** Summary statistics */
  summary: PoplCaptureSummary;
  /** MCP metadata */
  mcp?: PoplMcp;
}

/** Evidence artifact */
export interface PoplArtifact {
  /** Artifact name (for display) */
  name: string;
  /** Relative path within entry directory */
  path: string;
  /** SHA-256 hash of file contents */
  sha256: string;
}

/** Evidence policy */
export interface PoplEvidencePolicy {
  /** Redaction policy applied */
  redaction: RedactionPolicy;
  /** Ruleset version used for sanitization */
  ruleset_version: number;
}

/** Evidence section */
export interface PoplEvidence {
  /** Policy applied to evidence */
  policy: PoplEvidencePolicy;
  /** Artifacts included */
  artifacts: PoplArtifact[];
}

/** Entry metadata */
export interface PoplEntry {
  /** Unique entry ID (ULID) */
  id: string;
  /** Creation timestamp (ISO 8601) */
  created_at: string;
  /** Entry title */
  title: string;
  /** Author information */
  author: PoplAuthor;
  /** Trust level */
  trust: PoplTrust;
}

/**
 * Complete POPL.yml document structure
 *
 * This is the root type for POPL entry files.
 */
export interface PoplDocument {
  /** Schema version */
  popl: typeof POPL_VERSION;
  /** Entry metadata */
  entry: PoplEntry;
  /** Target specification */
  target: PoplTarget;
  /** Capture metadata */
  capture: PoplCapture;
  /** Evidence section */
  evidence: PoplEvidence;
}

/**
 * Options for creating a POPL entry
 */
export interface CreatePoplOptions {
  /** Target kind */
  kind: TargetKind;
  /** Target IDs */
  ids: PoplTargetIds;
  /** Output root directory (where .popl/ exists) */
  outputRoot: string;
  /** Entry title (optional, auto-generated if not provided) */
  title?: string;
  /** Author info (optional, uses config if not provided) */
  author?: PoplAuthor;
  /** Include raw (unsanitized) artifacts - DANGEROUS */
  unsafeIncludeRaw?: boolean;
}

/**
 * Result of POPL entry creation
 */
export interface CreatePoplResult {
  /** Whether creation succeeded */
  success: boolean;
  /** Entry ID */
  entryId?: string;
  /** Path to entry directory */
  entryPath?: string;
  /** Path to POPL.yml */
  poplYmlPath?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * POPL configuration (from .popl/config.json or global)
 */
export interface PoplConfig {
  /** Default author */
  author?: PoplAuthor;
  /** Default redaction policy */
  redaction?: RedactionPolicy;
}
