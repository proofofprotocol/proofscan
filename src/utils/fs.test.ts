import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { atomicWriteFile, readFileSafe, fileExists, appendLine, readLastLines } from './fs.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

describe('fs utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `proofscan-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('atomicWriteFile', () => {
    it('should write file atomically', async () => {
      const filePath = join(testDir, 'test.json');
      const content = JSON.stringify({ test: true });

      await atomicWriteFile(filePath, content);

      const read = await fs.readFile(filePath, 'utf-8');
      expect(read).toBe(content);
    });

    it('should create parent directories', async () => {
      const filePath = join(testDir, 'nested', 'deep', 'test.json');
      const content = 'test content';

      await atomicWriteFile(filePath, content);

      const read = await fs.readFile(filePath, 'utf-8');
      expect(read).toBe(content);
    });

    it('should overwrite existing file', async () => {
      const filePath = join(testDir, 'existing.json');
      await fs.writeFile(filePath, 'old content');

      await atomicWriteFile(filePath, 'new content');

      const read = await fs.readFile(filePath, 'utf-8');
      expect(read).toBe('new content');
    });
  });

  describe('readFileSafe', () => {
    it('should return file content', async () => {
      const filePath = join(testDir, 'readable.txt');
      await fs.writeFile(filePath, 'hello');

      const content = await readFileSafe(filePath);
      expect(content).toBe('hello');
    });

    it('should return null for non-existent file', async () => {
      const filePath = join(testDir, 'nonexistent.txt');
      const content = await readFileSafe(filePath);
      expect(content).toBeNull();
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content');

      const exists = await fileExists(filePath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const filePath = join(testDir, 'not-exists.txt');
      const exists = await fileExists(filePath);
      expect(exists).toBe(false);
    });
  });

  describe('appendLine', () => {
    it('should append line to file', async () => {
      const filePath = join(testDir, 'lines.txt');

      await appendLine(filePath, 'line1');
      await appendLine(filePath, 'line2');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nline2\n');
    });

    it('should create file if not exists', async () => {
      const filePath = join(testDir, 'new-lines.txt');

      await appendLine(filePath, 'first line');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('first line\n');
    });
  });

  describe('readLastLines', () => {
    it('should read last N lines', async () => {
      const filePath = join(testDir, 'multiline.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5\n');

      const lines = await readLastLines(filePath, 3);
      expect(lines).toEqual(['line3', 'line4', 'line5']);
    });

    it('should return all lines if N > total', async () => {
      const filePath = join(testDir, 'short.txt');
      await fs.writeFile(filePath, 'a\nb\n');

      const lines = await readLastLines(filePath, 10);
      expect(lines).toEqual(['a', 'b']);
    });

    it('should return empty array for non-existent file', async () => {
      const filePath = join(testDir, 'nope.txt');
      const lines = await readLastLines(filePath, 5);
      expect(lines).toEqual([]);
    });
  });
});
