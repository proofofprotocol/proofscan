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

  /** In-memory cache for server list */
  private cache: { servers: ServerInfo[]; timestamp: number } | null = null;

  constructor(options: RegistryClientOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_REGISTRY_URL;
    this.timeout = options.timeout || REQUEST_TIMEOUT_MS;
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
   * Search servers by query (client-side filter)
   * Matches against name and description
   */
  async searchServers(query: string): Promise<ServerInfo[]> {
    const servers = await this.listServers();
    const lowerQuery = query.toLowerCase();

    return servers.filter((server) => {
      const name = server.name?.toLowerCase() || '';
      const desc = server.description?.toLowerCase() || '';
      return name.includes(lowerQuery) || desc.includes(lowerQuery);
    });
  }

  /**
   * Get server details by name (exact match or suffix match)
   * Supports both full name (ai.exa/exa) and short name (exa)
   */
  async getServer(name: string): Promise<ServerInfo | null> {
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
   * Fetch with timeout and error handling
   */
  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': `proofscan-cli/${PKG_VERSION}`,
        },
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
