/**
 * Tests for history command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { EventsStore } from '../../db/events-store.js';
import { getEventsDb, closeAllDbs } from '../../db/connection.js';
import { EVENTS_DB_SCHEMA } from '../../db/schema.js';

describe('history command', () => {
  let testDir: string;
  let store: EventsStore;
  let sessionId: string;
  let targetId: string;

  beforeEach(() => {
    // Close any cached DB connections before creating new test dir
    closeAllDbs();

    testDir = join(tmpdir(), `history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 6');
    db.close();

    store = new EventsStore(testDir);
    targetId = 'test-agent';

    // Create test session and get the session_id
    const session = store.createSession(targetId, {
      actorId: 'actor-1',
      actorKind: 'agent',
      actorLabel: 'Test Agent'
    });
    sessionId = session.session_id;
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  function addTestEvent(sessionId: string, actor: 'user' | 'assistant', content: string, ts?: string) {
    const normalized = JSON.stringify({
      actor,
      content: { type: 'text', text: content },
      role: actor,
      timestamp: ts || new Date().toISOString()
    });
    const timestamp = ts || new Date().toISOString().slice(0, -5) + 'Z';
    const stmt = store.db.prepare(`
      INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
      VALUES (?, ?, 'request', 'client_to_server', ?, ?)
    `);
    stmt.run(sessionId, timestamp, normalized, normalized);
  }

  it('should return empty array for session with no messages', () => {
    const messages = store.getA2AMessages(sessionId, 100);
    expect(messages).toEqual([]);
  });

  it('should retrieve messages from A2A session', () => {
    addTestEvent(sessionId, 'user', 'hello', '2025-01-25T10:30:15Z');
    addTestEvent(sessionId, 'assistant', 'hi there!', '2025-01-25T10:30:16Z');

    const messages = store.getA2AMessages(sessionId, 100);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: 1,
      role: 'user',
      content: 'hello',
      timestamp: '2025-01-25T10:30:15Z'
    });
    expect(messages[1]).toMatchObject({
      id: 2,
      role: 'assistant',
      content: 'hi there!',
      timestamp: '2025-01-25T10:30:16Z'
    });
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      addTestEvent(sessionId, 'user', `message ${i}`, `2025-01-25T10:30:${15 + i}Z`);
    }

    const messages = store.getA2AMessages(sessionId, 3);
    expect(messages).toHaveLength(3);
  });

  it('should filter by role', () => {
    addTestEvent(sessionId, 'user', 'user message 1', '2025-01-25T10:30:15Z');
    addTestEvent(sessionId, 'assistant', 'assistant message', '2025-01-25T10:30:16Z');
    addTestEvent(sessionId, 'user', 'user message 2', '2025-01-25T10:30:17Z');

    const messages = store.getA2AMessages(sessionId, 100);

    const userMessages = messages.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(2);

    const assistantMessages = messages.filter(m => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
  });

  it('should handle text search', () => {
    addTestEvent(sessionId, 'user', 'roll d20', '2025-01-25T10:30:15Z');
    addTestEvent(sessionId, 'assistant', '🎲 d20 → 15', '2025-01-25T10:30:16Z');
    addTestEvent(sessionId, 'user', 'roll again', '2025-01-25T10:31:00Z');

    const messages = store.getA2AMessages(sessionId, 100);

    const rollMessages = messages.filter(m =>
      m.content.toLowerCase().includes('roll')
    );
    expect(rollMessages).toHaveLength(2);

    const d20Messages = messages.filter(m =>
      m.content.toLowerCase().includes('d20')
    );
    expect(d20Messages).toHaveLength(2);

    const againMessages = messages.filter(m =>
      m.content.toLowerCase().includes('again')
    );
    expect(againMessages).toHaveLength(1);
  });

  it('should handle case-insensitive search', () => {
    addTestEvent(sessionId, 'user', 'DICE ROLL', '2025-01-25T10:30:15Z');

    const messages = store.getA2AMessages(sessionId, 100);

    // Searching for lowercase 'dice' should match 'DICE ROLL'
    const lowerSearch = messages.filter(m =>
      m.content.toLowerCase().includes('dice')
    );
    expect(lowerSearch).toHaveLength(1);

    // Searching for uppercase 'DICE' (lowercased for comparison) should match 'DICE ROLL'
    const upperSearch = messages.filter(m =>
      m.content.toLowerCase().includes('dice')
    );
    expect(upperSearch).toHaveLength(1);
  });

  it('should return messages ordered by timestamp', () => {
    const timestamps = [
      '2025-01-25T10:30:15Z',
      '2025-01-25T10:30:17Z',
      '2025-01-25T10:30:16Z',
    ];

    timestamps.forEach(ts => {
      addTestEvent(sessionId, 'user', 'message', ts);
    });

    const messages = store.getA2AMessages(sessionId, 100);

    expect(messages[0].timestamp).toBe('2025-01-25T10:30:15Z');
    expect(messages[1].timestamp).toBe('2025-01-25T10:30:16Z');
    expect(messages[2].timestamp).toBe('2025-01-25T10:30:17Z');
  });

  it('should handle limit of 0 or negative by using default', () => {
    // Test that limit = 0 or negative doesn't break,
    // the command layer handles this (prints error)
    // At DB level, limit 0 should return empty array
    const messages = store.getA2AMessages(sessionId, 0);
    expect(messages).toHaveLength(0);
  });

  it('should handle combined filters (role + search)', () => {
    addTestEvent(sessionId, 'user', 'roll d20', '2025-01-25T10:30:15Z');
    addTestEvent(sessionId, 'assistant', '🎲 d20 → 15', '2025-01-25T10:30:16Z');
    addTestEvent(sessionId, 'user', 'hello world', '2025-01-25T10:31:00Z');

    const messages = store.getA2AMessages(sessionId, 100);

    // Filter by role=user AND search=d20
    const filtered = messages
      .filter(m => m.role === 'user')
      .filter(m => m.content.toLowerCase().includes('d20'));

    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe('roll d20');
  });

  it('should handle search with special regex characters', () => {
    addTestEvent(sessionId, 'user', 'test [bracket] content', '2025-01-25T10:30:15Z');
    addTestEvent(sessionId, 'user', 'test (paren) content', '2025-01-25T10:30:16Z');
    addTestEvent(sessionId, 'user', 'test $dollar content', '2025-01-25T10:30:17Z');

    const messages = store.getA2AMessages(sessionId, 100);

    // These are simple string searches, not regex, so should work
    const bracketSearch = messages.filter(m =>
      m.content.toLowerCase().includes('[bracket]')
    );
    expect(bracketSearch).toHaveLength(1);

    const parenSearch = messages.filter(m =>
      m.content.toLowerCase().includes('(paren)')
    );
    expect(parenSearch).toHaveLength(1);
  });

  // ==================== Phase 2.3.1: Cross-session history ====================

  function addTestEventToSession(sessionId: string, actor: 'user' | 'assistant', content: string, ts?: string) {
    const normalized = JSON.stringify({
      actor,
      content: { type: 'text', text: content },
      role: actor,
      timestamp: ts || new Date().toISOString()
    });
    const timestamp = ts || new Date().toISOString().slice(0, -5) + 'Z';
    const stmt = store.db.prepare(`
      INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
      VALUES (?, ?, 'request', 'client_to_server', ?, ?)
    `);
    stmt.run(sessionId, timestamp, normalized, normalized);
  }

  describe('Phase 2.3.1 - Cross-session history search', () => {
    let session1: string;
    let session2: string;
    let session3: string;

    beforeEach(() => {
      // Create multiple sessions for the same target
      const s1 = store.createSession(targetId, {
        actorId: 'actor-1',
        actorKind: 'agent',
        actorLabel: 'Test Agent'
      });
      session1 = s1.session_id;

      const s2 = store.createSession(targetId, {
        actorId: 'actor-1',
        actorKind: 'agent',
        actorLabel: 'Test Agent'
      });
      session2 = s2.session_id;

      const s3 = store.createSession(targetId, {
        actorId: 'actor-1',
        actorKind: 'agent',
        actorLabel: 'Test Agent'
      });
      session3 = s3.session_id;

      // Add messages to each session with different timestamps
      addTestEventToSession(session1, 'user', 'session1: roll d20', '2025-01-25T10:00:00Z');
      addTestEventToSession(session1, 'assistant', 'session1: 🎲 d20 → 15', '2025-01-25T10:00:01Z');

      addTestEventToSession(session2, 'user', 'session2: roll 2d6', '2025-01-25T11:00:00Z');
      addTestEventToSession(session2, 'assistant', 'session2: 🎲 2d6 → [4, 3]', '2025-01-25T11:00:01Z');

      addTestEventToSession(session3, 'user', 'session3: hello', '2025-01-25T12:00:00Z');
      addTestEventToSession(session3, 'assistant', 'session3: hi there!', '2025-01-25T12:00:01Z');
    });

    it('should return empty array for target with no messages', () => {
      const messages = store.getA2AMessagesForTarget('nonexistent-target', 100);
      expect(messages).toEqual([]);
    });

    it('should retrieve messages across all sessions for a target', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      expect(messages).toHaveLength(6);
      // Check that messages from all three sessions are included
      const sessionIds = new Set(messages.map(m => m.sessionId));
      expect(sessionIds.has(session1)).toBe(true);
      expect(sessionIds.has(session2)).toBe(true);
      expect(sessionIds.has(session3)).toBe(true);
    });

    it('should return messages in chronological order (newest first)', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      expect(messages[0].timestamp).toBe('2025-01-25T12:00:01Z');
      expect(messages[0].content).toBe('session3: hi there!');
      expect(messages[messages.length - 1].timestamp).toBe('2025-01-25T10:00:00Z');
      expect(messages[messages.length - 1].content).toBe('session1: roll d20');
    });

    it('should respect limit parameter', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 3);
      expect(messages).toHaveLength(3);
      // Should get the newest 3 messages
      expect(messages[0].content).toBe('session3: hi there!');
      expect(messages[1].content).toBe('session3: hello');
      expect(messages[2].content).toBe('session2: 🎲 2d6 → [4, 3]');
    });

    it('should include sessionId in returned messages', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      messages.forEach(m => {
        expect(m.sessionId).toBeTruthy();
        expect(typeof m.sessionId).toBe('string');
        expect(m.sessionId.length).toBeGreaterThan(0);
      });
    });

    it('should filter by role at connector level (manual filter)', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      // Manually filter by role (simulating command layer)
      const userMessages = messages.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(3);

      const assistantMessages = messages.filter(m => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(3);
    });

    it('should search messages across sessions (manual filter)', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      // Manually search for 'roll' (simulating command layer)
      const rollMessages = messages.filter(m =>
        m.content.toLowerCase().includes('roll')
      );
      expect(rollMessages).toHaveLength(2);
      // Returned in newest first order
      expect(rollMessages[0].sessionId).toBe(session2);
      expect(rollMessages[1].sessionId).toBe(session1);
    });

    it('should handle combined filters (role + search) across sessions', () => {
      const messages = store.getA2AMessagesForTarget(targetId, 100);

      // Filter by role=user AND search=d20 (simulating command layer)
      const filtered = messages
        .filter(m => m.role === 'user')
        .filter(m => m.content.toLowerCase().includes('d20'));

      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe('session1: roll d20');
      expect(filtered[0].sessionId).toBe(session1);
    });

    it('should only return messages for the specified target', () => {
      // Create a session for a different target
      const otherSession = store.createSession('other-agent', {
        actorId: 'actor-2',
        actorKind: 'agent',
        actorLabel: 'Other Agent'
      });

      addTestEventToSession(otherSession.session_id, 'user', 'other session message', '2025-01-25T13:00:00Z');

      const messages = store.getA2AMessagesForTarget(targetId, 100);

      // Should not include messages from other-agent
      const sessionIds = new Set(messages.map(m => m.sessionId));
      expect(sessionIds.has(otherSession.session_id)).toBe(false);
      expect(sessionIds.has(session1)).toBe(true);
      expect(sessionIds.has(session2)).toBe(true);
      expect(sessionIds.has(session3)).toBe(true);
    });

    it('should handle empty content gracefully', () => {
      const emptySession = store.createSession(targetId, {
        actorId: 'actor-1',
        actorKind: 'agent',
        actorLabel: 'Test Agent'
      });

      // Add event with null content (json_extract returns null)
      const normalizedWithNullContent = JSON.stringify({
        actor: 'user',
        content: null,
      });
      const stmt = store.db.prepare(`
        INSERT INTO events (session_id, ts, kind, direction, normalized_json, raw_json)
        VALUES (?, ?, 'request', 'client_to_server', ?, ?)
      `);
      stmt.run(emptySession.session_id, '2025-01-25T13:00:00Z', normalizedWithNullContent, normalizedWithNullContent);

      const messages = store.getA2AMessagesForTarget(targetId, 100);

      // Message should be included with empty content
      const emptyMsg = messages.find(m => m.sessionId === emptySession.session_id);
      expect(emptyMsg).toBeTruthy();
      expect(emptyMsg?.content).toBe('');
    });
  });
});
