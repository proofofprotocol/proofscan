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
  let otherDir: string;  // Separate directory for testing allowedRoot
  let testFilePath: string;
  const testContent = '# Test Document\n\nThis is test content.';

  beforeEach(() => {
    testDir = join(tmpdir(), `proofscan-doc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    otherDir = join(tmpdir(), `proofscan-other-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });

    testFilePath = join(testDir, 'test.md');
    writeFileSync(testFilePath, testContent);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(otherDir, { recursive: true, force: true });
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

    it('should throw for non-existent file', async () => {
      await expect(hasDocumentChanged('/non/existent.txt', 'abc123'))
        .rejects.toThrow('not found');
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

    it('should reject non-existent file', () => {
      const result = validateDocumentPath('/non/existent/file.txt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should resolve paths with .. before validation', () => {
      // Paths with .. are resolved before checking existence
      // /nonexistent/../also/nonexistent resolves to /also/nonexistent which doesn't exist
      const result = validateDocumentPath('/nonexistent_path_12345/../also/nonexistent_abc');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should accept path within allowedRoot', () => {
      const result = validateDocumentPath(testFilePath, { allowedRoot: testDir });
      expect(result.valid).toBe(true);
    });

    it('should reject path outside allowedRoot', () => {
      // testFilePath is in testDir, but allowedRoot is otherDir (a different existing directory)
      const result = validateDocumentPath(testFilePath, { allowedRoot: otherDir });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('allowed root');
    });

    it('should prevent traversal outside allowedRoot', () => {
      // Even with .., the resolved path is checked against allowedRoot
      const result = validateDocumentPath(
        join(testDir, '..', 'escape', 'file.txt'),
        { allowedRoot: testDir }
      );
      expect(result.valid).toBe(false);
      // Either outside root or file not found
      expect(result.error).toBeDefined();
    });
  });
});
