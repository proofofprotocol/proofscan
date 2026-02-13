/**
 * Authentication configuration and token validation
 * Phase 8.2: Bearer Token Authentication
 */

import { createHash } from 'crypto';

/**
 * Token configuration
 */
export interface TokenConfig {
  /** Token name for identification (used in logs, NOT the token itself) */
  name: string;
  /** Token hash in "sha256:xxx" format */
  token_hash: string;
  /** Granted permissions (e.g., ["mcp:*", "registry:read"]) */
  permissions: string[];
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Authentication mode */
  mode: 'none' | 'bearer';
  /** Configured tokens (only used when mode is 'bearer') */
  tokens: TokenConfig[];
}

/** Default auth configuration (no authentication) */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  mode: 'none',
  tokens: [],
};

/**
 * Hash a plaintext token using SHA-256
 * @param token Plaintext token
 * @returns Hash in "sha256:xxx" format
 */
export function hashToken(token: string): string {
  const hash = createHash('sha256').update(token).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Validate a plaintext token against configured token hashes
 * @param token Plaintext token from Authorization header
 * @param config Auth configuration
 * @returns TokenConfig if valid, null if invalid
 */
export function validateToken(
  token: string,
  config: AuthConfig
): TokenConfig | null {
  if (config.mode === 'none') {
    return null;
  }

  const tokenHash = hashToken(token);

  for (const tokenConfig of config.tokens) {
    if (tokenConfig.token_hash === tokenHash) {
      return tokenConfig;
    }
  }

  return null;
}

/**
 * Create auth configuration with defaults
 */
export function createAuthConfig(
  overrides: Partial<AuthConfig> = {}
): AuthConfig {
  return {
    ...DEFAULT_AUTH_CONFIG,
    ...overrides,
  };
}
