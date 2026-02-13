/**
 * Tests for MCP Proxy
 * Phase 8.3: MCP Proxy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createMCPProxyHandler, ErrorCodes } from '../mcpProxy.js';
import { DEFAULT_LIMITS } from '../config.js';
import { tmpdir } from 'os';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import type { AuthInfo } from '../authMiddleware.js';

// Mock the stdio transport to avoid actual subprocess spawning
vi.mock('../../transports/stdio.js', () => ({
  StdioConnection: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn().mockImplementation((method: string, params?: unknown) => {
      if (method === 'initialize') {
        return Promise.resolve({
          result: { protocolVersion: '2024-11-05', capabilities: {} },
        });
      }
      if (method === 'tools/call') {
        return Promise.resolve({
          result: { content: [{ type: 'text', text: 'mock result' }] },
        });
      }
      return Promise.resolve({ result: {} });
    }),
    sendNotification: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock secret resolution
vi.mock('../../secrets/resolve.js', () => ({
  resolveEnvSecrets: vi.fn().mockResolvedValue({
    success: true,
    envResolved: {},
    errors: [],
  }),
}));

describe('MCP Proxy', () => {
  let server: FastifyInstance;
  let configDir: string;

  beforeEach(async () => {
    // Create temp config directory
    configDir = await mkdtemp(join(tmpdir(), 'pfscan-test-'));

    // Write test config (default name is config.json)
    const config = {
      version: 1,
      connectors: [
        {
          id: 'test-connector',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
          },
        },
        {
          id: 'disabled-connector',
          enabled: false,
          transport: {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
          },
        },
      ],
    };
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(config)
    );

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
        permissions: ['mcp:*'],
      };
    });

    // Add MCP proxy handler
    const handler = createMCPProxyHandler({
      configDir,
      limits: DEFAULT_LIMITS,
      hideNotFound: true,
    });

    server.post('/mcp/v1/message', handler);

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    await rm(configDir, { recursive: true });
    vi.clearAllMocks();
  });

  describe('request validation', () => {
    it('should reject missing connector field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: { method: 'tools/call' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
    });

    it('should reject missing method field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: { connector: 'test-connector' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.BAD_REQUEST);
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
          permissions: ['mcp:call:other-connector'], // Only has access to other-connector
        };
      });

      const handler = createMCPProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: true,
      });
      limitedServer.post('/mcp/v1/message', handler);
      await limitedServer.ready();

      const response = await limitedServer.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: {
          connector: 'test-connector',
          method: 'tools/call',
          params: { name: 'test' },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);

      await limitedServer.close();
    });
  });

  describe('connector routing', () => {
    it('should return 403 for non-existent connector (hideNotFound=true)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: {
          connector: 'non-existent',
          method: 'tools/call',
          params: { name: 'test' },
        },
      });

      // With hideNotFound=true, should return 403 instead of 404
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent connector (hideNotFound=false)', async () => {
      // Create server with hideNotFound=false
      const visibleServer = Fastify();
      visibleServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });
      visibleServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'test-client',
          permissions: ['mcp:*'],
        };
      });

      const handler = createMCPProxyHandler({
        configDir,
        limits: DEFAULT_LIMITS,
        hideNotFound: false,
      });
      visibleServer.post('/mcp/v1/message', handler);
      await visibleServer.ready();

      const response = await visibleServer.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: {
          connector: 'non-existent',
          method: 'tools/call',
          params: { name: 'test' },
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe(ErrorCodes.NOT_FOUND);

      await visibleServer.close();
    });

    it('should return 403 for disabled connector (hideNotFound=true)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: {
          connector: 'disabled-connector',
          method: 'tools/call',
          params: { name: 'test' },
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should forward request to enabled connector', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/mcp/v1/message',
        payload: {
          connector: 'test-connector',
          method: 'tools/call',
          params: { name: 'test-tool', arguments: {} },
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
        url: '/mcp/v1/message',
        payload: {
          connector: 'test-connector',
          method: 'tools/call',
          params: { name: 'test' },
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
        url: '/mcp/v1/message',
        payload: { connector: 'test', method: 123 }, // Invalid method type
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.request_id).toBe('test-request-id');
    });
  });
});

// Tests for queue behavior (429, 504) would require longer-running tests
// and are covered in queue.test.ts
