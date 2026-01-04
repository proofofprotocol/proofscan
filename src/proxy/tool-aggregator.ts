/**
 * Tool Aggregator (Phase 5.0)
 *
 * Aggregates tools from multiple backend connectors and provides
 * namespace-prefixed tool names for the proxy.
 */

import type { Connector } from '../types/index.js';
import { listTools, type ToolInfo } from '../tools/adapter.js';
import { logger } from './logger.js';
import {
  NAMESPACE_SEPARATOR,
  DEFAULT_TIMEOUT,
  type ProxyOptions,
  type NamespacedTool,
  type ParsedNamespace,
} from './types.js';

/**
 * Aggregates tools from multiple MCP connectors
 */
export class ToolAggregator {
  private readonly connectors: Connector[];
  private readonly configDir: string;
  private readonly timeout: number;

  /** Cached tools from all connectors */
  private cachedTools: NamespacedTool[] | null = null;

  /** Whether initial loading is in progress */
  private loadingPromise: Promise<NamespacedTool[]> | null = null;

  constructor(options: ProxyOptions) {
    this.connectors = options.connectors;
    this.configDir = options.configDir;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Preload tools from all connectors (eager loading)
   *
   * Should be called during proxy startup to avoid cold start delays
   * when the first tools/list request arrives.
   */
  async preloadTools(): Promise<void> {
    logger.info('Preloading tools from all connectors...', 'aggregator');
    try {
      await this.loadToolsFromConnectors();
      logger.info(`Preloaded ${this.cachedTools?.length ?? 0} tool(s)`, 'aggregator');
    } catch (error) {
      logger.warn(`Preload failed: ${error instanceof Error ? error.message : error}`, 'aggregator');
      // Continue anyway - will retry on first tools/list
    }
  }

  /**
   * Invalidate cached tools (force reload on next request)
   */
  invalidateCache(): void {
    this.cachedTools = null;
    this.loadingPromise = null;
  }

  /**
   * Get all tools from all connectors with namespace prefixes
   *
   * Uses cached tools if available, otherwise loads from connectors.
   * Multiple concurrent calls will share the same loading promise.
   */
  async getAggregatedTools(): Promise<NamespacedTool[]> {
    // Return cached tools if available
    if (this.cachedTools !== null) {
      return this.cachedTools;
    }

    // If loading is in progress, wait for it
    if (this.loadingPromise !== null) {
      return this.loadingPromise;
    }

    // Start loading
    return this.loadToolsFromConnectors();
  }

  /**
   * Load tools from all connectors (internal)
   *
   * Each connector is queried in parallel. Failed connectors are logged
   * as warnings and skipped (partial success behavior).
   */
  private async loadToolsFromConnectors(): Promise<NamespacedTool[]> {
    // Create loading promise to prevent duplicate loads
    this.loadingPromise = this.doLoadTools();

    try {
      const tools = await this.loadingPromise;
      this.cachedTools = tools;
      return tools;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Actual tool loading logic
   */
  private async doLoadTools(): Promise<NamespacedTool[]> {
    const allTools: NamespacedTool[] = [];

    // Query all connectors in parallel
    const results = await Promise.allSettled(
      this.connectors.map(async (connector) => {
        const ctx = {
          connectorId: connector.id,
          configDir: this.configDir,
        };

        const result = await listTools(ctx, connector, { timeout: this.timeout });

        if (result.error) {
          throw new Error(result.error);
        }

        return {
          connectorId: connector.id,
          tools: result.tools,
          sessionId: result.sessionId,
        };
      })
    );

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const connector = this.connectors[i];

      if (result.status === 'rejected') {
        logger.warn(`Failed to list tools from ${connector.id}: ${result.reason}`);
        continue;
      }

      const { connectorId, tools, sessionId } = result.value;
      logger.info(`Listed ${tools.length} tool(s) from ${connectorId} (session=${sessionId.slice(0, 8)})`);

      // Add namespace prefix to each tool
      for (const tool of tools) {
        allTools.push(this.addNamespace(connectorId, tool));
      }
    }

    return allTools;
  }

  /**
   * Add namespace prefix to a tool
   *
   * Warns if connector ID or tool name contains the namespace separator,
   * as this can cause ambiguous parsing.
   */
  private addNamespace(connectorId: string, tool: ToolInfo): NamespacedTool {
    // Warn about potential namespace collisions
    if (connectorId.includes(NAMESPACE_SEPARATOR)) {
      logger.warn(`Connector ID contains separator '${NAMESPACE_SEPARATOR}': ${connectorId}`);
    }
    if (tool.name.includes(NAMESPACE_SEPARATOR)) {
      logger.warn(`Tool name contains separator '${NAMESPACE_SEPARATOR}': ${tool.name} in ${connectorId}`);
    }

    return {
      ...tool,
      connectorId,
      namespacedName: `${connectorId}${NAMESPACE_SEPARATOR}${tool.name}`,
    };
  }

  /**
   * Parse a namespaced tool name into connector ID and tool name
   *
   * Returns null if the format is invalid.
   *
   * Valid format: <connectorId>__<toolName>
   * - connectorId and toolName must not be empty
   * - Uses __ (double underscore) as separator
   */
  parseNamespace(namespacedName: string): ParsedNamespace | null {
    const separatorIndex = namespacedName.indexOf(NAMESPACE_SEPARATOR);

    if (separatorIndex === -1) {
      return null;
    }

    const connectorId = namespacedName.slice(0, separatorIndex);
    const toolName = namespacedName.slice(separatorIndex + NAMESPACE_SEPARATOR.length);

    // Both parts must be non-empty
    if (!connectorId || !toolName) {
      return null;
    }

    return { connectorId, toolName };
  }

  /**
   * Find a connector by ID
   */
  findConnector(connectorId: string): Connector | undefined {
    return this.connectors.find((c) => c.id === connectorId);
  }
}
