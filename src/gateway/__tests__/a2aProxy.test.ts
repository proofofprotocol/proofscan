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
import { SkillsStore } from '../../db/skills-store.js';
import { SpacesStore } from '../../db/spaces-store.js';
import { closeAllDbs } from '../../db/connection.js';

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
    const { handler } = createA2AProxyHandler({
      configDir,
      limits: DEFAULT_LIMITS,
      hideNotFound: true,
    });

    server.post('/a2a/v1/message/send', handler);
    server.post('/a2a/v1/tasks/send', handler);
    server.post('/a2a/v1/tasks/get', handler);
    server.post('/a2a/v1/tasks/cancel', handler);
    server.post('/a2a/v1/tasks/list', handler);

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    closeAllDbs();
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

    it('should reject invalid agent ID format (path traversal)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { agent: '../../../etc/passwd', method: 'message/send', params: { message: 'test' } },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(body.error.message).toContain('Invalid agent ID format');
    });

    it('should reject agent ID with special characters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: { agent: 'agent@invalid!', method: 'message/send', params: { message: 'test' } },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(body.error.message).toContain('Invalid agent ID format');
    });

    it('should accept valid agent ID formats', async () => {
      // Valid formats: alphanumeric, hyphens, underscores
      const validIds = ['test-agent', 'test_agent', 'TestAgent123', 'agent-1_test'];
      
      for (const agentId of validIds) {
        const response = await server.inject({
          method: 'POST',
          url: '/a2a/v1/message/send',
          payload: { agent: agentId, method: 'message/send', params: { message: 'test' } },
        });
        
        // Should not fail on format validation (may fail on agent not found, which is expected)
        const body = JSON.parse(response.payload);
        if (body.error?.message) {
          expect(body.error.message).not.toContain('Invalid agent ID format');
        }
        // Success (200) or permission denied/not found (403) are both acceptable
        // as they indicate the format validation passed
      }
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

      const { handler } = createA2AProxyHandler({
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

      const { handler } = createA2AProxyHandler({
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

      const { handler } = createA2AProxyHandler({
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

    it('should forward tasks/list to enabled agent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/list',
        payload: {
          agent: 'test-agent',
          method: 'tasks/list',
          params: {},
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });

    it('should forward tasks/list with filters', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/list',
        payload: {
          agent: 'test-agent',
          method: 'tasks/list',
          params: { status: 'completed', pageSize: 10 },
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

      const { handler } = createA2AProxyHandler({
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

      const { handler } = createA2AProxyHandler({
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

  describe('@skill: routing (Phase 9.2)', () => {
    let skillsStore: SkillsStore;

    beforeEach(() => {
      // Initialize skills store and add test skills
      skillsStore = new SkillsStore(configDir);

      // Add skills for test-agent
      skillsStore.upsertMany('test-agent', [
        {
          name: 'translate',
          description: 'Translation service',
          tags: ['language', 'translation'],
        },
        {
          name: 'summarize',
          description: 'Text summarization',
          tags: ['text', 'nlp'],
        },
      ]);
    });

    it('should resolve @skill: prefix to agent ID', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: '@skill:translate',
          method: 'message/send',
          params: { message: 'Translate this text' },
        },
      });

      // Should succeed because @skill:translate resolves to test-agent
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });

    it('should return 404 for non-existent skill', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: '@skill:nonexistent',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('No agent found with skill');
    });

    it('should reject empty skill name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: '@skill:',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Empty skill name');
    });

    it('should use resolved agent ID for permission check', async () => {
      // Create server with permission only for test-agent
      const skillServer = Fastify();
      skillServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      skillServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'skill-client',
          permissions: ['a2a:message:test-agent'], // Permission for resolved agent
        };
      });

      const { handler } = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: false,
      });
      skillServer.post('/a2a/v1/message/send', handler);
      await skillServer.ready();

      // Should succeed because @skill:translate -> test-agent and we have permission
      const response = await skillServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: '@skill:translate',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(200);

      await skillServer.close();
    });

    it('should reject when resolved agent lacks permission', async () => {
      // Create server with permission for different agent
      const noPermServer = Fastify();
      noPermServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      noPermServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'limited-client',
          permissions: ['a2a:message:other-agent'], // No permission for test-agent
        };
      });

      const { handler } = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: false,
      });
      noPermServer.post('/a2a/v1/message/send', handler);
      await noPermServer.ready();

      // @skill:translate -> test-agent but we don't have permission for test-agent
      const response = await noPermServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: '@skill:translate',
          method: 'message/send',
          params: { message: 'hello' },
        },
      });

      expect(response.statusCode).toBe(403);

      await noPermServer.close();
    });
  });

  describe('space/ routing (Phase 9.3)', () => {
    let spacesStore: SpacesStore;
    let spaceId: string;

    beforeEach(() => {
      // Initialize spaces store
      spacesStore = new SpacesStore(configDir);

      // Create a test space
      const space = spacesStore.create({
        name: 'Test Space',
        visibility: 'public',
      });
      spaceId = space.spaceId;
    });

    it('should broadcast message to space members', async () => {
      // Join test-client as member (using client_id as agent_id for simplicity)
      spacesStore.join(spaceId, 'test-client', 'member');
      spacesStore.join(spaceId, 'another-agent', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: { message: 'Hello everyone!' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
      expect(body.result.space_id).toBe(spaceId);
      expect(body.result.status).toBe('intent_recorded'); // Phase 9.3 MVP: intent only
      expect(body.result.recipients).toBe(1); // Excludes sender (test-client)
      // In intent_recorded mode, delivered/failed are 0 (actual delivery in Phase 9.4)
      expect(body.result.delivered).toBe(0);
      expect(body.result.failed).toBe(0);
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: 'space/non-existent-space',
          method: 'message/send',
          params: { message: 'Hello!' },
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('SPACE_NOT_FOUND');
    });

    it('should return 403 if sender is not a member', async () => {
      // Don't join the sender (test-client)
      spacesStore.join(spaceId, 'another-agent', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: { message: 'Hello!' },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('NOT_MEMBER');
      expect(body.error.message).toContain('not a member');
    });

    it('should reject unsupported methods for spaces', async () => {
      spacesStore.join(spaceId, 'test-client', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/tasks/get',
        payload: {
          agent: `space/${spaceId}`,
          method: 'tasks/get',
          params: { id: 'task-123' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Method not supported for spaces');
    });

    it('should accept message as A2A object', async () => {
      spacesStore.join(spaceId, 'test-client', 'member');
      spacesStore.join(spaceId, 'another-agent', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ text: 'Hello from A2A!' }],
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result.status).toBe('intent_recorded');
      expect(body.result.delivered).toBe(0); // intent_recorded mode
    });

    it('should require message in params', async () => {
      spacesStore.join(spaceId, 'test-client', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('message field required');
    });

    it('should handle broadcast to space with no other members', async () => {
      // Only the sender is a member
      spacesStore.join(spaceId, 'test-client', 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: { message: 'Hello to no one!' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result.recipients).toBe(0);
      expect(body.result.delivered).toBe(0);
    });

    it('should respect A2A permission check for spaces', async () => {
      // Create server with limited permissions (no space access)
      const limitedServer = Fastify();
      limitedServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      limitedServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'limited-client',
          permissions: ['a2a:message:test-agent'], // Only has access to test-agent, not spaces
        };
      });

      const { handler } = createA2AProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      limitedServer.post('/a2a/v1/message/send', handler);
      await limitedServer.ready();

      spacesStore.join(spaceId, 'limited-client', 'member');

      const response = await limitedServer.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: { message: 'Hello!' },
        },
      });

      expect(response.statusCode).toBe(403);

      await limitedServer.close();
    });

    it('should allow space access with wildcard permission', async () => {
      spacesStore.join(spaceId, 'test-client', 'member');

      // Using server with a2a:* permission (set in beforeEach)
      const response = await server.inject({
        method: 'POST',
        url: '/a2a/v1/message/send',
        payload: {
          agent: `space/${spaceId}`,
          method: 'message/send',
          params: { message: 'Hello!' },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
