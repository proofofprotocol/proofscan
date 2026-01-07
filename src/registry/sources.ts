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
  /** pfscan secret key for API key (if auth required), e.g., "catalog.smithery.apiKey" */
  secretKey?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Built-in catalog sources
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
    secretKey: 'catalog.smithery',
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
 * Secret resolver function type
 * This will be set by catalog.ts to integrate with pfscan secrets
 */
export type SecretResolver = (secretKey: string) => Promise<string | undefined>;

/** Global secret resolver (set by catalog command) */
let secretResolver: SecretResolver | null = null;

/**
 * Set the secret resolver function
 */
export function setSecretResolver(resolver: SecretResolver): void {
  secretResolver = resolver;
}

/**
 * Get the API key for a source using pfscan secrets
 */
export async function getSourceApiKey(source: CatalogSource): Promise<string | undefined> {
  if (!source.authRequired || !source.secretKey) {
    return undefined;
  }
  if (!secretResolver) {
    return undefined;
  }
  return secretResolver(source.secretKey);
}

/**
 * Check if a source has required authentication configured
 * Note: This is a sync check that only verifies secretKey is defined.
 * Actual secret resolution happens asynchronously via getSourceApiKey.
 */
export function isSourceReady(source: CatalogSource): boolean {
  if (!source.authRequired) {
    return true;
  }
  // For auth-required sources, we check if secretKey is defined
  // The actual secret will be resolved asynchronously when needed
  return !!source.secretKey;
}

/**
 * Get error message for missing authentication
 */
export function getAuthErrorMessage(source: CatalogSource): string {
  if (!source.authRequired || !source.secretKey) {
    return '';
  }
  return `${source.name} requires API key. Set it with: pfscan secrets set ${source.secretKey}`;
}

/**
 * Format source info for display
 */
export function formatSourceLine(source: CatalogSource, isDefault: boolean): string {
  const marker = isDefault ? '*' : ' ';
  const authInfo = source.authRequired
    ? `(secret: ${source.secretKey})`
    : '(no auth)';
  return `${marker} ${source.name.padEnd(12)} ${source.baseUrl} ${authInfo}`;
}
