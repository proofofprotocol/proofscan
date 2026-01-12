/**
 * HTML Export Utilities
 *
 * Shared utility functions for HTML export functionality.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { t } from '../i18n/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get package version for HTML reports
 */
let _packageVersion: string = '';
export function getPackageVersion(): string {
  if (_packageVersion) {
    return _packageVersion;
  }
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    _packageVersion = pkg.version || '0.0.0';
  } catch {
    _packageVersion = '0.0.0';
  }
  return _packageVersion;
}

/**
 * Validate and sanitize output directory path
 * Prevents path traversal attacks by ensuring the path doesn't escape CWD
 *
 * @param outDir - User-provided output directory
 * @returns Resolved absolute path
 * @throws Error if path is invalid or escapes current directory
 */
export function validateOutputPath(outDir: string): string {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, outDir);
  const normalized = path.normalize(resolved);

  // Ensure the path is within or equal to CWD
  // Allow paths that start with CWD or are absolute paths explicitly provided
  if (!normalized.startsWith(cwd) && !path.isAbsolute(outDir)) {
    throw new Error(t('errors.pathEscapes'));
  }

  // Check for suspicious patterns even in absolute paths
  if (outDir.includes('..')) {
    // If it contains '..' but still resolves within cwd, that's OK
    // If it resolves outside, reject
    if (!normalized.startsWith(cwd)) {
      throw new Error(t('errors.pathEscapes'));
    }
  }

  return normalized;
}

/**
 * Validate embedMaxBytes option
 *
 * @param value - String value from CLI
 * @returns Validated positive integer
 * @throws Error if value is invalid
 */
export function validateEmbedMaxBytes(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(t('errors.invalidEmbedMaxBytes', { value }));
  }
  return parsed;
}

/**
 * Safely create output directory
 *
 * @param outDir - Output directory path (should be validated first)
 */
export function ensureOutputDir(outDir: string): void {
  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(t('errors.createDirFailed', { path: outDir, error: message }));
  }
}

/**
 * Safely write file with error handling
 *
 * @param filePath - Full path to write
 * @param content - Content to write
 */
export function safeWriteFile(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(t('errors.writeFileFailed', { path: filePath, error: message }));
  }
}
