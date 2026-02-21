/**
 * Tests for ProofComm Document Responder
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
import { DocumentResponder } from '../responder.js';
import type { DocumentMessage } from '../types.js';

describe('DocumentResponder', () => {
  let testDir: string;
  let store: DocumentsStore;
  let responder: DocumentResponder;
  let testDocPath: string;
  let docId: string;

  const testContent = `# Test Document

This document is about testing.

## Section 1: Introduction

This is the introduction section with important information.

## Section 2: Details

Here are some details about the topic.
Keywords: testing, example, demonstration
`;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-responder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test document file
    testDocPath = join(testDir, 'test.md');
    writeFileSync(testDocPath, testContent);

    // Initialize database
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 10');
    db.close();

    store = new DocumentsStore(testDir);
    responder = new DocumentResponder(store);

    // Create a test document
    const doc = store.add({
      name: 'Test Document',
      documentPath: testDocPath,
      documentHash: 'initial-hash',
    });
    docId = doc.docId;
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('processMessage', () => {
    it('should respond with document intro for generic message', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello' }],
      };

      const response = await responder.processMessage(docId, message);

      expect(response.parts).toHaveLength(1);
      expect(response.parts[0]).toHaveProperty('text');
      expect((response.parts[0] as { text: string }).text).toContain('Test Document');
    });

    it('should respond with content for "content" command', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'content' }],
      };

      const response = await responder.processMessage(docId, message);

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('# Test Document');
      expect(text).toContain('Section 1');
    });

    it('should respond with summary for "summary" command', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'summary' }],
      };

      const response = await responder.processMessage(docId, message);

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('Summary');
    });

    it('should respond with info for "info" command', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'info' }],
      };

      const response = await responder.processMessage(docId, message);

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('Document:');
      expect(text).toContain('ID:');
      expect(text).toContain('Size:');
    });

    it('should find relevant excerpt for keyword search', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Tell me about the introduction' }],
      };

      const response = await responder.processMessage(docId, message);

      const text = (response.parts[0] as { text: string }).text;
      // The response should contain the section with Introduction (case may vary)
      expect(text.toLowerCase()).toContain('introduction');
    });

    it('should update memory when enabled', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello' }],
      };

      const response = await responder.processMessage(docId, message, {
        updateMemory: true,
      });

      expect(response.memoryUpdated).toBe(true);
      expect(response.updatedMemory).toBeDefined();
      expect(response.updatedMemory?.interactionCount).toBe(1);
    });

    it('should not update memory when disabled', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello' }],
      };

      const response = await responder.processMessage(docId, message, {
        updateMemory: false,
      });

      expect(response.memoryUpdated).toBe(false);
      expect(response.updatedMemory).toBeUndefined();
    });

    it('should return error for non-existent document', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello' }],
      };

      const response = await responder.processMessage('non-existent', message);

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('Error');
      expect(text).toContain('not found');
    });

    it('should truncate long responses', async () => {
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'content' }],
      };

      const response = await responder.processMessage(docId, message, {
        maxResponseLength: 50,
      });

      const text = (response.parts[0] as { text: string }).text;
      expect(text.length).toBeLessThanOrEqual(50);
      expect(text).toContain('...');
    });
  });

  describe('hasContentChanged', () => {
    it('should return false for unchanged content', async () => {
      // Update hash to match actual content
      const doc = store.get(docId);
      if (doc) {
        const { computeHash } = await import('../store.js');
        const actualHash = computeHash(testContent);
        store.updateHash(docId, actualHash);
      }

      const changed = await responder.hasContentChanged(docId);
      expect(changed).toBe(false);
    });

    it('should return true for changed content', async () => {
      // Keep the initial (wrong) hash, so content appears changed
      const changed = await responder.hasContentChanged(docId);
      expect(changed).toBe(true);
    });
  });

  describe('refreshHash', () => {
    it('should update document hash', async () => {
      const newHash = await responder.refreshHash(docId);

      expect(newHash).toBeDefined();
      expect(newHash).toHaveLength(64);

      const doc = store.get(docId);
      expect(doc?.documentHash).toBe(newHash);
    });

    it('should return null for non-existent document', async () => {
      const result = await responder.refreshHash('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('memory command', () => {
    it('should show memory state', async () => {
      // First, have an interaction to create memory
      const msg1: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'Hello' }],
      };
      await responder.processMessage(docId, msg1);

      // Then ask for memory
      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'memory' }],
      };
      const response = await responder.processMessage(docId, message);

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('Memory');
      expect(text).toContain('Interactions');
    });

    it('should show no memory message when empty', async () => {
      // Clear any memory first
      store.setMemory(docId, null);

      const message: DocumentMessage = {
        from: 'user',
        parts: [{ text: 'memory' }],
      };
      const response = await responder.processMessage(docId, message, {
        updateMemory: false,
      });

      const text = (response.parts[0] as { text: string }).text;
      expect(text).toContain('No conversation memory');
    });
  });
});
