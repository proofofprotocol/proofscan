/**
 * npm Registry Client
 *
 * Searches npm registry for MCP server packages.
 * Uses the npm search API to find packages with MCP-related keywords.
 */

import type { ServerInfo, PackageInfo } from './client.js';
import { DEFAULT_TRUSTED_NPM_SCOPES } from './trust.js';

/** npm registry search API URL */
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

/** npm package details API URL */
const NPM_PACKAGE_URL = 'https://registry.npmjs.org';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

/** Default maximum results per search */
const DEFAULT_SEARCH_SIZE = 50;

/** Maximum results to return */
const MAX_SEARCH_SIZE = 250;

/**
 * npm search API response
 */
interface NpmSearchResponse {
  objects: Array<{
    package: NpmPackageResult;
    score: {
      final: number;
      detail: { quality: number; popularity: number; maintenance: number };
    };
    searchScore: number;
  }>;
  total: number;
  time: string;
}

/**
 * npm package result from search
 */
interface NpmPackageResult {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  repository?: { url?: string };
  homepage?: string;
  author?: { name?: string; email?: string };
  publisher?: { username?: string };
  maintainers?: Array<{ username: string }>;
  links?: { npm?: string; homepage?: string; repository?: string };
}

/**
 * npm package details (from registry.npmjs.org/<package>)
 */
interface NpmPackageDetails {
  name: string;
  version?: string;
  description?: string;
  keywords?: string[];
  repository?: { type?: string; url?: string };
  homepage?: string;
  'dist-tags'?: { latest?: string };
  versions?: Record<string, { version: string; description?: string }>;
}

/**
 * Search options for npm registry
 */
export interface NpmSearchOptions {
  /** Search query text */
  query: string;
  /** npm scopes to search within (e.g., ['@modelcontextprotocol']) */
  scopes?: string[];
  /** Maximum results (default: 50, max: 250) */
  size?: number;
}

/**
 * npm Registry Client
 *
 * Searches npm registry for MCP server packages and converts
 * results to ServerInfo format compatible with proofscan catalog.
 */
export class NpmRegistryClient {
  /**
   * Search for MCP servers in npm registry
   *
   * By default, searches within trusted scopes (DEFAULT_TRUSTED_NPM_SCOPES).
   * Results include package info for stdio installation.
   */
  async searchServers(options: NpmSearchOptions): Promise<ServerInfo[]> {
    const { query, scopes = DEFAULT_TRUSTED_NPM_SCOPES, size = DEFAULT_SEARCH_SIZE } = options;
    const effectiveSize = Math.min(size, MAX_SEARCH_SIZE);

    // Build search query with scope filter
    // npm search API: text=scope:@modelcontextprotocol+query
    const searchTerms: string[] = [];

    // Add scope filters
    for (const scope of scopes) {
      searchTerms.push(`scope:${scope}`);
    }

    // Add user query and MCP keyword
    if (query) {
      searchTerms.push(query);
    }
    searchTerms.push('mcp');

    const textQuery = searchTerms.join(' ');
    const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(textQuery)}&size=${effectiveSize}`;

    try {
      const response = await this.fetch(url);
      const data = (await response.json()) as NpmSearchResponse;

      // Map results to ServerInfo
      return data.objects.map((obj) => this.mapToServerInfo(obj.package));
    } catch {
      // Return empty on error (network, parse, timeout)
      return [];
    }
  }

  /**
   * Get package details by name
   *
   * @param name - Package name (e.g., '@modelcontextprotocol/server-time')
   * @returns ServerInfo or null if not found
   */
  async getPackage(name: string): Promise<ServerInfo | null> {
    const url = `${NPM_PACKAGE_URL}/${encodeURIComponent(name)}`;

    try {
      const response = await this.fetch(url);
      const pkg = (await response.json()) as NpmPackageDetails;

      return this.mapDetailsToServerInfo(pkg);
    } catch {
      return null;
    }
  }

  /**
   * Map npm search result to ServerInfo
   */
  private mapToServerInfo(pkg: NpmPackageResult): ServerInfo {
    const serverInfo: ServerInfo = {
      name: pkg.name,
      description: pkg.description,
      version: pkg.version,
    };

    // Repository URL
    if (pkg.repository?.url) {
      serverInfo.repository = this.normalizeRepoUrl(pkg.repository.url);
    } else if (pkg.links?.repository) {
      serverInfo.repository = pkg.links.repository;
    }

    // Homepage
    if (pkg.homepage) {
      serverInfo.homepage = pkg.homepage;
    } else if (pkg.links?.homepage) {
      serverInfo.homepage = pkg.links.homepage;
    }

    // Package info for stdio install
    serverInfo.packages = [
      {
        registryType: 'npm',
        identifier: pkg.name,
        version: pkg.version,
      },
    ];

    return serverInfo;
  }

  /**
   * Map npm package details to ServerInfo
   */
  private mapDetailsToServerInfo(pkg: NpmPackageDetails): ServerInfo {
    const latestVersion = pkg['dist-tags']?.latest || pkg.version;
    const versionInfo = latestVersion ? pkg.versions?.[latestVersion] : undefined;

    const serverInfo: ServerInfo = {
      name: pkg.name,
      description: versionInfo?.description || pkg.description,
      version: latestVersion,
    };

    // Repository URL
    if (pkg.repository?.url) {
      serverInfo.repository = this.normalizeRepoUrl(pkg.repository.url);
    }

    // Homepage
    if (pkg.homepage) {
      serverInfo.homepage = pkg.homepage;
    }

    // Package info for stdio install
    serverInfo.packages = [
      {
        registryType: 'npm',
        identifier: pkg.name,
        version: latestVersion,
      },
    ];

    // Store available versions
    if (pkg.versions) {
      serverInfo.versions = Object.keys(pkg.versions);
    }

    return serverInfo;
  }

  /**
   * Normalize repository URL (remove git+ prefix, .git suffix)
   */
  private normalizeRepoUrl(url: string): string {
    return url
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^git:\/\//, 'https://');
  }

  /**
   * Fetch with timeout and error handling
   */
  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'proofscan-cli',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Singleton instance */
export const npmClient = new NpmRegistryClient();
