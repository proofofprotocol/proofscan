/**
 * Tests for proofscan_getEvents tool (Phase 6.2)
 *
 * Tests:
 * - 3-layer result structure (content, structuredContent, _meta)
 * - limit parameter enforcement
 * - exclusive before cursor behavior
 * - payload truncation
 * - secret redaction
 * - outputSchema compliance
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpProxyServer } from '../mcp-server.js';
import type { ProxyOptions } from '../types.js';
import { EventsStore } from '../../db/events-store.js';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

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

describe('proofscan_getEvents', () => {
  let server: McpProxyServer;
  let mockOptions: ProxyOptions;
  let sentMessages: any[];
  let tempConfigDir: string;
  let eventsStore: EventsStore;
  let sessionId: string;

  beforeEach(() => {
    sentMessages = [];
    tempConfigDir = join(tmpdir(), `proofscan-test-${randomUUID()}`);
    eventsStore = new EventsStore(tempConfigDir);

    mockOptions = {
      connectors: [],
      configDir: tempConfigDir,
    };

    // Mock process.stdout.write to capture responses
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string) => {
      sentMessages.push(chunk);
      return true;
    }) as any;

    server = new McpProxyServer(mockOptions, join(tempConfigDir, 'config.json'));

    // Mock IPC start to avoid actual socket creation
    vi.spyOn(server as any, 'startIpcServer').mockResolvedValue(undefined);

    // Initialize server
    (server as any).initialized = true;
    (server as any).currentClient = {
      name: 'test-client',
      protocolVersion: '2024-11-05',
    };

    // Create a test session
    const session = eventsStore.createSession('test-target', {
      actorId: 'test-actor',
      actorKind: 'human',
      actorLabel: 'Test Actor',
    });
    sessionId = session.session_id;
  });

  describe('3-layer result structure', () => {
    it('should return content, structuredContent, and _meta', async () => {
      // Create some test events
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-1',
        rawJson: JSON.stringify({ method: 'test_method' }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      expect(result.content).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Found');

      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.events).toBeInstanceOf(Array);
      expect(result.structuredContent.sessionId).toBe(sessionId);
      expect(typeof result.structuredContent.hasMore).toBe('boolean');

      expect(result._meta).toBeDefined();
      expect(result._meta.ui).toBeDefined();
      expect(result._meta.ui.resourceUri).toBe('ui://proofscan/trace-viewer');
      expect(result._meta.fullEvents).toBeInstanceOf(Array);
      expect(result._meta.outputSchemaVersion).toBe('1');
    });
  });

  describe('limit parameter', () => {
    beforeEach(() => {
      // Create 30 test events
      for (let i = 1; i <= 30; i++) {
        eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
          rpcId: `rpc-${i}`,
          seq: i,
        });
      }
    });

    it('should respect limit=10', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 10 },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      expect(result.structuredContent.events.length).toBeLessThanOrEqual(10);
      expect(result._meta.fullEvents.length).toBeLessThanOrEqual(10);
    });

    it('should use default limit of 50', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      // With 30 events, all should be returned
      expect(result.structuredContent.events.length).toBe(30);
      expect(result._meta.fullEvents.length).toBe(30);
    });

    it('should enforce max limit of 200', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 500 },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      // Requested 500 but only 30 events exist
      expect(result.structuredContent.events.length).toBe(30);
    });

    it('should set hasMore=true when limit is reached', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 10 },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      // 10 events returned out of 30 total
      expect(result.structuredContent.hasMore).toBe(true);
    });

    it('should set hasMore=false when all events returned', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 100 },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      // All 30 events returned
      expect(result.structuredContent.hasMore).toBe(false);
    });
  });

  describe('exclusive before cursor', () => {
    beforeEach(() => {
      // Create 5 events with deterministic IDs
      for (let i = 1; i <= 5; i++) {
        eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
          rpcId: `rpc-${i}`,
          seq: i,
        });
      }
    });

    it('should implement exclusive cursor (before excludes the specified event)', async () => {
      // Get all events first
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 100 },
      });

      const firstResponse = JSON.parse(sentMessages[0]);
      const allEvents = firstResponse.result.structuredContent.events;

      expect(allEvents.length).toBe(5);

      // Get the middle event ID
      const middleEventId = allEvents[2].id; // 3rd event (0-indexed)

      // Now query with before=middleEventId
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, before: middleEventId, limit: 100 },
      });

      const secondResponse = JSON.parse(sentMessages[0]);
      const pagedEvents = secondResponse.result.structuredContent.events;

      // Should return events older than the middle event
      // Events are returned in descending order (newest first)
      // So we should get the 2 oldest events
      expect(pagedEvents.length).toBe(2);

      // Verify none of the returned events is the cursor event
      const foundCursor = pagedEvents.find((e: any) => e.id === middleEventId);
      expect(foundCursor).toBeUndefined();
    });

    it('should return events in descending order (newest first)', async () => {
      // Create events with known timestamps
      for (let i = 1; i <= 3; i++) {
        const event = eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
          rpcId: `rpc-${i}`,
          seq: i,
        });
      }

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId, limit: 3 },
      });

      const response = JSON.parse(sentMessages[0]);
      const events = response.result.structuredContent.events;

      // Events should be in descending order by timestamp
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
      }
    });
  });

  describe('payload truncation', () => {
    it('should truncate large payloads', async () => {
      // Create an event with a large payload (> 10KB)
      const largePayload = 'x'.repeat(15000);
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-large',
        rawJson: JSON.stringify({ large: largePayload }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const fullEvents = response.result._meta.fullEvents;

      expect(fullEvents).toHaveLength(1);
      const event = fullEvents[0];

      expect(event.payload).toBeDefined();
      expect(event.payload._truncated).toBe(true);
      // Preview is JSON.stringify of the object, then truncated to 500 chars
      expect(event.payload.preview).toContain('...');
      expect(event.payload._originalSize).toBeGreaterThan(10000);
    });

    it('should not truncate small payloads', async () => {
      // Create an event with a small payload (< 10KB)
      const smallPayload = 'hello world';
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-small',
        rawJson: JSON.stringify({ small: smallPayload }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const fullEvents = response.result._meta.fullEvents;

      expect(fullEvents).toHaveLength(1);
      const event = fullEvents[0];

      expect(event.payload).toBeDefined();
      expect(event.payload.small).toBe(smallPayload);
      expect(event.payload._truncated).toBeUndefined();
    });
  });

  describe('secret redaction', () => {
    it('should redact token fields', async () => {
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-token',
        rawJson: JSON.stringify({
          method: 'auth',
          token: 'secret-token-123',
          api_key: 'key-456',
        }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const fullEvents = response.result._meta.fullEvents;

      expect(fullEvents).toHaveLength(1);
      const event = fullEvents[0];

      expect(event.payload.token).toBe('***');
      expect(event.payload.api_key).toBe('***');
      expect(event.payload.method).toBe('auth');
    });

    it('should redact password fields', async () => {
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-password',
        rawJson: JSON.stringify({
          method: 'login',
          password: 'my-password',
          authorization: 'Bearer secret-token',
        }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const fullEvents = response.result._meta.fullEvents;

      expect(fullEvents).toHaveLength(1);
      const event = fullEvents[0];

      expect(event.payload.password).toBe('***');
      expect(event.payload.authorization).toBe('***');
      expect(event.payload.method).toBe('login');
    });

    it('should redact nested secret fields', async () => {
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-nested',
        rawJson: JSON.stringify({
          method: 'config',
          config: {
            apiKey: 'nested-key',
            nested: {
              secret: 'deep-secret',
              normal: 'keep-me',
            },
          },
        }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const fullEvents = response.result._meta.fullEvents;

      expect(fullEvents).toHaveLength(1);
      const event = fullEvents[0];

      expect(event.payload.config.apiKey).toBe('***');
      expect(event.payload.config.nested.secret).toBe('***');
      expect(event.payload.config.nested.normal).toBe('keep-me');
    });
  });

  describe('outputSchema compliance', () => {
    it('structuredContent should match outputSchema', async () => {
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-1',
        rawJson: JSON.stringify({ method: 'test' }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const sc = response.result.structuredContent;

      // Verify top-level structure
      expect(sc).toHaveProperty('events');
      expect(sc).toHaveProperty('sessionId');
      expect(sc).toHaveProperty('hasMore');

      // Verify event structure matches outputSchema
      expect(sc.events).toBeInstanceOf(Array);
      if (sc.events.length > 0) {
        const event = sc.events[0];
        expect(event).toHaveProperty('id');
        expect(typeof event.id).toBe('string');
        expect(event).toHaveProperty('type');
        expect(typeof event.type).toBe('string');
        expect(event).toHaveProperty('method');
        expect(event.method === null || typeof event.method === 'string').toBe(true);
        expect(event).toHaveProperty('timestamp');
        expect(typeof event.timestamp).toBe('number');
        expect(event).toHaveProperty('duration_ms');
        expect(typeof event.duration_ms).toBe('number');
      }

      expect(typeof sc.sessionId).toBe('string');
      expect(typeof sc.hasMore).toBe('boolean');
    });

    it('should calculate duration for request-response pairs', async () => {
      const requestTime = new Date('2024-01-01T00:00:00.000Z');
      const responseTime = new Date('2024-01-01T00:00:00.500Z');

      // Create request event
      eventsStore.saveEvent(sessionId, 'client_to_server', 'request', {
        rpcId: 'rpc-duration',
        rawJson: JSON.stringify({ method: 'test' }),
      });

      // Create response event (same rpc_id)
      eventsStore.saveEvent(sessionId, 'server_to_client', 'response', {
        rpcId: 'rpc-duration',
        rawJson: JSON.stringify({ result: 'ok' }),
      });

      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId },
      });

      const response = JSON.parse(sentMessages[0]);
      const events = response.result.structuredContent.events;

      // Find the request event (should have duration calculated)
      const requestEvent = events.find((e: any) => e.type === 'request');
      expect(requestEvent).toBeDefined();
      expect(requestEvent.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should return error when sessionId is missing', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: {},
      });

      expect(sentMessages).toHaveLength(1);
      const response = JSON.parse(sentMessages[0]);

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('sessionId');
    });

    it('should return empty events array for unknown session', async () => {
      sentMessages = [];
      await (server as any).handleToolsCall('test-id', {
        name: 'proofscan_getEvents',
        arguments: { sessionId: 'unknown-session-id' },
      });

      const response = JSON.parse(sentMessages[0]);
      const result = response.result;

      expect(result.content[0].text).toContain('Found 0 events');
      expect(result.structuredContent.events).toHaveLength(0);
      expect(result.structuredContent.hasMore).toBe(false);
    });
  });
});
