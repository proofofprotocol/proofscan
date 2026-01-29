/**
 * Tests for EventsStore A2A methods
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { EventsStore } from '../events-store.js';
import { getEventsDb, closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA } from '../schema.js';

describe('EventsStore - A2A Methods', () => {
  let testDir: string;
  let store: EventsStore;
  let agentId: string;
  let sessionId: string;

  beforeEach(() => {
    // Close any cached DB connections before creating new test dir
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 6');
    db.close();

    store = new EventsStore(testDir);
    agentId = 'test-agent-id';

    // Create test session and events
    sessionId = store.createSession(agentId, {
      actorId: 'actor-1',
      actorKind: 'agent',
      actorLabel: 'Test Agent'
    }).session_id;
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  function addTestEvent(sessionId: string, actor: 'user' | 'assistant', content: string) {
    const normalized = JSON.stringify({
      actor,
      content: { type: 'text', text: content },
      role: actor,
      timestamp: new Date().toISOString()
    });
    const stmt = store.db.prepare(`
      INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
      VALUES (?, datetime('now'), 'request', 'client_to_server', ?, ?)
    `);
    stmt.run(sessionId, normalized, normalized);
  }

  describe('getA2ASessions', () => {
    it('should return empty array when no sessions exist', () => {
      const sessions = store.getA2ASessions('non-existent-agent');
      expect(sessions).toEqual([]);
    });

    it('should return sessions with correct message count (user + assistant)', () => {
      // Add user messages
      addTestEvent(sessionId, 'user', 'Hello');
      addTestEvent(sessionId, 'user', 'How are you?');

      // Add assistant messages
      addTestEvent(sessionId, 'assistant', 'Hi there!');
      addTestEvent(sessionId, 'assistant', 'I am doing well');

      const sessions = store.getA2ASessions(agentId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe(sessionId);
      expect(sessions[0].message_count).toBe(4); // 2 user + 2 assistant
    });

    it('should count only user messages when no assistant messages exist', () => {
      addTestEvent(sessionId, 'user', 'Hello');
      addTestEvent(sessionId, 'user', 'Question');

      const sessions = store.getA2ASessions(agentId);

      expect(sessions[0].message_count).toBe(2);
    });

    it('should count only assistant messages when no user messages exist', () => {
      addTestEvent(sessionId, 'assistant', 'Response 1');
      addTestEvent(sessionId, 'assistant', 'Response 2');

      const sessions = store.getA2ASessions(agentId);

      expect(sessions[0].message_count).toBe(2);
    });

    it('should respect limit parameter', () => {
      // Create multiple sessions
      const session2 = store.createSession(agentId, { actorKind: 'agent' }).session_id;
      const session3 = store.createSession(agentId, { actorKind: 'agent' }).session_id;

      addTestEvent(sessionId, 'user', 'msg1');
      addTestEvent(session2, 'user', 'msg2');
      addTestEvent(session3, 'user', 'msg3');

      const sessions = store.getA2ASessions(agentId, 2);

      expect(sessions).toHaveLength(2);
    });

    it('should order by last_activity descending', () => {
      // Use a separate agentId to avoid interference from beforeEach session
      const orderTestAgentId = 'order-test-agent';

      // Create first session with earlier timestamp
      const session1 = store.createSession(orderTestAgentId, { actorKind: 'agent' }).session_id;
      const stmt1 = store.db.prepare(`
        INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
        VALUES (?, '2026-01-01T10:00:00Z', 'request', 'client_to_server', ?, ?)
      `);
      stmt1.run(session1, JSON.stringify({ actor: 'user', content: { type: 'text', text: 'first' } }), '{}');

      // Create second session with later timestamp
      const session2 = store.createSession(orderTestAgentId, { actorKind: 'agent' }).session_id;
      const stmt2 = store.db.prepare(`
        INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
        VALUES (?, '2026-01-01T12:00:00Z', 'request', 'client_to_server', ?, ?)
      `);
      stmt2.run(session2, JSON.stringify({ actor: 'user', content: { type: 'text', text: 'second' } }), '{}');

      const sessions = store.getA2ASessions(orderTestAgentId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].session_id).toBe(session2); // Later activity first
      expect(sessions[1].session_id).toBe(session1);
    });

    it('should only return sessions with actor_kind = agent', () => {
      // Create non-agent session
      const nonAgentSession = store.createSession(agentId, {
        actorKind: 'user',
        actorLabel: 'Regular User'
      }).session_id;

      addTestEvent(sessionId, 'user', 'agent session message');
      addTestEvent(nonAgentSession, 'user', 'non-agent message');

      const sessions = store.getA2ASessions(agentId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe(sessionId);
    });

    it('should have last_activity when session has events', () => {
      addTestEvent(sessionId, 'user', 'message');

      const sessions = store.getA2ASessions(agentId);

      expect(sessions[0].last_activity).toBeDefined();
      expect(sessions[0].last_activity).not.toBe('');
    });

    it('should use started_at as last_activity when session has no events', () => {
      const sessions = store.getA2ASessions(agentId);

      expect(sessions[0].last_activity).toBeDefined();
      expect(sessions[0].last_activity).not.toBe('');
    });
  });

  describe('getA2AMessages', () => {
    it('should return empty array when no messages exist', () => {
      const messages = store.getA2AMessages(sessionId);
      expect(messages).toEqual([]);
    });

    it('should return messages with correct role for user', () => {
      addTestEvent(sessionId, 'user', 'Hello user');

      const messages = store.getA2AMessages(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello user');
      expect(messages[0].timestamp).toBeDefined();
    });

    it('should return messages with correct role for assistant', () => {
      addTestEvent(sessionId, 'assistant', 'Hello assistant');

      const messages = store.getA2AMessages(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Hello assistant');
    });

    it('should return multiple messages in correct order', () => {
      addTestEvent(sessionId, 'user', 'First');
      addTestEvent(sessionId, 'assistant', 'Second');
      addTestEvent(sessionId, 'user', 'Third');

      const messages = store.getA2AMessages(sessionId);

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('should respect limit parameter', () => {
      addTestEvent(sessionId, 'user', 'msg1');
      addTestEvent(sessionId, 'assistant', 'msg2');
      addTestEvent(sessionId, 'user', 'msg3');

      const messages = store.getA2AMessages(sessionId, 2);

      expect(messages).toHaveLength(2);
    });

    it('should include id and rawJson', () => {
      addTestEvent(sessionId, 'user', 'test message');

      const messages = store.getA2AMessages(sessionId);

      expect(messages[0].id).toBeDefined();
      expect(typeof messages[0].id).toBe('number');
      expect(messages[0].rawJson).toBeDefined();
    });
  });

  describe('getA2AMessageByIndex', () => {
    it('should return null for non-existent session', () => {
      const msg = store.getA2AMessageByIndex('non-existent', 1);
      expect(msg).toBeNull();
    });

    it('should return null for out of bounds index', () => {
      addTestEvent(sessionId, 'user', 'only one');

      const msg = store.getA2AMessageByIndex(sessionId, 5);
      expect(msg).toBeNull();
    });

    it('should return null for empty session', () => {
      const msg = store.getA2AMessageByIndex(sessionId, 1);
      expect(msg).toBeNull();
    });

    it('should return message at index 1 (first message)', () => {
      addTestEvent(sessionId, 'user', 'first');
      addTestEvent(sessionId, 'assistant', 'second');

      const msg = store.getA2AMessageByIndex(sessionId, 1);

      expect(msg).not.toBeNull();
      expect(msg?.content).toBe('first');
      expect(msg?.role).toBe('user');
    });

    it('should return message at specific index', () => {
      addTestEvent(sessionId, 'user', 'first');
      addTestEvent(sessionId, 'assistant', 'second');
      addTestEvent(sessionId, 'user', 'third');

      const msg = store.getA2AMessageByIndex(sessionId, 2);

      expect(msg?.content).toBe('second');
      expect(msg?.role).toBe('assistant');
    });

    it('should return correct message structure', () => {
      addTestEvent(sessionId, 'user', 'test');

      const msg = store.getA2AMessageByIndex(sessionId, 1);

      expect(msg).toMatchObject({
        id: expect.any(Number),
        role: expect.any(String),
        content: expect.any(String),
        timestamp: expect.any(String),
        rawJson: expect.any(String)
      });
    });
  });

  describe('getA2ASessionById', () => {
    it('should return undefined for non-existent session', () => {
      const session = store.getA2ASessionById('non-existent');
      expect(session).toBeUndefined();
    });

    it('should return session with correct fields', () => {
      const session = store.getA2ASessionById(sessionId);

      expect(session).toBeDefined();
      expect(session?.session_id).toBe(sessionId);
      expect(session?.target_id).toBe(agentId);
    });

    it('should include session timestamps', () => {
      const session = store.getA2ASessionById(sessionId);

      expect(session?.started_at).toBeDefined();
      expect(typeof session?.started_at).toBe('string');
    });

    it('should return undefined for sessions without actor_kind = agent', () => {
      const userSession = store.createSession(agentId, {
        actorKind: 'user'
      }).session_id;

      const session = store.getA2ASessionById(userSession);
      expect(session).toBeUndefined();
    });

    it('should count both user and assistant messages in message_count', () => {
      addTestEvent(sessionId, 'user', 'user message 1');
      addTestEvent(sessionId, 'user', 'user message 2');
      addTestEvent(sessionId, 'assistant', 'assistant message 1');
      addTestEvent(sessionId, 'assistant', 'assistant message 2');

      const session = store.getA2ASessionById(sessionId);

      expect(session?.message_count).toBe(4);
    });
  });
});
