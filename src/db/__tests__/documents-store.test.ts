/**
 * Tests for DocumentsStore
 * Phase 9.0: ProofComm Resident Documents
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { DocumentsStore } from '../documents-store.js';
import { closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA } from '../schema.js';

describe('DocumentsStore', () => {
  let testDir: string;
  let store: DocumentsStore;
  let testDocPath: string;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test document file
    testDocPath = join(testDir, 'test-document.md');
    writeFileSync(testDocPath, '# Test Document\n\nThis is a test document.');

    // Initialize database with schema
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 11');
    db.close();

    store = new DocumentsStore(testDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('add', () => {
    it('should add a new document', () => {
      const doc = store.add({
        name: 'Test Document',
        documentPath: testDocPath,
        documentHash: 'abc123',
      });

      expect(doc.docId).toBeDefined();
      expect(doc.name).toBe('Test Document');
      expect(doc.documentPath).toBe(testDocPath);
      expect(doc.documentHash).toBe('abc123');
      expect(doc.createdAt).toBeDefined();
    });

    it('should add document with memory', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        memory: {
          conversationSummary: 'Test summary',
          facts: ['fact1', 'fact2'],
        },
      });

      expect(doc.memory).toBeDefined();
      expect(doc.memory?.conversationSummary).toBe('Test summary');
      expect(doc.memory?.facts).toEqual(['fact1', 'fact2']);
    });

    it('should add document with config', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        config: {
          schemaVersion: 1,
          description: 'Test description',
        },
      });

      expect(doc.config).toBeDefined();
      expect(doc.config?.schemaVersion).toBe(1);
      expect(doc.config?.description).toBe('Test description');
    });

    it('should use override ID if provided', () => {
      const doc = store.add(
        {
          name: 'Test',
          documentPath: testDocPath,
        },
        'custom-doc-id'
      );

      expect(doc.docId).toBe('custom-doc-id');
    });
  });

  describe('get', () => {
    it('should get document by ID', () => {
      const added = store.add({
        name: 'Test',
        documentPath: testDocPath,
      });

      const retrieved = store.get(added.docId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.docId).toBe(added.docId);
      expect(retrieved?.name).toBe('Test');
    });

    it('should return undefined for non-existent ID', () => {
      const result = store.get('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getByPath', () => {
    it('should get document by path', () => {
      store.add({
        name: 'Test',
        documentPath: testDocPath,
      });

      const retrieved = store.getByPath(testDocPath);
      expect(retrieved).toBeDefined();
      expect(retrieved?.documentPath).toBe(testDocPath);
    });

    it('should return undefined for non-existent path', () => {
      const result = store.getByPath('/non/existent/path');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all documents', () => {
      store.add({ name: 'Doc 1', documentPath: testDocPath });

      const doc2Path = join(testDir, 'doc2.md');
      writeFileSync(doc2Path, 'Doc 2 content');
      store.add({ name: 'Doc 2', documentPath: doc2Path });

      const docs = store.list();
      expect(docs).toHaveLength(2);
    });

    it('should return empty array when no documents', () => {
      const docs = store.list();
      expect(docs).toEqual([]);
    });
  });

  describe('updateHash', () => {
    it('should update document hash', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        documentHash: 'old-hash',
      });

      const success = store.updateHash(doc.docId, 'new-hash');
      expect(success).toBe(true);

      const updated = store.get(doc.docId);
      expect(updated?.documentHash).toBe('new-hash');
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should return false for non-existent document', () => {
      const success = store.updateHash('non-existent', 'hash');
      expect(success).toBe(false);
    });
  });

  describe('updateMemory', () => {
    it('should merge memory with existing', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        memory: {
          conversationSummary: 'Original summary',
          facts: ['fact1'],
        },
      });

      const success = store.updateMemory(doc.docId, {
        facts: ['fact2', 'fact3'],
      });
      expect(success).toBe(true);

      const updated = store.get(doc.docId);
      expect(updated?.memory?.conversationSummary).toBe('Original summary');
      expect(updated?.memory?.facts).toEqual(['fact2', 'fact3']);
    });

    it('should return false for non-existent document', () => {
      const success = store.updateMemory('non-existent', { facts: [] });
      expect(success).toBe(false);
    });
  });

  describe('setMemory', () => {
    it('should replace memory entirely', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        memory: { conversationSummary: 'Old' },
      });

      store.setMemory(doc.docId, { conversationSummary: 'New' });

      const updated = store.get(doc.docId);
      expect(updated?.memory?.conversationSummary).toBe('New');
    });

    it('should clear memory when set to null', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
        memory: { conversationSummary: 'Has memory' },
      });

      store.setMemory(doc.docId, null);

      const updated = store.get(doc.docId);
      expect(updated?.memory).toBeUndefined();
    });
  });

  describe('updateConfig', () => {
    it('should update document config', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
      });

      const success = store.updateConfig(doc.docId, {
        schemaVersion: 2,
        description: 'Updated',
      });
      expect(success).toBe(true);

      const updated = store.get(doc.docId);
      expect(updated?.config?.schemaVersion).toBe(2);
    });
  });

  describe('remove', () => {
    it('should remove document', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
      });

      const success = store.remove(doc.docId);
      expect(success).toBe(true);

      const retrieved = store.get(doc.docId);
      expect(retrieved).toBeUndefined();
    });

    it('should return false for non-existent document', () => {
      const success = store.remove('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing document', () => {
      const doc = store.add({
        name: 'Test',
        documentPath: testDocPath,
      });

      expect(store.exists(doc.docId)).toBe(true);
    });

    it('should return false for non-existent document', () => {
      expect(store.exists('non-existent')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return document count', () => {
      expect(store.count()).toBe(0);

      store.add({ name: 'Doc 1', documentPath: testDocPath });
      expect(store.count()).toBe(1);

      const doc2Path = join(testDir, 'doc2.md');
      writeFileSync(doc2Path, 'Doc 2');
      store.add({ name: 'Doc 2', documentPath: doc2Path });
      expect(store.count()).toBe(2);
    });
  });
});
