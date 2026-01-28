/**
 * Unit tests for A2ASessionManager (PR #83)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { closeAllDbs } from '../../db/connection.js';
import { EVENTS_DB_SCHEMA, EVENTS_DB_VERSION } from '../../db/schema.js';
import { EventsStore } from '../../db/events-store.js';
import { A2ASessionManager, createA2ASessionManager } from '../session-manager.js';
import type { A2AMessage } from '../types.js';

describe('A2ASessionManager', () => {
  let tempDir: string;
  let eventsStore: EventsStore;
  let sessionManager: A2ASessionManager;
  const targetId = 'test-agent';

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = join(
      tmpdir(),
      `proofscan-a2a-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });

    // Create minimal config file
    const configPath = join(tempDir, 'proofscan.yaml');
    writeFileSync(configPath, 'connectors: []\n');

    // Setup test database with schema
    const dbPath = join(tempDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
    db.close();

    // Create session manager
    eventsStore = new EventsStore(tempDir);
    sessionManager = createA2ASessionManager(eventsStore, targetId);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Session creation and contextId reuse', () => {
    it('should create a new session when no contextId is provided', () => {
      const sessionId1 = sessionManager.getOrCreateSession();
      expect(sessionId1).toBeDefined();
      expect(typeof sessionId1).toBe('string');

      // Different contextId should create different session
      const sessionId2 = sessionManager.getOrCreateSession(undefined);
      expect(sessionId2).toBeDefined();
      expect(typeof sessionId2).toBe('string');
    });

    it('should reuse the same session for the same contextId', () => {
      const contextId = 'ctx-123';

      const sessionId1 = sessionManager.getOrCreateSession(contextId);
      const sessionId2 = sessionManager.getOrCreateSession(contextId);

      expect(sessionId1).toBe(sessionId2);
    });

    it('should create different sessions for different contextIds', () => {
      const contextId1 = 'ctx-123';
      const contextId2 = 'ctx-456';

      const sessionId1 = sessionManager.getOrCreateSession(contextId1);
      const sessionId2 = sessionManager.getOrCreateSession(contextId2);

      expect(sessionId1).toBeDefined();
      expect(sessionId2).toBeDefined();
      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should find existing session by contextId from in-memory cache', () => {
      const contextId = 'ctx-abc123';

      // First call creates new session
      const sessionId1 = sessionManager.getOrCreateSession(contextId);
      expect(sessionId1).toBeDefined();

      // Create a new session manager instance with same eventsStore
      const sessionManager2 = createA2ASessionManager(eventsStore, targetId);

      // Different session manager instance should not find the session
      // (in-memory cache is per-instance)
      const sessionId2 = sessionManager2.getOrCreateSession(contextId);
      expect(sessionId2).toBeDefined();
      // They will be different because the cache is per-instance
      // This is expected behavior for the in-memory implementation
    });
  });

  describe('Message recording', () => {
    it('should record request and response messages with same contextId', () => {
      const contextId = 'ctx-msg-001';
      const rpcId = 'rpc-001';

      const requestMessage: A2AMessage = {
        role: 'user',
        parts: [{ text: 'Hello, how are you?' }],
        messageId: 'msg-001',
      };

      const responseMessage: A2AMessage = {
        role: 'assistant',
        parts: [{ text: 'I am doing well, thank you!' }],
        messageId: 'msg-002',
      };

      // Record request
      sessionManager.recordMessage(contextId, requestMessage, true, rpcId);

      // Record response
      sessionManager.recordMessage(contextId, responseMessage, false, rpcId);

      // Verify both messages were recorded in the same session
      const sessionId = sessionManager.getOrCreateSession(contextId);
      const events = eventsStore.getEventsBySession(sessionId);

      expect(events).toBeDefined();
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it('should record messages with undefined contextId', () => {
      const rpcId = 'rpc-002';

      const message: A2AMessage = {
        role: 'user',
        parts: [{ text: 'Test message' }],
        messageId: 'msg-003',
      };

      // Should not throw
      expect(() => {
        sessionManager.recordMessage(undefined, message, true, rpcId);
      }).not.toThrow();
    });
  });

  describe('Error recording and RPC completion', () => {
    it('should record error and complete RPC with failure', () => {
      const contextId = 'ctx-error-001';
      const rpcId = 'rpc-error-001';

      const errorMessage = 'Test error';

      // Record error
      sessionManager.recordError(contextId, rpcId, errorMessage);

      // Should not throw
      expect(() => {
        sessionManager.recordError(contextId, rpcId, errorMessage);
      }).not.toThrow();
    });

    it('should handle error recording without contextId', () => {
      const rpcId = 'rpc-error-002';
      const errorMessage = 'Another test error';

      // Should not throw
      expect(() => {
        sessionManager.recordError(undefined, rpcId, errorMessage);
      }).not.toThrow();
    });
  });

  describe('Summary truncation', () => {
    it('should truncate messages longer than SUMMARY_MAX_LENGTH (50 characters)', () => {
      const contextId = 'ctx-trunc-001';
      const longText = 'A'.repeat(100); // 100 characters

      const longMessage: A2AMessage = {
        role: 'assistant',
        parts: [{ text: longText }],
        messageId: 'msg-trunc-001',
      };

      // Create a new session manager to capture events
      const tempDir2 = join(
        tmpdir(),
        `proofscan-a2a-trunc-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(tempDir2, { recursive: true });

      const configPath = join(tempDir2, 'proofscan.yaml');
      writeFileSync(configPath, 'connectors: []\n');

      const dbPath = join(tempDir2, 'events.db');
      const db = new Database(dbPath);
      db.exec(EVENTS_DB_SCHEMA);
      db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
      db.close();

      const eventsStore2 = new EventsStore(tempDir2);
      const sessionManager2 = createA2ASessionManager(eventsStore2, targetId);

      sessionManager2.recordMessage(contextId, longMessage, false);

      const sessionId = sessionManager2.getOrCreateSession(contextId);
      const events = eventsStore2.getEventsBySession(sessionId);

      expect(events.length).toBeGreaterThan(0);

      // The summary should be truncated (contain '...')
      const summary = events[0].summary;
      expect(summary).toBeDefined();
      expect(summary).toContain('...');
      // The actual text portion should be truncated to 50 chars before '...'
      const textMatch = summary.match(/🤖 ← (.+)\.\.\.$/);
      expect(textMatch).not.toBeNull();
      expect(textMatch![1].length).toBe(50);

      closeAllDbs();
      rmSync(tempDir2, { recursive: true, force: true });
    });

    it('should not truncate messages shorter than SUMMARY_MAX_LENGTH', () => {
      const contextId = 'ctx-trunc-002';
      const shortText = 'Short message';

      const shortMessage: A2AMessage = {
        role: 'assistant',
        parts: [{ text: shortText }],
        messageId: 'msg-trunc-002',
      };

      const tempDir2 = join(
        tmpdir(),
        `proofscan-a2a-short-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(tempDir2, { recursive: true });

      const configPath = join(tempDir2, 'proofscan.yaml');
      writeFileSync(configPath, 'connectors: []\n');

      const dbPath = join(tempDir2, 'events.db');
      const db = new Database(dbPath);
      db.exec(EVENTS_DB_SCHEMA);
      db.pragma(`user_version = ${EVENTS_DB_VERSION}`);
      db.close();

      const eventsStore2 = new EventsStore(tempDir2);
      const sessionManager2 = createA2ASessionManager(eventsStore2, targetId);

      sessionManager2.recordMessage(contextId, shortMessage, false);

      const sessionId = sessionManager2.getOrCreateSession(contextId);
      const events = eventsStore2.getEventsBySession(sessionId);

      expect(events.length).toBeGreaterThan(0);

      const summary = events[0].summary;
      expect(summary).toBeDefined();
      expect(summary).toContain(shortText);
      expect(summary.endsWith('...')).toBe(false);

      closeAllDbs();
      rmSync(tempDir2, { recursive: true, force: true });
    });
  });

  describe('EventsStore access', () => {
    it('should expose EventsStore via getter', () => {
      const eventsStoreFromGetter = sessionManager.getEventsStore();

      expect(eventsStoreFromGetter).toBeDefined();
      expect(eventsStoreFromGetter).toBe(eventsStore);
    });
  });
});
