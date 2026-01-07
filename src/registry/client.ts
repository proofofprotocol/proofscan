/**
 * MCP Registry Client
 *
 * Thin client for fetching MCP server metadata from registry.
 * Designed to be easily replaceable if the registry API changes.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

/** Default registry base URL (v0 API) */
const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0';

/** Smithery registry base URL */
const SMITHERY_REGISTRY_URL = 'https://registry.smithery.ai';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Server transport configuration
 */
export interface ServerTransport {
  type: 'stdio' | 'sse' | string;
  command?: string;
  args?: string[];
  url?: string;
}

/**
 * Server metadata from registry
 */
export interface ServerInfo {
  name: string;
  description?: string;
  version?: string;
  versions?: string[];
  repository?: string;
  homepage?: string;
  transport?: ServerTransport;
  // Allow additional fields for future extensibility
  [key: string]: unknown;
}

/**
 * Registry client options
 */
export interface RegistryClientOptions {
  baseUrl?: string;
  timeout?: number;
  /** API key for authenticated registries (sent as Bearer token) */
  apiKey?: string;
}

/**
 * Raw server entry from registry v0 API
 */
interface RawServerEntry {
  server: {
    name: string;
    description?: string;
    version?: string;
    repository?: { url?: string; source?: string };
    websiteUrl?: string;
    packages?: Array<{ transport?: { type: string; command?: string; args?: string[] } }>;
    remotes?: Array<{ type: string; url?: string }>;
    [key: string]: unknown;
  };
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      isLatest?: boolean;
    };
  };
}

/**
 * Registry API response for server list
 */
interface RegistryListResponse {
  servers: RawServerEntry[];
  metadata?: {
    nextCursor?: string;
    count?: number;
  };
}

/**
 * Smithery server entry from their API
 */
interface SmitheryServerEntry {
  qualifiedName: string;
  displayName?: string | null;
  description?: string | null;
  iconUrl?: string | null;
  verified: boolean;
  useCount: number;
  remote: boolean;
  createdAt: string;
  homepage?: string;
}

/**
 * Smithery API response for server list
 */
interface SmitheryListResponse {
  servers: SmitheryServerEntry[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
}

/**
 * Smithery server detail response (GET /servers/{id})
 */
interface SmitheryServerDetail {
  qualifiedName: string;
  displayName?: string | null;
  description?: string | null;
  iconUrl?: string | null;
  remote: boolean;
  deploymentUrl?: string | null;
  connections?: Array<{
    type: string;
    url?: string;
    configSchema?: unknown;
  }>;
  security?: {
    scanPassed?: boolean;
  };
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }> | null;
}

/**
 * Error types for registry operations
 */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: 'NETWORK' | 'NOT_FOUND' | 'PARSE' | 'TIMEOUT' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * MCP Registry Client
 */
export class RegistryClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly apiKey?: string;
  private readonly isSmithery: boolean;

  /** In-memory cache for server list */
  private cache: { servers: ServerInfo[]; timestamp: number } | null = null;

  constructor(options: RegistryClientOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_REGISTRY_URL;
    this.timeout = options.timeout || REQUEST_TIMEOUT_MS;
    this.apiKey = options.apiKey;
    // Detect Smithery registry by URL
    this.isSmithery = this.baseUrl.includes('smithery.ai');
  }

  /**
   * Clear the server cache
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * List all servers from registry (latest versions only)
   * Results are cached for CACHE_TTL_MS to avoid repeated fetches
   */
  async listServers(): Promise<ServerInfo[]> {
    // Return cached data if still valid
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < CACHE_TTL_MS) {
      return this.cache.servers;
    }

    const allServers: ServerInfo[] = [];
    let cursor: string | undefined;

    // Paginate through all results
    do {
      const url = cursor
        ? `${this.baseUrl}/servers?cursor=${encodeURIComponent(cursor)}`
        : `${this.baseUrl}/servers`;
      const response = await this.fetch(url);

      try {
        const data = (await response.json()) as RegistryListResponse;
        const rawServers = data.servers || [];

        // Filter to latest versions only and map to ServerInfo
        for (const entry of rawServers) {
          const isLatest = entry._meta?.['io.modelcontextprotocol.registry/official']?.isLatest;
          if (isLatest) {
            allServers.push(this.mapRawToServerInfo(entry));
          }
        }

        cursor = data.metadata?.nextCursor;
      } catch {
        throw new RegistryError('Failed to parse registry response', 'PARSE');
      }
    } while (cursor);

    // Update cache
    this.cache = { servers: allServers, timestamp: Date.now() };

    return allServers;
  }

  /**
   * Map raw registry entry to ServerInfo
   */
  private mapRawToServerInfo(entry: RawServerEntry): ServerInfo {
    const raw = entry.server;
    const info: ServerInfo = {
      name: raw.name,
      description: raw.description,
      version: raw.version,
    };

    // Map repository
    if (raw.repository?.url) {
      info.repository = raw.repository.url;
    }

    // Map homepage/websiteUrl
    if (raw.websiteUrl) {
      info.homepage = raw.websiteUrl;
    }

    // Map transport from packages or remotes
    if (raw.packages && raw.packages.length > 0 && raw.packages[0].transport) {
      info.transport = raw.packages[0].transport as ServerTransport;
    } else if (raw.remotes && raw.remotes.length > 0) {
      info.transport = {
        type: raw.remotes[0].type,
        url: raw.remotes[0].url,
      };
    }

    return info;
  }

  /**
   * Search servers by query
   * - Smithery: Uses server-side semantic search via API
   * - Official: Uses client-side filter on cached list
   */
  async searchServers(query: string): Promise<ServerInfo[]> {
    if (this.isSmithery) {
      return this.searchSmitheryServers(query);
    }

    // Official registry: client-side filter
    const servers = await this.listServers();
    const lowerQuery = query.toLowerCase();

    return servers.filter((server) => {
      const name = server.name?.toLowerCase() || '';
      const desc = server.description?.toLowerCase() || '';
      return name.includes(lowerQuery) || desc.includes(lowerQuery);
    });
  }

  /**
   * Search Smithery servers using their API (server-side semantic search)
   */
  private async searchSmitheryServers(query: string): Promise<ServerInfo[]> {
    const allServers: ServerInfo[] = [];
    let page = 1;
    const pageSize = 50; // Fetch more per page for efficiency
    let totalPages = 1;

    do {
      const url = `${this.baseUrl}/servers?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`;
      const response = await this.fetch(url);

      try {
        const data = (await response.json()) as SmitheryListResponse;

        // Map Smithery entries to ServerInfo
        for (const entry of data.servers) {
          allServers.push(this.mapSmitheryToServerInfo(entry));
        }

        totalPages = data.pagination.totalPages;
        page++;
      } catch {
        throw new RegistryError('Failed to parse Smithery response', 'PARSE');
      }
    } while (page <= totalPages && page <= 5); // Limit to 5 pages (250 results max)

    return allServers;
  }

  /**
   * Map Smithery server entry to ServerInfo
   */
  private mapSmitheryToServerInfo(entry: SmitheryServerEntry): ServerInfo {
    return {
      name: entry.qualifiedName,
      description: entry.description ?? undefined,
      homepage: entry.homepage,
      // Smithery-specific fields stored as additional properties
      verified: entry.verified,
      useCount: entry.useCount,
      remote: entry.remote,
    };
  }

  /**
   * Get server details by name (exact match or suffix match)
   * - Smithery: Uses direct API call GET /servers/{id}
   * - Official: Uses cached list with client-side matching
   */
  async getServer(name: string): Promise<ServerInfo | null> {
    if (this.isSmithery) {
      return this.getSmitheryServer(name);
    }

    // Official registry: client-side matching from cached list
    const servers = await this.listServers();
    const lowerName = name.toLowerCase();

    // Try exact match first
    const exactMatch = servers.find(
      (s) => s.name?.toLowerCase() === lowerName
    );
    if (exactMatch) {
      return exactMatch;
    }

    // Try suffix match (e.g., "exa" matches "ai.exa/exa")
    const suffixMatch = servers.find((s) => {
      const serverName = s.name?.toLowerCase() || '';
      return serverName.endsWith('/' + lowerName) || serverName.endsWith('.' + lowerName);
    });

    return suffixMatch || null;
  }

  /**
   * Get Smithery server by qualified name using their API
   */
  private async getSmitheryServer(name: string): Promise<ServerInfo | null> {
    // Smithery uses qualifiedName format like "smithery/hello-world" or "@user/repo"
    // Try direct lookup first
    const url = `${this.baseUrl}/servers/${encodeURIComponent(name)}`;

    try {
      const response = await this.fetch(url);
      const data = (await response.json()) as SmitheryServerDetail;

      return this.mapSmitheryDetailToServerInfo(data);
    } catch (e) {
      if (e instanceof RegistryError && e.code === 'NOT_FOUND') {
        // If not found with direct name, try searching and matching
        const searchResults = await this.searchSmitheryServers(name);
        if (searchResults.length > 0) {
          // Return first match that ends with the name
          const lowerName = name.toLowerCase();
          const match = searchResults.find((s) => {
            const serverName = s.name?.toLowerCase() || '';
            return (
              serverName === lowerName ||
              serverName.endsWith('/' + lowerName) ||
              serverName.endsWith('-' + lowerName)
            );
          });
          return match || searchResults[0];
        }
        return null;
      }
      throw e;
    }
  }

  /**
   * Map Smithery server detail to ServerInfo
   */
  private mapSmitheryDetailToServerInfo(detail: SmitheryServerDetail): ServerInfo {
    const info: ServerInfo = {
      name: detail.qualifiedName,
      description: detail.description ?? undefined,
      remote: detail.remote,
    };

    // Map deployment URL as homepage
    if (detail.deploymentUrl) {
      info.homepage = detail.deploymentUrl;
    }

    // Map connections to transport
    if (detail.connections && detail.connections.length > 0) {
      const conn = detail.connections[0];
      info.transport = {
        type: conn.type,
        url: conn.url,
      };
    }

    // Store tools info if available
    if (detail.tools) {
      info.tools = detail.tools;
    }

    return info;
  }

  /**
   * Fetch with timeout and error handling
   */
  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': `proofscan-cli/${PKG_VERSION}`,
      };

      // Add Authorization header if API key is set
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new RegistryError(`Not found: ${url}`, 'NOT_FOUND');
        }
        throw new RegistryError(
          `HTTP ${response.status}: ${response.statusText}`,
          'NETWORK'
        );
      }

      return response;
    } catch (e) {
      if (e instanceof RegistryError) {
        throw e;
      }
      if (e instanceof Error) {
        if (e.name === 'AbortError') {
          throw new RegistryError('Request timed out', 'TIMEOUT');
        }
        // Network errors (DNS, connection refused, etc.)
        throw new RegistryError(`Network error: ${e.message}`, 'NETWORK');
      }
      throw new RegistryError('Unknown error', 'UNKNOWN');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Supported fields for `catalog view <server> <field>`
 */
export const SUPPORTED_FIELDS = [
  'name',
  'description',
  'version',
  'versions',
  'repository',
  'homepage',
  'transport',
] as const;

export type SupportedField = (typeof SUPPORTED_FIELDS)[number];

/**
 * Check if a field is supported
 */
export function isSupportedField(field: string): field is SupportedField {
  return (SUPPORTED_FIELDS as readonly string[]).includes(field);
}

/**
 * Get field value from server info
 */
export function getFieldValue(server: ServerInfo, field: SupportedField): unknown {
  return server[field];
}

/**
 * Format field value for display
 */
export function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '(not set)';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
