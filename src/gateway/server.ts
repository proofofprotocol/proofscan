/**
 * Fastify HTTP server for Protocol Gateway
 * Phase 8.1: HTTP server foundation
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GatewayConfig, createGatewayConfig } from './config.js';
import { generateRequestId } from './requestId.js';
import { createLogger, Logger } from './logger.js';

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

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

/**
 * Create and configure the gateway server
 */
export function createGatewayServer(
  config: Partial<GatewayConfig> = {},
  logger?: Logger
): GatewayServer {
  const fullConfig = createGatewayConfig(config);
  const log = logger ?? createLogger();

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

  // Log all requests
  server.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    log.info({
      event: 'http_request',
      request_id: request.requestId,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      latency_ms: Math.round(reply.elapsedTime),
    });
  });

  // Health check endpoint
  server.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

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
