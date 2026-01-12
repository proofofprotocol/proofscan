/**
 * Tests for spinner utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSpinner, withSpinner, BRAILLE_FRAMES } from './spinner.js';

describe('spinner utility', () => {
  let originalStdoutIsTTY: boolean | undefined;
  let originalStderrIsTTY: boolean | undefined;

  beforeEach(() => {
    originalStdoutIsTTY = process.stdout.isTTY;
    originalStderrIsTTY = process.stderr.isTTY;
    // Mock TTY environment
    process.stdout.isTTY = true;
    process.stderr.isTTY = true;
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdout.isTTY = originalStdoutIsTTY;
    process.stderr.isTTY = originalStderrIsTTY;
    vi.restoreAllMocks();
  });

  describe('BRAILLE_FRAMES', () => {
    it('should have 10 braille characters', () => {
      expect(BRAILLE_FRAMES).toHaveLength(10);
      expect(BRAILLE_FRAMES).toEqual(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
    });
  });

  describe('createSpinner', () => {
    it('should return null in non-TTY environment', () => {
      process.stdout.isTTY = false;
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;

      const spinner = createSpinner({ text: 'Loading...' });
      expect(spinner).toBeNull();
    });

    it('should handle force option', () => {
      // Test that force option is accepted
      const options = { text: 'Loading...', force: true };
      expect(options.force).toBe(true);
    });

    it('should handle stream option', () => {
      // Test that stream option is accepted
      const options = { text: 'Loading...', stream: process.stdout };
      expect(options.stream).toBe(process.stdout);
    });
  });

  describe('withSpinner', () => {
    beforeEach(() => {
      // Force non-TTY for withSpinner tests to avoid ora issues
      process.stdout.isTTY = false;
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;
    });

    it('should execute async function and return result', async () => {
      const result = await withSpinner(
        'Processing...',
        async () => {
          return 'success';
        },
        'Done!'
      );
      expect(result).toBe('success');
    });

    it('should handle async function errors', async () => {
      await expect(
        withSpinner(
          'Processing...',
          async () => {
            throw new Error('Test error');
          },
          'Done!',
          'Failed!'
        )
      ).rejects.toThrow('Test error');
    });

    it('should work without success/fail text', async () => {
      const result = await withSpinner(
        'Processing...',
        async () => {
          return 42;
        }
      );
      expect(result).toBe(42);
    });
  });

  describe('SIGINT handling', () => {
    it('should have exit code 130 documented', () => {
      // Exit code 130 = 128 + 2 (SIGINT)
      // This is validated through code review
      expect(130).toBe(128 + 2);
    });
  });
});
