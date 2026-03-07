/**
 * ProofPortal - Fastify route registration
 * Phase 4: ProofPortal MVP
 *
 * Registers portal routes on the Gateway Fastify server.
 * Portal is read-only and consumes SSE events from /events/stream
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { renderDashboard } from './templates/index.js';

/**
 * Options for registering portal routes
 */
export interface PortalRoutesOptions {
  /** Base path for portal routes (default: '/portal') */
  basePath?: string;
}

/**
 * Register ProofPortal routes on a Fastify instance
 *
 * Routes:
 * - GET /portal - Main dashboard (HTML)
 * - GET /portal/api/status - Portal status (JSON)
 */
export function registerPortalRoutes(
  fastify: FastifyInstance,
  options: PortalRoutesOptions = {}
): void {
  const basePath = options.basePath ?? '/portal';

  // GET /portal - Main dashboard
  fastify.get(basePath, async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = renderDashboard({
      generatedAt: new Date().toISOString(),
    });

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(html);
  });

  // GET /portal/ - Also handle trailing slash
  fastify.get(`${basePath}/`, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(basePath);
  });

  // GET /portal/api/status - Portal status (JSON)
  fastify.get(`${basePath}/api/status`, async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '4.0.0',
      mode: 'sse',
    };
  });
}
