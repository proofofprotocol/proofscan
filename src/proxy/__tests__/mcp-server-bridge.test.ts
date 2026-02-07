/**
 * Tests for BridgeEnvelope and UI tool tracking (Phase 6.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeToolCall, generateCorrelationIds, uiSessionIdFromToken, correlationIdsMatch } from '../bridge-utils.js';
import { EventsStore } from '../../db/events-store.js';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

describe('BridgeEnvelope', () => {
  describe('sanitizeToolCall', () => {
    it('should strip _bridge from params', () => {
      const params = {
        _bridge: { sessionToken: 'test-token' },
        name: 'proofscan_getEvents',
        arguments: { sessionId: 'ctx_123' },
      };
      const { clean, bridgeToken } = sanitizeToolCall(params);
      expect(clean._bridge).toBeUndefined();
      expect(clean.name).toBe('proofscan_getEvents');
      expect(bridgeToken).toBe('test-token');
    });

    it('should handle params without _bridge', () => {
      const params = {
        name: 'proofscan_getEvents',
        arguments: { sessionId: 'ctx_123' },
      };
      const { clean, bridgeToken } = sanitizeToolCall(params);
      expect(clean.name).toBe('proofscan_getEvents');
      expect(bridgeToken).toBeUndefined();
    });

    it('should preserve arguments when stripping _bridge', () => {
      const params = {
        _bridge: { sessionToken: 'abc123' },
        name: 'some_tool',
        arguments: { foo: 'bar', baz: 42 },
      };
      const { clean } = sanitizeToolCall(params);
      expect(clean.arguments).toEqual({ foo: 'bar', baz: 42 });
    });
  });

  describe('generateCorrelationIds', () => {
    it('should generate correlation IDs with bridge token', () => {
      const bridgeToken = randomUUID();
      const rpcId = 123;
      const ids = generateCorrelationIds(bridgeToken, rpcId);

      expect(ids.ui_session_id).toBe(`ui_${bridgeToken.slice(0, 8)}`);
      expect(ids.ui_rpc_id).toBe('rpc_123');
      expect(ids.correlation_id).toBeDefined();
      expect(ids.correlation_id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(ids.tool_call_fingerprint).toMatch(/^fp_\d+_123$/);
    });

    it('should generate correlation IDs without bridge token', () => {
      const rpcId = 456;
      const ids = generateCorrelationIds(undefined, rpcId);

      expect(ids.ui_session_id).toBe('ui_unknown');
      expect(ids.ui_rpc_id).toBe('rpc_456');
      expect(ids.correlation_id).toBeDefined();
      expect(ids.tool_call_fingerprint).toMatch(/^fp_\d+_456$/);
    });

    it('should generate unique correlation IDs', () => {
      const bridgeToken = randomUUID();
      const ids1 = generateCorrelationIds(bridgeToken, 1);
      const ids2 = generateCorrelationIds(bridgeToken, 2);

      // correlation_id should be unique (random UUID)
      expect(ids1.correlation_id).not.toBe(ids2.correlation_id);

      // tool_call_fingerprint differs due to different rpcId
      expect(ids1.tool_call_fingerprint).not.toBe(ids2.tool_call_fingerprint);
    });
  });

  describe('uiSessionIdFromToken', () => {
    it('should extract first 8 chars of token', () => {
      const token = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      const uiSessionId = uiSessionIdFromToken(token);
      expect(uiSessionId).toBe('ui_a1b2c3d4');
    });

    it('should handle short tokens', () => {
      const token = 'abc';
      const uiSessionId = uiSessionIdFromToken(token);
      expect(uiSessionId).toBe('ui_abc');
    });
  });

  describe('correlationIdsMatch', () => {
    it('should return true when correlation_id matches', () => {
      const ids1 = {
        ui_session_id: 'ui_abc123',
        ui_rpc_id: 'rpc_1',
        correlation_id: 'corr-xyz',
        tool_call_fingerprint: 'fp_123_1',
      };
      const ids2 = {
        ui_session_id: 'ui_def456',
        ui_rpc_id: 'rpc_2',
        correlation_id: 'corr-xyz',
        tool_call_fingerprint: 'fp_124_2',
      };
      expect(correlationIdsMatch(ids1, ids2)).toBe(true);
    });

    it('should return false when correlation_id differs', () => {
      const ids1 = {
        ui_session_id: 'ui_abc123',
        ui_rpc_id: 'rpc_1',
        correlation_id: 'corr-xyz',
        tool_call_fingerprint: 'fp_123_1',
      };
      const ids2 = {
        ui_session_id: 'ui_abc123',
        ui_rpc_id: 'rpc_1',
        correlation_id: 'corr-abc',
        tool_call_fingerprint: 'fp_123_1',
      };
      expect(correlationIdsMatch(ids1, ids2)).toBe(false);
    });
  });
});

describe('EventsStore - UI Events (Phase 6.2)', () => {
  let eventsStore: EventsStore;
  let tempConfigDir: string;

  beforeEach(() => {
    // Use temp directory for test isolation
    tempConfigDir = join(tmpdir(), `proofscan-test-${randomUUID()}`);
    eventsStore = new EventsStore(tempConfigDir);
  });

  afterEach(() => {
    // Cleanup is handled by temp directory being system temp
  });

  describe('saveUiToolRequestEvent', () => {
    it('should save ui_tool_request event', () => {
      const uiSessionId = 'ui_a1b2c3d4';
      const uiRpcId = 'rpc_1';
      const correlationId = randomUUID();
      const toolCallFingerprint = 'fp_123_1';
      const toolName = 'proofscan_getEvents';

      const result = eventsStore.saveUiToolRequestEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        toolName,
        {
          arguments: { sessionId: 'ctx_123' },
          sessionToken: 'secret-token',
        }
      );

      expect(result.event_id).toBeDefined();
      expect(result.ts).toBeGreaterThan(0);
    });
  });

  describe('saveUiToolResultEvent', () => {
    it('should save ui_tool_result event', () => {
      const uiSessionId = 'ui_a1b2c3d4';
      const uiRpcId = 'rpc_1';
      const correlationId = randomUUID();
      const toolCallFingerprint = 'fp_123_1';

      const result = eventsStore.saveUiToolResultEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        {
          result: { content: [{ type: 'text', text: 'test' }] },
          duration_ms: 100,
        }
      );

      expect(result.event_id).toBeDefined();
      expect(result.ts).toBeGreaterThan(0);
    });
  });

  describe('saveUiToolDeliveredEvent', () => {
    it('should save ui_tool_delivered event', () => {
      const uiSessionId = 'ui_a1b2c3d4';
      const uiRpcId = 'rpc_1';
      const correlationId = randomUUID();
      const toolCallFingerprint = 'fp_123_1';

      const result = eventsStore.saveUiToolDeliveredEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        {
          result: { content: [{ type: 'text', text: 'test' }] },
        }
      );

      expect(result.event_id).toBeDefined();
      expect(result.ts).toBeGreaterThan(0);
    });
  });

  describe('getUiEventsByCorrelationId', () => {
    it('should retrieve events by correlation_id in order', () => {
      const uiSessionId = 'ui_a1b2c3d4';
      const uiRpcId = 'rpc_1';
      const correlationId = randomUUID();
      const toolCallFingerprint = 'fp_123_1';
      const toolName = 'proofscan_getEvents';

      // Save request event
      eventsStore.saveUiToolRequestEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        toolName,
        {
          arguments: { sessionId: 'ctx_123' },
          sessionToken: 'secret-token',
        }
      );

      // Save result event
      eventsStore.saveUiToolResultEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        {
          result: { content: [{ type: 'text', text: 'test' }] },
          duration_ms: 100,
        }
      );

      // Save delivered event
      eventsStore.saveUiToolDeliveredEvent(
        uiSessionId,
        uiRpcId,
        correlationId,
        toolCallFingerprint,
        {
          result: { content: [{ type: 'text', text: 'test' }] },
        }
      );

      // Retrieve events
      const events = eventsStore.getUiEventsByCorrelationId(correlationId);

      expect(events).toHaveLength(3);
      expect(events[0].event_type).toBe('ui_tool_request');
      expect(events[1].event_type).toBe('ui_tool_result');
      expect(events[2].event_type).toBe('ui_tool_delivered');

      // All events should have the same correlation_id
      for (const event of events) {
        expect(event.correlation_id).toBe(correlationId);
      }
    });

    it('should return empty array for unknown correlation_id', () => {
      const events = eventsStore.getUiEventsByCorrelationId('unknown-corr-id');
      expect(events).toHaveLength(0);
    });
  });

  describe('getUiEventsBySession', () => {
    it('should retrieve events by ui_session_id', () => {
      const uiSessionId = 'ui_a1b2c3d4';
      const correlationId1 = randomUUID();
      const correlationId2 = randomUUID();

      // Save two events for the same session
      eventsStore.saveUiToolRequestEvent(
        uiSessionId,
        'rpc_1',
        correlationId1,
        'fp_123_1',
        'tool1',
        { arguments: {}, sessionToken: 'token1' }
      );

      eventsStore.saveUiToolRequestEvent(
        uiSessionId,
        'rpc_2',
        correlationId2,
        'fp_124_2',
        'tool2',
        { arguments: {}, sessionToken: 'token2' }
      );

      // Retrieve events
      const events = eventsStore.getUiEventsBySession(uiSessionId);

      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event.ui_session_id).toBe(uiSessionId);
      }
    });

    it('should return empty array for unknown session', () => {
      const events = eventsStore.getUiEventsBySession('ui_unknown');
      expect(events).toHaveLength(0);
    });
  });
});
