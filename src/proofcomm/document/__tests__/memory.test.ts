/**
 * Tests for ProofComm Document Memory Manager
 * Phase 9.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { DocumentsStore } from '../../../db/documents-store.js';
import { closeAllDbs } from '../../../db/connection.js';
import { EVENTS_DB_SCHEMA } from '../../../db/schema.js';
import { DocumentMemoryManager } from '../memory.js';
import type { DocumentMessage } from '../types.js';

describe('DocumentMemoryManager', () => {
  let testDir: string;
  let store: DocumentsStore;
  let manager: DocumentMemoryManager;
  let testDocPath: string;
  let docId: string;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test document file
    testDocPath = join(testDir, 'test.md');
    writeFileSync(testDocPath, 'Test content');

    // Initialize database
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 11');
    db.close();

    store = new DocumentsStore(testDir);
    manager = new DocumentMemoryManager(store);

    // Create a test document
    const doc = store.add({
      name: 'Test Document',
      documentPath: testDocPath,
    });
    docId = doc.docId;
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getMemory', () => {
    it('should return undefined for document without memory', () => {
      const memory = manager.getMemory(docId);
      expect(memory).toBeUndefined();
    });

    it('should return memory for document with memory', () => {
      store.setMemory(docId, {
        conversationSummary: 'Test summary',
        facts: ['fact1'],
      });

      const memory = manager.getMemory(docId);
      expect(memory).toBeDefined();
      expect(memory?.conversationSummary).toBe('Test summary');
    });

    it('should return undefined for non-existent document', () => {
      const memory = manager.getMemory('non-existent');
      expect(memory).toBeUndefined();
    });
  });

  describe('updateMemory', () => {
    it('should update memory after interaction', () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello, document!' }],
      };

      const updated = manager.updateMemory(docId, message, 'Hello back!');

      expect(updated).toBeDefined();
      expect(updated?.interactionCount).toBe(1);
      expect(updated?.lastInteractionAt).toBeDefined();
      expect(updated?.conversationSummary).toContain('Hello, document!');
    });

    it('should increment interaction count', () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Message' }],
      };

      manager.updateMemory(docId, message, 'Response 1');
      const updated = manager.updateMemory(docId, message, 'Response 2');

      expect(updated?.interactionCount).toBe(2);
    });

    it('should return undefined for non-existent document', () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Test' }],
      };

      const result = manager.updateMemory('non-existent', message, 'Response');
      expect(result).toBeUndefined();
    });
  });

  describe('addFact', () => {
    it('should add fact to memory', () => {
      const success = manager.addFact(docId, 'Important fact');
      expect(success).toBe(true);

      const memory = manager.getMemory(docId);
      expect(memory?.facts).toContain('Important fact');
    });

    it('should not add duplicate facts', () => {
      manager.addFact(docId, 'Unique fact');
      const success = manager.addFact(docId, 'Unique fact');
      expect(success).toBe(false);

      const memory = manager.getMemory(docId);
      expect(memory?.facts).toHaveLength(1);
    });

    it('should maintain FIFO when at max facts', () => {
      // Add many facts (MAX_FACTS is 100)
      for (let i = 0; i < 105; i++) {
        manager.addFact(docId, `Fact ${i}`);
      }

      const memory = manager.getMemory(docId);
      expect(memory?.facts).toHaveLength(100);
      // First 5 facts should be removed
      expect(memory?.facts).not.toContain('Fact 0');
      expect(memory?.facts).toContain('Fact 104');
    });
  });

  describe('removeFact', () => {
    it('should remove existing fact', () => {
      manager.addFact(docId, 'Fact to remove');
      const success = manager.removeFact(docId, 'Fact to remove');
      expect(success).toBe(true);

      const memory = manager.getMemory(docId);
      expect(memory?.facts).not.toContain('Fact to remove');
    });

    it('should return false for non-existent fact', () => {
      const success = manager.removeFact(docId, 'Non-existent');
      expect(success).toBe(false);
    });
  });

  describe('clearFacts', () => {
    it('should clear all facts', () => {
      manager.addFact(docId, 'Fact 1');
      manager.addFact(docId, 'Fact 2');

      const success = manager.clearFacts(docId);
      expect(success).toBe(true);

      const memory = manager.getMemory(docId);
      expect(memory?.facts).toEqual([]);
    });
  });

  describe('clearSummary', () => {
    it('should clear conversation summary', () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Test' }],
      };
      manager.updateMemory(docId, message, 'Response');

      const success = manager.clearSummary(docId);
      expect(success).toBe(true);

      const memory = manager.getMemory(docId);
      expect(memory?.conversationSummary).toBe('');
    });
  });

  describe('clearMemory', () => {
    it('should clear all memory', () => {
      manager.addFact(docId, 'Fact');
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Test' }],
      };
      manager.updateMemory(docId, message, 'Response');

      const success = manager.clearMemory(docId);
      expect(success).toBe(true);

      const memory = manager.getMemory(docId);
      expect(memory).toBeUndefined();
    });
  });

  describe('getMemorySummary', () => {
    it('should return summary of empty memory', () => {
      const summary = manager.getMemorySummary(docId);
      expect(summary.hasMemory).toBe(false);
      expect(summary.factCount).toBe(0);
      expect(summary.interactionCount).toBe(0);
    });

    it('should return summary of populated memory', () => {
      manager.addFact(docId, 'Fact 1');
      manager.addFact(docId, 'Fact 2');

      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Test' }],
      };
      manager.updateMemory(docId, message, 'Response');

      const summary = manager.getMemorySummary(docId);
      expect(summary.hasMemory).toBe(true);
      expect(summary.factCount).toBe(2);
      expect(summary.interactionCount).toBe(1);
      expect(summary.lastInteractionAt).toBeDefined();
    });
  });
});
