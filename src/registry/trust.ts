/**
 * Trust Policy for Catalog Sources
 *
 * Provides trust level determination for MCP servers based on their source and package info.
 * Trust is determined by the "trust root" - where the package originates from.
 */

import type { ServerInfo, PackageInfo } from './client.js';

/**
 * Trust levels for catalog sources and packages
 */
export type TrustLevel = 'trusted' | 'untrusted' | 'unknown';

/**
 * Trust root identifiers
 *
 * These identify the source of trust, not the catalog source name.
 * Used for displaying "why" a server is trusted/untrusted.
 */
export type TrustRoot =
  | 'github-reference'  // Official MCP reference servers from modelcontextprotocol/servers
  | 'npm-scope'         // npm package in trustedNpmScopes
  | 'official-registry' // Official MCP registry (unknown provenance)
  | 'smithery'          // Community servers (untrusted)
  | 'unknown';          // Unknown provenance

/**
 * Trust metadata for a server
 */
export interface TrustInfo {
  /** Trust level: trusted, untrusted, or unknown */
  level: TrustLevel;
  /** Human-readable explanation of trust determination */
  reason: string;
  /** Trust root identifier for display */
  root: TrustRoot;
}

/**
 * Security configuration for catalog operations
 * Stored in config.catalog.security
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
 * Default trusted npm scopes
 * These scopes are considered trusted by default.
 */
export const DEFAULT_TRUSTED_NPM_SCOPES = [
  '@modelcontextprotocol',
  '@anthropic',
];

/**
 * Determine trust level for a server based on source and package info
 *
 * Trust determination order:
 * 1. GitHub source → trusted (github-reference)
 * 2. npm package in trustedNpmScopes → trusted (npm-scope)
 * 3. npm package outside trustedNpmScopes → unknown
 * 4. Smithery source → untrusted (smithery)
 * 5. Official registry → unknown (official-registry)
 *
 * @param server - Server info from catalog
 * @param sourceName - Catalog source name (github, official, npm, smithery)
 * @param securityConfig - Security configuration from config
 * @returns Trust info with level, reason, and root
 */
export function determineTrust(
  server: ServerInfo,
  sourceName: string,
  securityConfig?: CatalogSecurityConfig
): TrustInfo {
  // 1. GitHub reference servers are always trusted
  if (sourceName === 'github') {
    return {
      level: 'trusted',
      reason: 'Official MCP reference server',
      root: 'github-reference',
    };
  }

  // 2. Check npm package scope
  const npmPkg = findNpmPackage(server.packages);
  if (npmPkg) {
    const trustedScopes = securityConfig?.trustedNpmScopes ?? DEFAULT_TRUSTED_NPM_SCOPES;
    const scope = extractNpmScope(npmPkg.identifier);

    if (scope && trustedScopes.includes(scope)) {
      return {
        level: 'trusted',
        reason: `Trusted npm scope: ${scope}`,
        root: 'npm-scope',
      };
    }

    // npm package outside trusted scopes
    return {
      level: 'unknown',
      reason: scope
        ? `npm scope ${scope} not in trusted list`
        : 'npm package without scope',
      root: 'unknown',
    };
  }

  // 3. Smithery is always untrusted (community)
  if (sourceName === 'smithery') {
    return {
      level: 'untrusted',
      reason: 'Community server from Smithery',
      root: 'smithery',
    };
  }

  // 4. Official registry has unknown provenance
  if (sourceName === 'official') {
    return {
      level: 'unknown',
      reason: 'Official registry (unknown provenance)',
      root: 'official-registry',
    };
  }

  // 5. Default: unknown
  return {
    level: 'unknown',
    reason: 'Unknown source',
    root: 'unknown',
  };
}

/**
 * Check if installation should be allowed based on trust policy
 *
 * @param trust - Trust info for the server
 * @param sourceName - Catalog source name
 * @param securityConfig - Security configuration
 * @param allowUntrustedFlag - CLI --allow-untrusted flag
 * @returns Whether install is allowed and reason if blocked
 */
export function shouldAllowInstall(
  trust: TrustInfo,
  sourceName: string,
  securityConfig?: CatalogSecurityConfig,
  allowUntrustedFlag?: boolean
): { allowed: boolean; reason?: string } {
  // Check allowSources first (install-only restriction)
  if (securityConfig?.allowSources?.[sourceName] === false) {
    return {
      allowed: false,
      reason: `Source "${sourceName}" is disabled for installation in config`,
    };
  }

  // Trusted servers are always allowed
  if (trust.level === 'trusted') {
    return { allowed: true };
  }

  // --allow-untrusted flag overrides policy
  if (allowUntrustedFlag) {
    return { allowed: true };
  }

  // If trustedOnly is not set or false, allow with warning
  // Note: for existing configs without security section, trustedOnly defaults to false
  if (!securityConfig?.trustedOnly) {
    return { allowed: true };
  }

  // trustedOnly is true: block untrusted/unknown
  return {
    allowed: false,
    reason: `Trust policy requires trusted servers only. Server is ${trust.level}: ${trust.reason}`,
  };
}

/**
 * Get warning message for untrusted install (when allowed but not trusted)
 * Returns null if no warning needed (trusted server)
 */
export function getInstallWarning(trust: TrustInfo): string | null {
  if (trust.level === 'trusted') {
    return null;
  }

  return `Installing ${trust.level} server: ${trust.reason}`;
}

/**
 * Format trust badge for CLI display
 * Example: "[trusted:npm-scope]" or "[untrusted:smithery]"
 */
export function formatTrustBadge(trust: TrustInfo): string {
  return `[${trust.level}:${trust.root}]`;
}

/**
 * Format trust badge with ANSI colors for terminal
 */
export function formatTrustBadgeColor(trust: TrustInfo): string {
  const badge = formatTrustBadge(trust);

  switch (trust.level) {
    case 'trusted':
      return `\x1b[32m${badge}\x1b[0m`; // green
    case 'untrusted':
      return `\x1b[33m${badge}\x1b[0m`; // yellow
    case 'unknown':
      return `\x1b[90m${badge}\x1b[0m`; // gray
  }
}

// --- Helper functions ---

/**
 * Find npm package in packages array
 */
function findNpmPackage(packages?: PackageInfo[]): PackageInfo | undefined {
  return packages?.find((p) => p.registryType === 'npm');
}

/**
 * Extract npm scope from package identifier
 * Example: "@modelcontextprotocol/server-time" → "@modelcontextprotocol"
 * Returns null if no scope (unscoped package)
 */
function extractNpmScope(identifier: string): string | null {
  if (!identifier.startsWith('@')) {
    return null;
  }
  const slashIndex = identifier.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  return identifier.slice(0, slashIndex);
}
