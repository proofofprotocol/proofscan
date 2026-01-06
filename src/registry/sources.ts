/**
 * Catalog Source Definitions
 *
 * Defines available MCP registry sources for catalog commands.
 * Sources can be switched via `catalog sources set <name>`.
 */

/**
 * Catalog source definition
 */
export interface CatalogSource {
  /** Unique identifier for the source */
  name: string;
  /** Base URL for the registry API */
  baseUrl: string;
  /** Whether authentication is required */
  authRequired: boolean;
  /** Environment variable name for API key (if auth required) */
  authEnvVar?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Built-in catalog sources
 *
 * Note: These are the initial sources. Future versions may support
 * user-defined sources via config.
 */
export const CATALOG_SOURCES: CatalogSource[] = [
  {
    name: 'official',
    baseUrl: 'https://registry.modelcontextprotocol.io/v0',
    authRequired: false,
    description: 'Official MCP Registry',
  },
  {
    name: 'smithery',
    baseUrl: 'https://registry.smithery.ai',
    authRequired: true,
    authEnvVar: 'SMITHERY_API_KEY',
    description: 'Smithery MCP Registry',
  },
];

/** Default source name */
export const DEFAULT_CATALOG_SOURCE = 'official';

/**
 * Get all available source names
 */
export function getSourceNames(): string[] {
  return CATALOG_SOURCES.map((s) => s.name);
}

/**
 * Get a source by name
 */
export function getSource(name: string): CatalogSource | undefined {
  return CATALOG_SOURCES.find((s) => s.name === name);
}

/**
 * Check if a source name is valid
 */
export function isValidSource(name: string): boolean {
  return CATALOG_SOURCES.some((s) => s.name === name);
}

/**
 * Get the API key for a source from environment
 */
export function getSourceApiKey(source: CatalogSource): string | undefined {
  if (!source.authRequired || !source.authEnvVar) {
    return undefined;
  }
  return process.env[source.authEnvVar];
}

/**
 * Check if a source has required authentication configured
 */
export function isSourceReady(source: CatalogSource): boolean {
  if (!source.authRequired) {
    return true;
  }
  return !!getSourceApiKey(source);
}

/**
 * Get error message for missing authentication
 */
export function getAuthErrorMessage(source: CatalogSource): string {
  if (!source.authRequired) {
    return '';
  }
  return `${source.name} catalog source requires ${source.authEnvVar} to be set.`;
}

/**
 * Format source info for display
 */
export function formatSourceLine(source: CatalogSource, isDefault: boolean): string {
  const marker = isDefault ? '*' : ' ';
  const authInfo = source.authRequired
    ? `(API key: ${source.authEnvVar})`
    : '(no auth)';
  return `${marker} ${source.name.padEnd(12)} ${source.baseUrl} ${authInfo}`;
}
