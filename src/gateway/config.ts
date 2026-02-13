/**
 * Gateway configuration
 * Phase 8.1: HTTP server foundation
 * Phase 8.2: Bearer Token Authentication
 */

import { AuthConfig, DEFAULT_AUTH_CONFIG, createAuthConfig } from './auth.js';

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
  /** Authentication configuration */
  auth: AuthConfig;
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
  auth: DEFAULT_AUTH_CONFIG,
};

/**
 * Validate port number
 * Port 0 is allowed (OS assigns available ephemeral port)
 */
function validatePort(port: number): void {
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 0 and 65535.`);
  }
}

/**
 * Validate host string
 */
function validateHost(host: string): void {
  if (!host || host.trim() === '') {
    throw new Error('Invalid host: host cannot be empty.');
  }
  // Basic format check: reject obviously invalid characters
  if (/[\s<>{}|\\^`]/.test(host)) {
    throw new Error(`Invalid host: ${host}. Contains invalid characters.`);
  }
}

/**
 * Create gateway configuration with overrides
 */
export function createGatewayConfig(
  overrides: Partial<GatewayConfig> = {}
): GatewayConfig {
  // Validate port if provided
  if (overrides.port !== undefined) {
    validatePort(overrides.port);
  }

  // Validate host if provided
  if (overrides.host !== undefined) {
    validateHost(overrides.host);
  }

  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    limits: {
      ...DEFAULT_LIMITS,
      ...overrides.limits,
    },
    auth: createAuthConfig(overrides.auth),
  };
}
