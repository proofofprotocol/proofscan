/**
 * MCP Server Resources and Token Validation Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpProxyServer } from '../mcp-server.js';
import type { ProxyOptions } from '../types.js';

// Mock dependencies
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  initializeRingBuffer: vi.fn(() => ({
    onCountChange: vi.fn(),
  })),
  isVerbose: vi.fn(() => false),
}));

vi.mock('../runtime-state.js', () => ({
  RuntimeStateManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    updateClient: vi.fn().mockResolvedValue(undefined),
    recordToolCall: vi.fn().mockResolvedValue(undefined),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    markStopped: vi.fn().mockResolvedValue(undefined),
    updateLogCount: vi.fn(),
    getState: vi.fn(),
  })),
}));

vi.mock('../tool-aggregator.js', () => ({
  ToolAggregator: vi.fn().mockImplementation(() => ({
    getAggregatedTools: vi.fn().mockResolvedValue([]),
    preloadTools: vi.fn().mockResolvedValue(undefined),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('../request-router.js', () => ({
  RequestRouter: vi.fn().mockImplementation(() => ({
    routeToolCall: vi.fn().mockResolvedValue({
      success: true,
      content: [],
    }),
  })),
}));

vi.mock('../ipc-server.js', () => ({
  IpcServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}));

vi.mock('../config/manager.js', () => ({
  ConfigManager: vi.fn(),
}));

describe('MCP Resources', () => {
  let server: McpProxyServer;
  let mockOptions: ProxyOptions;
  let sentMessages: any[] = [];

  beforeEach(() => {
    sentMessages = [];
    mockOptions = {
      connectors: [],
      configDir: '/tmp/test-config',
    };

    // Mock process.stdout.write to capture responses
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string) => {
      sentMessages.push(chunk);
      return true;
    }) as any;

    server = new McpProxyServer(mockOptions, '/tmp/test-config/config.json');

    // Mock IPC start to avoid actual socket creation
    vi.spyOn(server as any, 'startIpcServer').mockResolvedValue(undefined);
  });

  describe('resources/list', () => {
    it('should return trace-viewer resource with correct mimeType', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesList('test-id');

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.result).toBeDefined();
      expect(response.result.resources).toHaveLength(1);
      expect(response.result.resources[0].uri).toBe('ui://proofscan/trace-viewer');
      expect(response.result.resources[0].mimeType).toBe('text/html;profile=mcp-app');
      expect(response.result.resources[0].name).toBe('Protocol Trace Viewer');
    });
  });

  describe('resources/read', () => {
    it('should return HTML for trace-viewer', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'ui://proofscan/trace-viewer',
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.result).toBeDefined();
      expect(response.result.contents).toHaveLength(1);
      expect(response.result.contents[0].uri).toBe('ui://proofscan/trace-viewer');
      expect(response.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
      expect(response.result.contents[0].text).toContain('<!DOCTYPE html>');
    });

    it('should reject unknown URIs', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'ui://proofscan/unknown-resource',
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Resource not found');
    });

    it('should reject URIs exceeding max length', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'ui://proofscan/' + 'a'.repeat(2048),
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toBe('URI too long');
    });

    it('should reject path traversal attempts', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'ui://proofscan/../etc/passwd',
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toBe('Invalid URI path');
    });

    it('should reject invalid URI scheme', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'http://proofscan/trace-viewer',
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Invalid URI scheme or host');
    });

    it('should reject invalid URI host', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleResourcesRead('test-id', {
        uri: 'ui://evil.com/trace-viewer',
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Invalid URI scheme or host');
    });
  });

  describe('ui/initialize', () => {
    it('should generate unique session tokens', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleUiInitialize('test-id', {});

      const response1 = JSON.parse(sentMessages[0]);
      const token1 = response1.result.sessionToken;

      sentMessages = [];
      await (server as any).handleUiInitialize('test-id-2', {});

      const response2 = JSON.parse(sentMessages[0]);
      const token2 = response2.result.sessionToken;

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2);
      expect(typeof token1).toBe('string');
      expect(typeof token2).toBe('string');
    });

    it('should include protocol version in response', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleUiInitialize('test-id', {});

      const response = JSON.parse(sentMessages[0]);
      expect(response.result.protocolVersion).toBe('2025-11-21');
      expect(response.result.sessionToken).toBeDefined();
    });
  });

  describe('session token management', () => {
    it('should store session tokens when generated', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleUiInitialize('test-id', {});

      const response = JSON.parse(sentMessages[0]);
      const token = response.result.sessionToken;

      // Access private sessionTokens via bracket notation
      expect((server as any).sessionTokens.has(token)).toBe(true);
    });

    it('should validate stored session tokens', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      sentMessages = [];
      await (server as any).handleUiInitialize('test-id', {});

      const response = JSON.parse(sentMessages[0]);
      const validToken = response.result.sessionToken;

      // Test private isValidSessionToken method
      expect((server as any).isValidSessionToken(validToken)).toBe(true);
      expect((server as any).isValidSessionToken('invalid-token')).toBe(false);
    });

    it('should maintain separate tokens for multiple calls', async () => {
      // Initialize server first
      await (server as any).handleInitialize('test-id', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client' },
      });

      // Generate multiple tokens
      const tokens: string[] = [];
      for (let i = 0; i < 3; i++) {
        sentMessages = [];
        await (server as any).handleUiInitialize(`test-id-${i}`, {});
        const response = JSON.parse(sentMessages[0]);
        tokens.push(response.result.sessionToken);
      }

      // All tokens should be stored
      const sessionTokens = (server as any).sessionTokens as Set<string>;
      expect(sessionTokens.size).toBe(3);
      tokens.forEach((token) => {
        expect(sessionTokens.has(token)).toBe(true);
      });
    });
  });
});
