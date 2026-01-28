/**
 * A2A Session Manager Tests
 *
 * Tests for A2A session recording in EventLineDB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createA2ASessionManager } from '../session-manager.js';
import { EventsStore } from '../../db/events-store.js';
import type { A2AMessage } from '../types.js';

describe('A2ASessionManager', () => {
  let testDir: string;
  let eventsStore: EventsStore;
  let manager: ReturnType<typeof createA2ASessionManager>;

  beforeEach(() => {
    // Create temporary directory for test
    testDir = join(tmpdir(), `proofscan-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });

    eventsStore = new EventsStore(testDir);
    manager = createA2ASessionManager(eventsStore, 'test-agent');
  });

  afterEach(() => {
    // Cleanup test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getOrCreateSession', () => {
    it('should create a new session', () => {
      const sessionId = manager.getOrCreateSession();
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should reuse session for same contextId', () => {
      const contextId = 'ctx-123';
      const session1 = manager.getOrCreateSession(contextId);
      const session2 = manager.getOrCreateSession(contextId);
      expect(session1).toBe(session2);
    });

    it('should create new session for different contextId', () => {
      const session1 = manager.getOrCreateSession('ctx-1');
      const session2 = manager.getOrCreateSession('ctx-2');
      expect(session1).not.toBe(session2);
    });
  });

  describe('recordMessage', () => {
    it('should record a user message (request)', () => {
      const message: A2AMessage = {
        role: 'user',
        parts: [{ text: 'hello' }],
        messageId: randomUUID(),
      };

      manager.recordMessage('ctx-123', message, true, 'rpc-1');

      // Check session was created
      const sessions = eventsStore.getSessionsByTarget('test-agent', 10);
      expect(sessions.length).toBeGreaterThan(0);

      // Check RPC was recorded
      const session = sessions[0];
      const rpcs = eventsStore.getRpcCallsBySession(session.session_id);
      expect(rpcs.length).toBeGreaterThan(0);

      const rpc = rpcs.find(r => r.method === 'message/send');
      expect(rpc).toBeDefined();
    });

    it('should record an assistant message (response)', () => {
      const message: A2AMessage = {
        role: 'assistant',
        parts: [{ text: 'hi there!' }],
        messageId: randomUUID(),
      };

      manager.recordMessage('ctx-123', message, false, 'rpc-1');

      // Check events were recorded
      const sessions = eventsStore.getSessionsByTarget('test-agent', 10);
      expect(sessions.length).toBeGreaterThan(0);

      const session = sessions[0];
      const events = eventsStore.getEventsBySession(session.session_id);
      expect(events.length).toBeGreaterThan(0);

      const responseEvent = events.find(e => e.kind === 'response');
      expect(responseEvent).toBeDefined();
    });

    it('should record message with text truncation in summary', () => {
      const longText = 'a'.repeat(100);
      const message: A2AMessage = {
        role: 'user',
        parts: [{ text: longText }],
        messageId: randomUUID(),
      };

      manager.recordMessage('ctx-123', message, true, 'rpc-1');

      const sessions = eventsStore.getSessionsByTarget('test-agent', 10);
      const session = sessions[0];
      const events = eventsStore.getEventsBySession(session.session_id);

      const requestEvent = events.find(e => e.kind === 'request');
      expect(requestEvent?.summary).toBeDefined();
      expect(requestEvent?.summary!.length).toBeLessThan(longText.length + 20); // Summary should be shorter
    });
  });

  describe('recordError', () => {
    it('should record RPC error', () => {
      const message: A2AMessage = {
        role: 'user',
        parts: [{ text: 'hello' }],
        messageId: randomUUID(),
      };

      manager.recordMessage('ctx-123', message, true, 'rpc-1');
      manager.recordError('ctx-123', 'rpc-1', 'Connection failed');

      const sessions = eventsStore.getSessionsByTarget('test-agent', 10);
      const session = sessions[0];
      const rpcs = eventsStore.getRpcCallsBySession(session.session_id);

      const rpc = rpcs.find(r => r.rpc_id === 'rpc-1');
      expect(rpc?.success).toBe(0);
      expect(rpc?.error_code).toBe(500);
    });
  });

  describe('full conversation flow', () => {
    it('should record a complete conversation', () => {
      const contextId = 'conv-123';
      const rpcId = 'rpc-123';

      // User message
      const userMsg: A2AMessage = {
        role: 'user',
        parts: [{ text: 'What is 2+2?' }],
        messageId: randomUUID(),
        contextId,
      };
      manager.recordMessage(contextId, userMsg, true, rpcId);

      // Assistant response
      const assistantMsg: A2AMessage = {
        role: 'assistant',
        parts: [{ text: '2+2 equals 4.' }],
        messageId: randomUUID(),
        contextId,
      };
      manager.recordMessage(contextId, assistantMsg, false, rpcId);

      // Verify session
      const sessions = eventsStore.getSessionsByTarget('test-agent', 10);
      expect(sessions.length).toBeGreaterThan(0);

      // Verify RPCs
      const session = sessions[0];
      const rpcs = eventsStore.getRpcCallsBySession(session.session_id);
      const messageRpc = rpcs.find(r => r.method === 'message/send');
      expect(messageRpc).toBeDefined();
      expect(messageRpc?.success).toBe(1);

      // Verify events
      const events = eventsStore.getEventsBySession(session.session_id);
      expect(events.some(e => e.kind === 'request')).toBe(true);
      expect(events.some(e => e.kind === 'response')).toBe(true);

      // Verify normalized JSON
      const normalizedEvent = events.find(e => e.normalized_json !== null);
      expect(normalizedEvent).toBeDefined();
      if (normalizedEvent?.normalized_json) {
        const normalized = JSON.parse(normalizedEvent.normalized_json);
        expect(normalized.protocol).toBe('a2a');
      }
    });
  });
});
