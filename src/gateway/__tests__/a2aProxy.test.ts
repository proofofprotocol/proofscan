/**
 * Tests for A2A Proxy
 * Phase 8.4: A2A Proxy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createA2AProxyHandler } from '../a2aProxy.js';
import { ErrorCodes } from '../mcpProxy.js';
import { DEFAULT_LIMITS } from '../config.js';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuthInfo } from '../authMiddleware.js';
import { TargetsStore } from '../../db/targets-store.js';

// Mock the A2A client to avoid actual HTTP requests
vi.mock('../../a2a/client.js', () => ({
  createA2AClient: vi.fn().mockImplementation(async (_configDir: string, agentId: string) => {
    // Return mock client
    return {
      ok: true,
      client: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          task: {
            id: 'task-123',
            status: 'completed',
            messages: [],
          },
        }),
        getTask: vi.fn().mockResolvedValue({
          ok: true,
          task: {
            id: 'task-123',
            status: 'completed',
            messages: [],
          },
        }),
        cancelTask: vi.fn().mockResolvedValue({
          ok: true,
          task: {
            id: 'task-123',
            status: 'canceled',
          },
        }),
        listTasks: vi.fn().mockResolvedValue({
          ok: true,
          response: {
            tasks: [],
            nextPageToken: '',
            pageSize: 50,
          },
        }),
      },
      agentCard: {
        name: agentId,
        url: 'http://localhost:3001',
        version: '1.0.0',
      },
    };
  }),
}));

describe('A2A Proxy', () => {
  let server: FastifyInstance;
  let configDir: string;
  let targetsStore: TargetsStore;

  beforeEach(async () => {
    // Create temp config directory
    configDir = await mkdtemp(join(tmpdir(), 'pfscan-a2a-test-'));

    // Initialize targets store and add test agent
    targetsStore = new TargetsStore(configDir);
    targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      name: 'Test Agent',
      enabled: true,
      config: {
        url: 'http://localhost:3001',
      },
    }, { id: 'test-agent' });

    targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      name: 'Disabled Agent',
      enabled: false,
      config: {
        url: 'http://localhost:3002',
      },
    }, { id: 'disabled-agent' });

    // Create Fastify server
    server = Fastify();

    // Add request ID
    server.addHook('onRequest', async (request) => {
      request.requestId = 'test-request-id';
    });

    // Add mock auth
    server.addHook('preHandler', async (request) => {
      (request as unknown as { auth: AuthInfo }).auth = {
        client_id: 'test-client',
        permissions: ['a2a:*'],
      };
    });

    // Add A2A proxy handler
    const handler = createA2AProxyHandler({
      configDir,
      limits: DEFAULT_LIMITS,
      hideNotFound: true,
    });

    server.post('/a2a/v1/message/send', handler);
    server.post('/a2a/v1/tasks/send', handler);
    server.post('/a2a/v1/tasks/get', handler);
    server.post('/a2a/v1/tasks/cancel', handler);

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    await rm(configDir, { recursive: true });
    vi.clearAllMocks();
  });

  describe('request validation', () => {
    it('should reject missing agent field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { method: 'message/send' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
    });

    it('should reject missing method field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { agent: 'test-agent' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
    });

    it('should reject unsupported method', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { agent: 'test-agent', method: 'unsupported/method' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(body.error.message).toContain('Unsupported A2A method');
    });
  });

  describe('permission check', () => {
    it('should reject unauthorized requests', async () => {
      // Create server with limited permissions
      const limitedServer = Fastify();
      limitedServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      limitedServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'limited-client',
          permissions: ['a2a:message:other-agent'], // Only has access to other-agent
        };
      });

      const handler = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      limitedServer.post('/a2a/v1/message/send', handler);
      await limitedServer.ready();

      const response = await limitedServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);

      await limitedServer.close();
    });

    it('should allow access with specific agent permission', async () => {
      // Create server with specific agent permission
      const specificServer = Fastify();
      specificServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      specificServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'specific-client',
          permissions: ['a2a:message:test-agent'],
        };
      });

      const handler = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      specificServer.post('/a2a/v1/message/send', handler);
      await specificServer.ready();

      const response = await specificServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(200);

      await specificServer.close();
    });
  });

  describe('agent routing', () => {
    it('should return 403 for non-existent agent (hideNotFound=true)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'non-existent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      // With hideNotFound=true, should return 403 instead of 404
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent agent (hideNotFound=false)', async () => {
      // Create server with hideNotFound=false
      const visibleServer = Fastify();
      visibleServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      visibleServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'test-client',
          permissions: ['a2a:*'],
        };
      });

      const handler = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: false,
      });
      visibleServer.post('/a2a/v1/message/send', handler);
      await visibleServer.ready();

      const response = await visibleServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'non-existent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.NOT_FOUND);

      await visibleServer.close();
    });

    it('should return 403 for disabled agent (hideNotFound=true)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'disabled-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should forward message/send to enabled agent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });

    it('should forward tasks/get to enabled agent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/get',
        payload: {
          agent: 'test-agent',
          method: 'tasks/get',
          params: { id: 'task-123' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });

    it('should forward tasks/cancel to enabled agent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/cancel',
        payload: {
          agent: 'test-agent',
          method: 'tasks/cancel',
          params: { id: 'task-123' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });
  });

  describe('queue headers', () => {
    it('should include X-Queue-Wait-Ms header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-queue-wait-ms']).toBeDefined();
    });
  });

  describe('error response format', () => {
    it('should include request_id in error responses', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { agent: 'test', method: 123 }, // Invalid method type
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.request_id).toBe('test-request-id');
    });
  });

  describe('A2A error handling', () => {
    it('should handle A2A client errors', async () => {
      // Mock to return error
      const { createA2AClient } = await import('../../a2a/client.js');
      vi.mocked(createA2AClient).mockResolvedValueOnce({
        ok: false,
        error: 'Failed to connect to agent',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_GATEWAY);
    });

    it('should handle message send failure', async () => {
      // Mock to return send failure
      const { createA2AClient } = await import('../../a2a/client.js');
      vi.mocked(createA2AClient).mockResolvedValueOnce({
        ok: true,
        client: {
          sendMessage: vi.fn().mockResolvedValue({
            ok: false,
            error: 'Agent rejected message',
          }),
          getTask: vi.fn(),
          cancelTask: vi.fn(),
          listTasks: vi.fn(),
        },
        agentCard: {
          name: 'test-agent',
          url: 'http://localhost:3001',
          version: '1.0.0',
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_GATEWAY);
    });
  });

  describe('permission types', () => {
    it('should use message permission for message/send', async () => {
      // Create server with message-only permission
      const messageServer = Fastify();
      messageServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      messageServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'message-client',
          permissions: ['a2a:message:test-agent'], // Only message permission
        };
      });

      const handler = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      messageServer.post('/a2a/v1/message/send', handler);
      messageServer.post('/a2a/v1/tasks/get', handler);
      await messageServer.ready();

      // message/send should work
      const msgResponse = await messageServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });
      expect(msgResponse.statusCode).toBe(200);

      // tasks/get should fail (needs task permission)
      const taskResponse = await messageServer.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/get',
        payload: {
          agent: 'test-agent',
          method: 'tasks/get',
          params: { id: 'task-123' },
        },
      });
      expect(taskResponse.statusCode).toBe(403);

      await messageServer.close();
    });

    it('should use task permission for tasks/*', async () => {
      // Create server with task-only permission
      const taskServer = Fastify();
      taskServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      taskServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'task-client',
          permissions: ['a2a:task:test-agent'], // Only task permission
        };
      });

      const handler = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      taskServer.post('/a2a/v1/message/send', handler);
      taskServer.post('/a2a/v1/tasks/get', handler);
      await taskServer.ready();

      // tasks/get should work
      const taskResponse = await taskServer.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/get',
        payload: {
          agent: 'test-agent',
          method: 'tasks/get',
          params: { id: 'task-123' },
        },
      });
      expect(taskResponse.statusCode).toBe(200);

      // message/send should fail (needs message permission)
      const msgResponse = await taskServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'test-agent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });
      expect(msgResponse.statusCode).toBe(403);

      await taskServer.close();
    });
  });
});
