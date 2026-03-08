/**
 * ProofPortal - Fastify route registration
 * Phase 4: ProofPortal MVP
 *
 * Registers portal routes on the Gateway Fastify server.
 * Portal is read-only and consumes SSE events from /events/stream
 *
 * Authentication:
 * - All portal routes require Bearer token authentication (via Gateway auth middleware)
 * - No additional permission check is required as portal is read-only visualization
 * - SSE events are already filtered by the /events/stream endpoint permissions
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
 *
 * Security:
 * - Requires Bearer token authentication (handled by Gateway preHandler)
 * - Cache-Control: no-store prevents caching of dynamic dashboard
 * - Content-Security-Policy restricts script execution
 */
export function registerPortalRoutes(
  fastify: FastifyInstance,
  options: PortalRoutesOptions = {}
): void {
  const basePath = options.basePath ?? '/portal';

  // Security headers for portal routes
  const securityHeaders = {
    'Cache-Control': 'no-store',
    // Allow inline scripts (required for SSE client) but restrict other sources
    // connect-src allows SSE connections from any origin (needed for IP-based access)
    'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src *",
  };

  // GET /portal - Main dashboard
  fastify.get(basePath, async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = renderDashboard({
      generatedAt: new Date().toISOString(),
    });

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .headers(securityHeaders)
      .send(html);
  });

  // GET /portal/ - Also handle trailing slash
  fastify.get(`${basePath}/`, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(basePath);
  });

  // GET /portal/api/status - Portal status (JSON)
  fastify.get(`${basePath}/api/status`, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Cache-Control', 'no-store')
      .send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        mode: 'sse',
      });
  });
}
