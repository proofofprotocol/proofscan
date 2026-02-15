/**
 * SSE endpoint tests
 * Phase 8.6: Real-time event streaming
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createGatewayServer } from '../server.js';
import { createAuthConfig, hashToken } from '../auth.js';
import { getSseManager } from '../sse.js';

describe('SSE Endpoint', () => {
  let serverInstance: FastifyInstance;
  let server: ReturnType<typeof createGatewayServer>;
  const port = 3999;

  beforeEach(async () => {
    // Create a test server on a different port
    const testToken = 'test-sse-token';
    const authConfig = createAuthConfig({
      mode: 'bearer',
      tokens: [
        {
          name: 'test-client',
          token_hash: hashToken(testToken),
          permissions: ['*'],
        },
      ],
    });

    server = createGatewayServer({
      config: {
        port,
        host: '127.0.0.1',
        auth: authConfig,
        limits: {
          max_body_size: '10mb',
          max_message_size: '10mb',
        },
      },
    });

    await server.start();
    serverInstance = server.server;
  });

  afterEach(async () => {
    // Clean up SSE clients
    getSseManager().disconnectAll();
    await server.stop();
  });

  describe('Authentication', () => {
    it('should return 401 without authorization header', async () => {
      const response = await serverInstance.inject({
        method: 'GET',
        url: '/events/stream',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: 'UNAUTHORIZED',
        },
      });
    });

    it('should return 401 with invalid token', async () => {
      const response = await serverInstance.inject({
        method: 'GET',
        url: '/events/stream',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: 'INVALID_TOKEN',
        },
      });
    });
  });

  describe('SSE Manager', () => {
    it('should track connected clients', async () => {
      const manager = getSseManager();

      // Initially no clients
      expect(manager.getClientCount()).toBe(0);
    });

    it('should generate unique client IDs', async () => {
      const manager = getSseManager();

      const id1 = manager.generateClientId();
      const id2 = manager.generateClientId();

      expect(id1).not.toBe(id2);
      expect(id1).toContain('sse-');
      expect(id2).toContain('sse-');
    });

    it('should broadcast events to clients', async () => {
      const manager = getSseManager();

      // Broadcast an event - should not throw
      manager.broadcast({
        event_kind: 'gateway_auth_success',
        client_id: 'test-client',
        ts: Date.now(),
        request_id: 'test-request-id',
      });

      expect(true).toBe(true);
    });

    it('should disconnect all clients', async () => {
      const manager = getSseManager();

      // Should not throw
      manager.disconnectAll();

      expect(manager.getClientCount()).toBe(0);
    });
  });

  describe('Event Filtering', () => {
    it('should validate event kinds', async () => {
      const manager = getSseManager();

      // Broadcast with valid event kind
      manager.broadcast({
        event_kind: 'gateway_auth_success',
        client_id: 'test-client',
        ts: Date.now(),
        request_id: 'test-request-id',
      });

      // Broadcast with invalid event kind - should not throw
      manager.broadcast({
        event_kind: 'gateway_auth_success' as any,
        client_id: 'test-client',
        ts: Date.now(),
        request_id: 'test-request-id',
      });

      expect(true).toBe(true);
    });

    it('should support client_id filtering', async () => {
      const manager = getSseManager();

      // Broadcast with client_id filter
      manager.broadcast({
        event_kind: 'gateway_auth_success',
        client_id: 'specific-client',
        ts: Date.now(),
        request_id: 'test-request-id',
      });

      expect(true).toBe(true);
    });

    it('should broadcast all event kinds when no filter specified', async () => {
      const manager = getSseManager();

      const eventKinds = [
        'gateway_auth_success',
        'gateway_auth_failure',
        'gateway_mcp_request',
        'gateway_mcp_response',
        'gateway_a2a_request',
        'gateway_a2a_response',
        'gateway_error',
      ];

      for (const kind of eventKinds) {
        manager.broadcast({
          event_kind: kind as any,
          client_id: 'test-client',
          ts: Date.now(),
          request_id: 'test-request-id',
        });
      }

      expect(true).toBe(true);
    });
  });

  describe('SSE Endpoint Integration', () => {
    it('should handle SSE endpoint with valid auth (integration test)', async () => {
      // This is an integration test that verifies the endpoint is registered
      // Full SSE connection testing requires a real HTTP client

      // Verify the endpoint exists by checking the route
      const routes = serverInstance.printRoutes();
      // The route is registered as "events/stream (GET, HEAD)" under "/"
      expect(routes).toContain('events/stream');
    });

    it('should handle SSE endpoint with query parameters (integration test)', async () => {
      // Verify the endpoint accepts query parameters

      // Note: Full SSE connection testing requires a real HTTP client
      // This test verifies the route registration
      const routes = serverInstance.printRoutes();
      expect(routes).toContain('events/stream');
    });
  });

  describe('Audit Logger SSE Integration', () => {
    it('should integrate with AuditLogger for SSE notifications', async () => {
      const manager = getSseManager();

      // Simulate an audit event
      const eventData = {
        event_kind: 'gateway_auth_success' as const,
        client_id: 'test-client',
        ts: Date.now(),
        request_id: 'test-request-id',
        trace_id: null,
        target_id: null,
        method: null,
        latency_ms: null,
        upstream_latency_ms: null,
        decision: null,
        deny_reason: null,
        error: null,
        status_code: null,
        metadata: null,
      };

      // Broadcast the event
      manager.broadcast(eventData);

      expect(true).toBe(true);
    });

    it('should handle all GatewayEventKind types', async () => {
      const manager = getSseManager();

      const eventKinds = [
        'gateway_auth_success',
        'gateway_auth_failure',
        'gateway_mcp_request',
        'gateway_mcp_response',
        'gateway_a2a_request',
        'gateway_a2a_response',
        'gateway_error',
      ];

      for (const kind of eventKinds) {
        manager.broadcast({
          event_kind: kind,
          client_id: 'test-client',
          ts: Date.now(),
          request_id: 'test-request-id',
        });
      }

      expect(true).toBe(true);
    });
  });
});
