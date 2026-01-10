/**
 * GitHub Reference Servers Client
 *
 * Fetches official MCP reference servers from modelcontextprotocol/servers repository.
 * Uses package.json for accurate name/version information, with hardcoded fallback.
 */

import type { ServerInfo, PackageInfo } from './client.js';

/** GitHub raw content base URL */
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/modelcontextprotocol/servers/main';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Reference server directory paths in the repo
 */
export const REFERENCE_SERVER_DIRS = [
  'src/everything',
  'src/fetch',
  'src/filesystem',
  'src/git',
  'src/memory',
  'src/sequentialthinking',
  'src/time',
] as const;

/**
 * Fallback server definitions (used when package.json fetch fails)
 */
export const FALLBACK_SERVERS: ServerInfo[] = [
  {
    name: '@modelcontextprotocol/server-everything',
    description: 'Reference / test server with prompts, resources, and tools',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-everything' }],
  },
  {
    name: '@modelcontextprotocol/server-fetch',
    description: 'Web content fetching and conversion for efficient LLM usage',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-fetch' }],
  },
  {
    name: '@modelcontextprotocol/server-filesystem',
    description: 'Secure file operations with configurable access controls',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-filesystem' }],
  },
  {
    name: '@modelcontextprotocol/server-git',
    description: 'Tools to read, search, and manipulate Git repositories',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-git' }],
  },
  {
    name: '@modelcontextprotocol/server-memory',
    description: 'Knowledge graph-based persistent memory system',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-memory' }],
  },
  {
    name: '@modelcontextprotocol/server-sequential-thinking',
    description: 'Dynamic and reflective problem-solving through thought sequences',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-sequential-thinking' }],
  },
  {
    name: '@modelcontextprotocol/server-time',
    description: 'Time and timezone conversion capabilities',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-time' }],
  },
];

/**
 * package.json structure (relevant fields only)
 */
interface PackageJson {
  name: string;
  version?: string;
  description?: string;
}

/**
 * GitHub Reference Servers Registry Client
 *
 * Fetches package.json from each reference server directory to get
 * accurate name, version, and description. Falls back to hardcoded
 * definitions if fetch fails.
 */
export class GitHubRegistryClient {
  /** In-memory cache for server list */
  private cache: { servers: ServerInfo[]; timestamp: number } | null = null;

  /**
   * Clear the server cache
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * List all reference servers
   * Results are cached for CACHE_TTL_MS
   */
  async listServers(): Promise<ServerInfo[]> {
    // Return cached data if still valid
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < CACHE_TTL_MS) {
      return this.cache.servers;
    }

    // Fetch all servers in parallel
    const serverPromises = REFERENCE_SERVER_DIRS.map((dir, index) =>
      this.fetchPackageJson(dir, FALLBACK_SERVERS[index])
    );

    const servers = await Promise.all(serverPromises);

    // Update cache
    this.cache = { servers, timestamp: Date.now() };

    return servers;
  }

  /**
   * Search reference servers by query (case-insensitive)
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
   * Get a specific server by name (exact or suffix match)
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

    // Try suffix match (e.g., "fetch" matches "@modelcontextprotocol/server-fetch")
    const suffixMatch = servers.find((s) => {
      const serverName = s.name?.toLowerCase() || '';
      return (
        serverName.endsWith('/' + lowerName) ||
        serverName.endsWith('-' + lowerName) ||
        serverName.endsWith('server-' + lowerName)
      );
    });

    return suffixMatch || null;
  }

  /**
   * Fetch package.json from GitHub raw URL and convert to ServerInfo
   *
   * @param dir - Directory path (e.g., 'src/fetch')
   * @param fallback - Fallback ServerInfo if fetch fails
   * @returns ServerInfo from package.json or fallback
   */
  private async fetchPackageJson(dir: string, fallback: ServerInfo): Promise<ServerInfo> {
    const url = `${GITHUB_RAW_BASE}/${dir}/package.json`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'proofscan-cli',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Return fallback on non-200 response
        return fallback;
      }

      const pkg = (await response.json()) as PackageJson;

      // Build ServerInfo from package.json
      const serverInfo: ServerInfo = {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        packages: [
          {
            registryType: 'npm',
            identifier: pkg.name,
            version: pkg.version,
          },
        ],
      };

      return serverInfo;
    } catch {
      // Return fallback on any error (network, timeout, parse)
      return fallback;
    }
  }
}

/** Singleton instance */
export const githubClient = new GitHubRegistryClient();
