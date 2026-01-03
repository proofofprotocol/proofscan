/**
 * Request Router (Phase 5.0)
 *
 * Routes tools/call requests to the appropriate backend connector
 * based on the namespace prefix.
 */

import { callTool } from '../tools/adapter.js';
import { logger } from './logger.js';
import type { ProxyOptions, RouteResult } from './types.js';
import { ToolAggregator } from './tool-aggregator.js';

/**
 * Routes tool call requests to backend connectors
 */
export class RequestRouter {
  private readonly aggregator: ToolAggregator;
  private readonly configDir: string;

  constructor(options: ProxyOptions, aggregator: ToolAggregator) {
    this.aggregator = aggregator;
    this.configDir = options.configDir;
  }

  /**
   * Route a tools/call request to the appropriate backend
   *
   * @param namespacedName - Tool name with namespace prefix (e.g., "time__get_current_time")
   * @param args - Tool arguments
   * @returns Route result with content or error
   */
  async routeToolCall(
    namespacedName: string,
    args: Record<string, unknown>
  ): Promise<RouteResult> {
    // Parse namespace
    const parsed = this.aggregator.parseNamespace(namespacedName);

    if (!parsed) {
      logger.error(`Invalid namespace format: ${namespacedName}`);
      return {
        success: false,
        error: `Invalid tool name format. Expected: <connector>__<tool>, got: ${namespacedName}`,
      };
    }

    const { connectorId, toolName } = parsed;
    logger.info(`Routing → connector=${connectorId} tool=${toolName}`);

    // Find connector
    const connector = this.aggregator.findConnector(connectorId);

    if (!connector) {
      logger.error(`Connector not found: ${connectorId}`);
      return {
        success: false,
        error: `Connector not found: ${connectorId}`,
      };
    }

    if (!connector.enabled) {
      logger.error(`Connector disabled: ${connectorId}`);
      return {
        success: false,
        error: `Connector is disabled: ${connectorId}`,
      };
    }

    // Call the backend tool
    const ctx = {
      connectorId,
      configDir: this.configDir,
    };

    try {
      const result = await callTool(ctx, connector, toolName, args, {
        timeout: 30,
      });

      if (result.success) {
        logger.info(`Result: success sessionId=${result.sessionId.slice(0, 8)}`);
      } else {
        logger.error(`Result: failed sessionId=${result.sessionId.slice(0, 8)} error=${result.error}`);
      }

      return {
        success: result.success,
        content: result.content,
        isError: result.isError,
        error: result.error,
        sessionId: result.sessionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Backend call failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
