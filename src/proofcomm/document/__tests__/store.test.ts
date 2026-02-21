/**
 * Tests for ProofComm Document Store (file operations)
 * Phase 9.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeHash,
  detectMimeType,
  fileExists,
  readDocument,
  hasDocumentChanged,
  getDocumentName,
  validateDocumentPath,
  DocumentStoreError,
} from '../store.js';

describe('Document Store (file operations)', () => {
  let testDir: string;
  let testFilePath: string;
  const testContent = '# Test Document\n\nThis is test content.';

  beforeEach(() => {
    testDir = join(tmpdir(), `proofscan-doc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    testFilePath = join(testDir, 'test.md');
    writeFileSync(testFilePath, testContent);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('computeHash', () => {
    it('should compute consistent SHA-256 hash for string', () => {
      const hash1 = computeHash('hello world');
      const hash2 = computeHash('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it('should compute different hashes for different content', () => {
      const hash1 = computeHash('hello');
      const hash2 = computeHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should compute hash for Buffer', () => {
      const hash = computeHash(Buffer.from('test'));
      expect(hash).toHaveLength(64);
    });
  });

  describe('detectMimeType', () => {
    it('should detect markdown files', () => {
      expect(detectMimeType('file.md')).toBe('text/markdown');
      expect(detectMimeType('file.markdown')).toBe('text/markdown');
    });

    it('should detect text files', () => {
      expect(detectMimeType('file.txt')).toBe('text/plain');
    });

    it('should detect JSON files', () => {
      expect(detectMimeType('file.json')).toBe('application/json');
    });

    it('should detect code files', () => {
      expect(detectMimeType('file.js')).toBe('text/javascript');
      expect(detectMimeType('file.ts')).toBe('text/typescript');
      expect(detectMimeType('file.py')).toBe('text/x-python');
    });

    it('should return undefined for unknown extensions', () => {
      expect(detectMimeType('file.xyz')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(detectMimeType('file.MD')).toBe('text/markdown');
      expect(detectMimeType('file.JSON')).toBe('application/json');
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', () => {
      expect(fileExists(testFilePath)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(fileExists('/non/existent/file.txt')).toBe(false);
    });
  });

  describe('readDocument', () => {
    it('should read document content', async () => {
      const content = await readDocument(testFilePath);

      expect(content.text).toBe(testContent);
      expect(content.hash).toHaveLength(64);
      expect(content.size).toBeGreaterThan(0);
      expect(content.mimeType).toBe('text/markdown');
      expect(content.modifiedAt).toBeDefined();
    });

    it('should throw for non-existent file', async () => {
      await expect(readDocument('/non/existent/file.txt')).rejects.toThrow(DocumentStoreError);
      await expect(readDocument('/non/existent/file.txt')).rejects.toThrow('not found');
    });

    it('should throw for file too large', async () => {
      // Create a file slightly larger than default max (test with small max)
      const largePath = join(testDir, 'large.txt');
      writeFileSync(largePath, 'x'.repeat(200));

      await expect(readDocument(largePath, { maxSize: 100 })).rejects.toThrow(DocumentStoreError);
      await expect(readDocument(largePath, { maxSize: 100 })).rejects.toThrow('too large');
    });

    it('should use custom encoding', async () => {
      const content = await readDocument(testFilePath, { encoding: 'utf-8' });
      expect(content.text).toBe(testContent);
    });
  });

  describe('hasDocumentChanged', () => {
    it('should return false for unchanged file', async () => {
      const content = await readDocument(testFilePath);
      const changed = await hasDocumentChanged(testFilePath, content.hash);
      expect(changed).toBe(false);
    });

    it('should return true for changed file', async () => {
      const content = await readDocument(testFilePath);

      // Modify the file
      writeFileSync(testFilePath, 'Modified content');

      const changed = await hasDocumentChanged(testFilePath, content.hash);
      expect(changed).toBe(true);
    });

    it('should return true for non-existent file', async () => {
      const changed = await hasDocumentChanged('/non/existent.txt', 'abc123');
      expect(changed).toBe(true);
    });
  });

  describe('getDocumentName', () => {
    it('should extract filename from path', () => {
      expect(getDocumentName('/path/to/document.md')).toBe('document.md');
      expect(getDocumentName('file.txt')).toBe('file.txt');
      expect(getDocumentName('/a/b/c/test.json')).toBe('test.json');
    });
  });

  describe('validateDocumentPath', () => {
    it('should accept valid existing path', () => {
      const result = validateDocumentPath(testFilePath);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty path', () => {
      const result = validateDocumentPath('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject path with ..', () => {
      const result = validateDocumentPath('/path/../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('..');
    });

    it('should reject non-existent file', () => {
      const result = validateDocumentPath('/non/existent/file.txt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
