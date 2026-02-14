/**
 * Fastify HTTP server for Protocol Gateway
 * Phase 8.1: HTTP server foundation
 * Phase 8.2: Bearer Token Authentication
 * Phase 8.3: MCP Proxy
 * Phase 8.4: A2A Proxy
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GatewayConfig, createGatewayConfig } from './config.js';
import { generateRequestId } from './requestId.js';
import { createLogger, Logger } from './logger.js';
import { createAuthMiddleware, AuthInfo } from './authMiddleware.js';
import { createMCPProxyHandler, MCPProxyRequest } from './mcpProxy.js';
import { createA2AProxyHandler, A2AProxyRequest } from './a2aProxy.js';

export interface GatewayServer {
  /** Fastify instance */
  server: FastifyInstance;
  /** Start the server */
  start(): Promise<string>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Get server address */
  address(): string | null;
}

/**
 * Options for creating gateway server
 */
export interface GatewayServerOptions {
  /** Gateway configuration overrides */
  config?: Partial<GatewayConfig>;
  /** Config directory for connector loading */
  configDir?: string;
  /** Custom logger */
  logger?: Logger;
  /** Hide not found as 403 (security feature, default: true) */
  hideNotFound?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    auth?: AuthInfo;
  }
}

/**
 * Create and configure the gateway server
 * @deprecated Use createGatewayServer(options) instead
 */
export function createGatewayServer(
  configOrOptions?: Partial<GatewayConfig> | GatewayServerOptions,
  logger?: Logger
): GatewayServer {
  // Handle both old and new API
  let options: GatewayServerOptions;
  if (configOrOptions && 'config' in configOrOptions) {
    options = configOrOptions as GatewayServerOptions;
  } else {
    options = {
      config: configOrOptions as Partial<GatewayConfig> | undefined,
      logger,
    };
  }

  const fullConfig = createGatewayConfig(options.config ?? {});
  const log = options.logger ?? createLogger();
  const configDir = options.configDir;
  const hideNotFound = options.hideNotFound ?? true;

  // Create Fastify instance with custom request ID generation
  const server = Fastify({
    genReqId: () => generateRequestId(),
    bodyLimit: parseBodyLimit(fullConfig.limits.max_body_size),
    logger: false, // We use our own logger
  });

  // Add request_id to all requests
  server.addHook('onRequest', async (request: FastifyRequest) => {
    request.requestId = request.id as string;
  });

  // Add authentication middleware
  const authMiddleware = createAuthMiddleware(fullConfig.auth);
  server.addHook('preHandler', authMiddleware);

  // Log all requests
  server.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    log.info({
      event: 'http_request',
      request_id: request.requestId,
      client_id: request.auth?.client_id,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      latency_ms: Math.round(reply.elapsedTime),
    });
  });

  // Health check endpoint (public, no auth required)
  server.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Test endpoint (requires auth)
  server.get('/test', async (request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: 'ok',
      client_id: request.auth?.client_id,
      timestamp: new Date().toISOString(),
    };
  });

  // MCP Proxy endpoint (Phase 8.3)
  if (configDir) {
    const mcpProxyHandler = createMCPProxyHandler({
      configDir,
      limits: fullConfig.limits,
      hideNotFound,
    });

    server.post<{ Body: MCPProxyRequest }>(
      '/mcp/v1/message',
      mcpProxyHandler
    );

    log.info({ event: 'mcp_proxy_enabled', configDir });

    // A2A Proxy endpoints (Phase 8.4)
    const a2aProxyHandler = createA2AProxyHandler({
      configDir,
      limits: fullConfig.limits,
      hideNotFound,
    });

    // All A2A endpoints use the same handler - method is specified in request body
    server.post<{ Body: A2AProxyRequest }>(
      '/a2a/v1/message/send',
      a2aProxyHandler
    );

    server.post<{ Body: A2AProxyRequest }>(
      '/a2a/v1/tasks/send',
      a2aProxyHandler
    );

    server.post<{ Body: A2AProxyRequest }>(
      '/a2a/v1/tasks/get',
      a2aProxyHandler
    );

    server.post<{ Body: A2AProxyRequest }>(
      '/a2a/v1/tasks/cancel',
      a2aProxyHandler
    );

    log.info({ event: 'a2a_proxy_enabled', configDir });
  }

  // Graceful shutdown handlers
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info({ event: 'server_shutdown', signal });

    try {
      await server.close();
      log.info({ event: 'server_stopped' });
      process.exit(0);
    } catch (error) {
      log.error({
        event: 'server_shutdown_error',
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  // Store cleanup functions for later removal
  const signalHandlers: { [signal: string]: () => void } = {};

  const removeSignalHandlers = () => {
    for (const [signal, handler] of Object.entries(signalHandlers)) {
      process.removeListener(signal, handler);
    }
    // Clear the handlers object
    for (const key of Object.keys(signalHandlers)) {
      delete signalHandlers[key];
    }
  };

  return {
    server,

    async start(): Promise<string> {
      // Clear existing signal handlers to prevent memory leak on multiple start() calls
      if (Object.keys(signalHandlers).length > 0) {
        removeSignalHandlers();
      }

      // Register signal handlers
      signalHandlers['SIGINT'] = () => { void shutdown('SIGINT'); };
      signalHandlers['SIGTERM'] = () => { void shutdown('SIGTERM'); };

      process.on('SIGINT', signalHandlers['SIGINT']);
      process.on('SIGTERM', signalHandlers['SIGTERM']);

      await server.listen({
        port: fullConfig.port,
        host: fullConfig.host,
      });

      const addr = this.address();
      log.info({
        event: 'server_started',
        host: fullConfig.host,
        port: fullConfig.port,
        address: addr,
      });

      return addr ?? `http://${fullConfig.host}:${fullConfig.port}`;
    },

    async stop(): Promise<void> {
      // Remove signal handlers
      removeSignalHandlers();

      if (!isShuttingDown) {
        await server.close();
        log.info({ event: 'server_stopped' });
      }
    },

    address(): string | null {
      const addresses = server.addresses();
      if (addresses.length === 0) return null;
      const addr = addresses[0];
      return `http://${addr.address}:${addr.port}`;
    },
  };
}

/** Maximum body limit: 100MB */
const MAX_BODY_LIMIT = 100 * 1024 * 1024;

/**
 * Parse body limit string to bytes
 * @param limit e.g., "1mb", "512kb", "1024"
 */
function parseBodyLimit(limit: string): number {
  const match = limit.match(/^(\d+)(kb|mb|gb)?$/i);
  if (!match) return 1024 * 1024; // default 1mb

  const value = parseInt(match[1], 10);
  const unit = (match[2] || '').toLowerCase();

  let bytes: number;
  switch (unit) {
    case 'kb':
      bytes = value * 1024;
      break;
    case 'mb':
      bytes = value * 1024 * 1024;
      break;
    case 'gb':
      bytes = value * 1024 * 1024 * 1024;
      break;
    default:
      bytes = value;
  }

  // Enforce upper bound
  if (bytes > MAX_BODY_LIMIT) {
    return MAX_BODY_LIMIT;
  }

  return bytes;
}
