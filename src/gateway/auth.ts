/**
 * Authentication configuration and token validation
 * Phase 8.2: Bearer Token Authentication
 */

import { createHash, timingSafeEqual } from 'crypto';

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

  const inputHash = hashToken(token);
  // Extract hex part after "sha256:" prefix
  const inputHashHex = inputHash.slice(7);

  for (const tokenConfig of config.tokens) {
    const storedHashHex = tokenConfig.token_hash.slice(7);

    // Use constant-time comparison to prevent timing attacks
    const inputBuffer = Buffer.from(inputHashHex, 'hex');
    const storedBuffer = Buffer.from(storedHashHex, 'hex');

    if (
      inputBuffer.length === storedBuffer.length &&
      timingSafeEqual(inputBuffer, storedBuffer)
    ) {
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
