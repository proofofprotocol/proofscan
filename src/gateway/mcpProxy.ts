/**
 * MCP Proxy handler
 * Phase 8.3: MCP Proxy
 *
 * Routes MCP requests to appropriate connectors with:
 * - Registry check (connector existence + enabled)
 * - Permission check
 * - Queue management (serial model)
 * - Timeout handling
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthInfo } from './authMiddleware.js';
import { hasPermission, buildMCPPermission } from './permissions.js';
import { ConnectorQueueManager, QueueFullError, QueueTimeoutError } from './queue.js';
import { GatewayLimits } from './config.js';
import { ConfigManager } from '../config/manager.js';
import { join } from 'path';
import type { Connector, StdioTransport } from '../types/index.js';
import { StdioConnection, JsonRpcResponse } from '../transports/stdio.js';
import { resolveEnvSecrets } from '../secrets/resolve.js';

/**
 * MCP Proxy request body
 */
export interface MCPProxyRequest {
  /** Target connector ID */
  connector: string;
  /** MCP method (e.g., "tools/call", "resources/read") */
  method: string;
  /** MCP JSON-RPC params */
  params?: unknown;
}

/**
 * MCP Proxy response
 */
export interface MCPProxyResponse {
  /** JSON-RPC result (on success) */
  result?: unknown;
  /** Error (on failure) */
  error?: {
    code: string;
    message: string;
    request_id: string;
  };
}

/**
 * Error codes
 */
export const ErrorCodes = {
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_GATEWAY: 'BAD_GATEWAY',
} as const;

/**
 * Create error response
 */
function createErrorResponse(
  code: string,
  message: string,
  requestId: string
): MCPProxyResponse {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };
}

/**
 * MCP Proxy handler factory
 */
export interface MCPProxyOptions {
  /** Config directory path */
  configDir: string;
  /** Gateway limits */
  limits: GatewayLimits;
  /** Hide not found as 403 (security) */
  hideNotFound?: boolean;
}

/**
 * MCP request executor - calls connector via stdio
 */
async function executeMCPRequest(
  connector: Connector,
  method: string,
  params: unknown,
  configDir: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  if (connector.transport.type !== 'stdio') {
    return {
      error: {
        code: -32603,
        message: `Unsupported transport type: ${connector.transport.type}`,
      },
    };
  }

  const transport = connector.transport as StdioTransport;

  // Resolve secret refs in env vars
  const resolveResult = await resolveEnvSecrets(
    transport.env,
    connector.id,
    configDir
  );

  if (!resolveResult.success) {
    const errMsgs = resolveResult.errors.map((e) => `${e.key}: ${e.message}`).join('; ');
    return {
      error: {
        code: -32603,
        message: `Failed to resolve secrets: ${errMsgs}`,
      },
    };
  }

  // Create transport with resolved env
  const resolvedTransport: StdioTransport = {
    ...transport,
    env: { ...transport.env, ...resolveResult.envResolved },
  };

  const connection = new StdioConnection(resolvedTransport);

  // Handle abort signal
  const abortHandler = () => {
    connection.close();
  };
  signal.addEventListener('abort', abortHandler);

  try {
    // Connect
    await connection.connect();

    // Check abort after connect
    if (signal.aborted) {
      throw new Error('Request aborted');
    }

    // MCP handshake
    await connection.sendRequest(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'proofscan-gateway',
          version: '0.8.0',
        },
      },
      timeoutMs
    );

    connection.sendNotification('notifications/initialized', {});

    // Execute the actual request
    const response: JsonRpcResponse = await connection.sendRequest(method, params, timeoutMs);

    if (response.error) {
      return {
        error: {
          code: response.error.code,
          message: response.error.message,
        },
      };
    }

    return { result: response.result };
  } finally {
    signal.removeEventListener('abort', abortHandler);
    connection.close();
  }
}

/**
 * Create MCP Proxy handler
 */
export function createMCPProxyHandler(options: MCPProxyOptions) {
  const { configDir, limits, hideNotFound = true } = options;
  // ConfigManager expects a config file path, not a directory
  const configPath = join(configDir, 'config.json');
  const configManager = new ConfigManager(configPath);
  const queueManager = new ConnectorQueueManager<
    { method: string; params: unknown; connector: Connector },
    { result?: unknown; error?: { code: number; message: string } }
  >(limits);

  return async (
    request: FastifyRequest<{ Body: MCPProxyRequest }>,
    reply: FastifyReply
  ): Promise<MCPProxyResponse> => {
    const requestId = request.requestId;
    const auth = request.auth as AuthInfo;

    // Validate request body
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Invalid request body', requestId)
      );
    }

    const { connector: connectorId, method, params } = body;

    // Validate required fields
    if (!connectorId || typeof connectorId !== 'string') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Missing or invalid "connector" field', requestId)
      );
    }

    if (!method || typeof method !== 'string') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Missing or invalid "method" field', requestId)
      );
    }

    // 1. Permission check
    const requiredPermission = buildMCPPermission(method, connectorId);
    if (!hasPermission(auth.permissions, requiredPermission)) {
      return reply.code(403).send(
        createErrorResponse(
          ErrorCodes.FORBIDDEN,
          `Permission denied for ${requiredPermission}`,
          requestId
        )
      );
    }

    // 2. Get connector from registry
    let config;
    try {
      config = await configManager.load();
    } catch (error) {
      return reply.code(500).send(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to load config',
          requestId
        )
      );
    }

    const connector = config.connectors.find((c) => c.id === connectorId);

    // 3. Check connector exists and enabled
    if (!connector) {
      // Hide existence for security (403 instead of 404)
      if (hideNotFound) {
        return reply.code(403).send(
          createErrorResponse(
            ErrorCodes.FORBIDDEN,
            `Permission denied for ${requiredPermission}`,
            requestId
          )
        );
      }
      return reply.code(404).send(
        createErrorResponse(ErrorCodes.NOT_FOUND, `Connector not found: ${connectorId}`, requestId)
      );
    }

    if (!connector.enabled) {
      // Disabled connectors are treated as not found (for security)
      if (hideNotFound) {
        return reply.code(403).send(
          createErrorResponse(
            ErrorCodes.FORBIDDEN,
            `Permission denied for ${requiredPermission}`,
            requestId
          )
        );
      }
      return reply.code(404).send(
        createErrorResponse(ErrorCodes.NOT_FOUND, `Connector not found: ${connectorId}`, requestId)
      );
    }

    // 4. Queue and execute
    try {
      const { result: mcpResult, queueWaitMs, upstreamLatencyMs } = await queueManager.enqueue(
        connectorId,
        { method, params, connector },
        async (req, signal) => {
          return executeMCPRequest(
            req.connector,
            req.method,
            req.params,
            configDir,
            signal,
            limits.timeout_ms
          );
        }
      );

      // Add timing metrics to response headers
      reply.header('X-Queue-Wait-Ms', String(queueWaitMs));
      reply.header('X-Upstream-Latency-Ms', String(upstreamLatencyMs));

      // 5. Return response
      if (mcpResult.error) {
        const code = mcpResult.error.code;

        // JSON-RPC parse error from client
        if (code === -32700) {
          return reply.code(400).send(
            createErrorResponse(ErrorCodes.BAD_REQUEST, mcpResult.error.message, requestId)
          );
        }

        // JSON-RPC protocol/transport errors (-32600 to -32603)
        if (code >= -32603 && code <= -32600) {
          return reply.code(502).send(
            createErrorResponse(ErrorCodes.BAD_GATEWAY, mcpResult.error.message, requestId)
          );
        }

        // Application errors (connector returned error but communication succeeded)
        return reply.code(400).send(
          createErrorResponse(ErrorCodes.BAD_REQUEST, mcpResult.error.message, requestId)
        );
      }

      return { result: mcpResult.result };
    } catch (error) {
      // Queue errors
      if (error instanceof QueueFullError) {
        return reply.code(429).send(
          createErrorResponse(ErrorCodes.TOO_MANY_REQUESTS, error.message, requestId)
        );
      }

      if (error instanceof QueueTimeoutError) {
        return reply.code(504).send(
          createErrorResponse(ErrorCodes.GATEWAY_TIMEOUT, 'Request timeout', requestId)
        );
      }

      // Unexpected errors
      return reply.code(500).send(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Unknown error',
          requestId
        )
      );
    }
  };
}

/**
 * Shutdown queue manager (for graceful shutdown)
 */
export function createMCPProxyShutdown(queueManager: ConnectorQueueManager<unknown, unknown>) {
  return () => {
    queueManager.shutdown();
  };
}
