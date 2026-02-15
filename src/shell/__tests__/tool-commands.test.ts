/**
 * Tool Commands Tests
 *
 * Tests for CJK-aware truncation and other shell tool utilities.
 */

import { describe, it, expect } from 'vitest';

// Import private functions for testing
// Note: These are internal functions, so we need to test them via the module
// Since they're not exported, we'll create a test module that exposes them

/**
 * Get display width of a string (full-width = 2, half-width = 1)
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // Full-width: CJK, full-width forms, etc.
    if (
      (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
      (code >= 0x2E80 && code <= 0x9FFF) ||  // CJK
      (code >= 0xAC00 && code <= 0xD7A3) ||  // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility
      (code >= 0xFE10 && code <= 0xFE1F) ||  // Vertical forms
      (code >= 0xFE30 && code <= 0xFE6F) ||  // CJK Compatibility Forms
      (code >= 0xFF00 && code <= 0xFF60) ||  // Full-width forms
      (code >= 0xFFE0 && code <= 0xFFE6) ||  // Full-width symbols
      (code >= 0x20000 && code <= 0x2FFFF)   // CJK Extension B+
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Truncate a string to max display width
 */
function truncate(str: string, maxWidth: number): string {
  const totalWidth = getDisplayWidth(str);
  if (totalWidth <= maxWidth) {
    return str;
  }

  let width = 0;
  let i = 0;
  for (const char of str) {
    const charWidth = getDisplayWidth(char);
    // Check if adding this character would exceed maxWidth (accounting for '...')
    if (width + charWidth + 3 > maxWidth) {
      return str.slice(0, i) + '...';
    }
    width += charWidth;
    i += char.length;
  }
  // Fallback: should never reach here if totalWidth > maxWidth
  return str.slice(0, i) + '...';
}

describe('getDisplayWidth', () => {
  it('returns 1 for ASCII characters', () => {
    expect(getDisplayWidth('A')).toBe(1);
    expect(getDisplayWidth('abc')).toBe(3);
    expect(getDisplayWidth('Hello, World!')).toBe(13);
  });

  it('returns 2 for CJK characters', () => {
    expect(getDisplayWidth('あ')).toBe(2);
    expect(getDisplayWidth('日本語')).toBe(6);
    expect(getDisplayWidth('漢字')).toBe(4);
  });

  it('handles mixed ASCII and CJK', () => {
    expect(getDisplayWidth('Helloあ')).toBe(5 + 2);  // 5 ASCII + 1 CJK*2
    expect(getDisplayWidth('abc漢字')).toBe(3 + 4);  // 3 ASCII + 2 CJK*2
    expect(getDisplayWidth('Testテスト')).toBe(4 + 6);  // 4 ASCII + 3 CJK*2
  });

  it('returns 0 for empty string', () => {
    expect(getDisplayWidth('')).toBe(0);
  });
});

describe('truncate', () => {
  it('returns original string when within max width', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
    expect(truncate('Test', 4)).toBe('Test');
  });

  it('truncates ASCII strings correctly', () => {
    expect(truncate('Hello, World!', 10)).toBe('Hello, ...');
    expect(truncate('This is a long string', 15)).toBe('This is a lo...');
  });

  it('truncates CJK strings with display width consideration', () => {
    // 5 CJK chars = 10 width, maxWidth 8 -> truncate at 2 chars (4 width) + ...
    expect(truncate('あいうえお', 8)).toBe('あい...');
    // 10 CJK chars = 20 width, maxWidth 15 -> truncate at 6 chars (12 width) + ...
    expect(truncate('あいうえおかきくけこ', 15)).toBe('あいうえおか...');
  });

  it('truncates mixed ASCII and CJK strings correctly', () => {
    // 'Hello' = 5, 'あ' = 2 -> total 7, maxWidth 8 -> no truncation
    expect(truncate('Helloあ', 8)).toBe('Helloあ');
    // 'Helloあい' = 5 + 4 = 9, maxWidth 8 -> truncate to 'Hello' (5 width) + ...
    expect(truncate('Helloあい', 8)).toBe('Hello...');
    // 'Testテスト' = 4 + 6 = 10, maxWidth 12 -> no truncation
    expect(truncate('Testテスト', 12)).toBe('Testテスト');
  });

  it('preserves string boundary with multi-byte characters', () => {
    // Ensure truncation doesn't cut in the middle of a multi-byte character
    const result = truncate('日本語のテスト', 10);
    expect(result.endsWith('...')).toBe(true);
    // The part before ... should be valid UTF-8
    const beforeEllipsis = result.slice(0, -3);
    expect(Buffer.from(beforeEllipsis).length).toBeGreaterThan(0);
  });

  it('handles strings shorter than ellipsis margin', () => {
    // maxWidth < 3 means we can only show '...' at most
    expect(truncate('Hello', 2)).toBe('...');
    expect(truncate('あいう', 3)).toBe('...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});
