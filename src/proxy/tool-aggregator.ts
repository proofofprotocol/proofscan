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

  constructor(options: ProxyOptions) {
    this.connectors = options.connectors;
    this.configDir = options.configDir;
  }

  /**
   * Get all tools from all connectors with namespace prefixes
   *
   * Each connector is queried in parallel. Failed connectors are logged
   * as warnings and skipped (partial success behavior).
   */
  async getAggregatedTools(): Promise<NamespacedTool[]> {
    const allTools: NamespacedTool[] = [];

    // Query all connectors in parallel
    const results = await Promise.allSettled(
      this.connectors.map(async (connector) => {
        const ctx = {
          connectorId: connector.id,
          configDir: this.configDir,
        };

        const result = await listTools(ctx, connector, { timeout: 30 });

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
   */
  private addNamespace(connectorId: string, tool: ToolInfo): NamespacedTool {
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
