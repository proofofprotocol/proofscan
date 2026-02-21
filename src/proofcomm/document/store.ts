/**
 * ProofComm Document Store
 * Phase 9.0: File reading and hashing for resident documents
 *
 * This module handles:
 * - Reading document content from filesystem
 * - Computing content hashes (SHA-256)
 * - Detecting file changes
 * - MIME type detection
 */

import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, extname } from 'path';
import type { DocumentContent } from './types.js';

/**
 * MIME type mapping for common extensions
 */
const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.log': 'text/plain',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.toml': 'application/toml',
};

/**
 * Error thrown when document file operations fail
 */
export class DocumentStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'FILE_NOT_FOUND' | 'READ_ERROR' | 'INVALID_PATH' | 'TOO_LARGE'
  ) {
    super(message);
    this.name = 'DocumentStoreError';
  }
}

/**
 * Options for reading documents
 */
export interface ReadDocumentOptions {
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number;
  /** Encoding (default: utf-8) */
  encoding?: BufferEncoding;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';

/**
 * Compute SHA-256 hash of content
 */
export function computeHash(content: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Detect MIME type from file extension
 */
export function detectMimeType(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext];
}

/**
 * Check if file exists
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Read document content from filesystem
 */
export async function readDocument(
  filePath: string,
  options?: ReadDocumentOptions
): Promise<DocumentContent> {
  const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
  const encoding = options?.encoding ?? DEFAULT_ENCODING;

  // Check if file exists
  if (!fileExists(filePath)) {
    throw new DocumentStoreError(
      `Document file not found: ${filePath}`,
      'FILE_NOT_FOUND'
    );
  }

  // Get file stats
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    throw new DocumentStoreError(
      `Failed to stat document file: ${err instanceof Error ? err.message : String(err)}`,
      'READ_ERROR'
    );
  }

  // Check file size
  if (fileStat.size > maxSize) {
    throw new DocumentStoreError(
      `Document file too large: ${fileStat.size} bytes (max: ${maxSize})`,
      'TOO_LARGE'
    );
  }

  // Read file content
  let content: string;
  try {
    content = await readFile(filePath, { encoding });
  } catch (err) {
    throw new DocumentStoreError(
      `Failed to read document file: ${err instanceof Error ? err.message : String(err)}`,
      'READ_ERROR'
    );
  }

  // Compute hash
  const hash = computeHash(content);

  // Detect MIME type
  const mimeType = detectMimeType(filePath);

  return {
    text: content,
    hash,
    size: fileStat.size,
    mimeType,
    modifiedAt: fileStat.mtime.toISOString(),
  };
}

/**
 * Check if document has changed (compare hash)
 */
export async function hasDocumentChanged(
  filePath: string,
  previousHash: string
): Promise<boolean> {
  try {
    const content = await readDocument(filePath);
    return content.hash !== previousHash;
  } catch {
    // If we can't read the file, consider it changed
    return true;
  }
}

/**
 * Get document filename from path
 */
export function getDocumentName(filePath: string): string {
  return basename(filePath);
}

/**
 * Validate document path
 */
export function validateDocumentPath(filePath: string): { valid: boolean; error?: string } {
  // Check for empty path
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, error: 'Document path cannot be empty' };
  }

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    return { valid: false, error: 'Document path cannot contain ".."' };
  }

  // Check if file exists
  if (!fileExists(filePath)) {
    return { valid: false, error: `Document file not found: ${filePath}` };
  }

  return { valid: true };
}
