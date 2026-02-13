/**
 * Gateway configuration
 * Phase 8.1: HTTP server foundation
 */

export interface GatewayLimits {
  /** Request timeout in milliseconds */
  timeout_ms: number;
  /** Maximum request body size */
  max_body_size: string;
  /** Maximum concurrent requests per connector (1 = serial) */
  max_inflight_per_connector: number;
  /** Maximum queue length per connector */
  max_queue_per_connector: number;
  /** Rate limit per token (requests/minute), null = no limit */
  rate_limit_per_token: number | null;
}

export interface GatewayConfig {
  /** Server host */
  host: string;
  /** Server port */
  port: number;
  /** Gateway limits */
  limits: GatewayLimits;
}

/** Default gateway limits */
export const DEFAULT_LIMITS: GatewayLimits = {
  timeout_ms: 30000,
  max_body_size: '1mb',
  max_inflight_per_connector: 1,
  max_queue_per_connector: 10,
  rate_limit_per_token: null,
};

/** Default gateway configuration */
export const DEFAULT_CONFIG: GatewayConfig = {
  host: '127.0.0.1',
  port: 3000,
  limits: DEFAULT_LIMITS,
};

/**
 * Create gateway configuration with overrides
 */
export function createGatewayConfig(
  overrides: Partial<GatewayConfig> = {}
): GatewayConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    limits: {
      ...DEFAULT_LIMITS,
      ...overrides.limits,
    },
  };
}
