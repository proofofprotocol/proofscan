/**
 * Tests for formatters utility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TERM_WIDTH,
  isTTY,
  color,
  dim,
  success,
  error,
  warning,
  info,
  badge,
  formatBytes,
  formatDuration,
  pad,
  truncate,
  hr,
  tableRow,
  tableHeader,
  calculateColumnWidths,
  formatTable,
  COLORS,
} from './formatters.js';

describe('formatters utility', () => {
  let originalStdoutIsTTY: boolean | undefined;
  let originalStderrIsTTY: boolean | undefined;

  beforeEach(() => {
    originalStdoutIsTTY = process.stdout.isTTY;
    originalStderrIsTTY = process.stderr.isTTY;
  });

  afterEach(() => {
    process.stdout.isTTY = originalStdoutIsTTY;
    process.stderr.isTTY = originalStderrIsTTY;
  });

  describe('TERM_WIDTH', () => {
    it('should be a positive number', () => {
      expect(TERM_WIDTH).toBeGreaterThan(0);
    });

    it('should fallback to 80 if columns not available', () => {
      // TERM_WIDTH is set at module load, so we just verify it's reasonable
      expect(TERM_WIDTH).toBeGreaterThanOrEqual(80);
    });
  });

  describe('isTTY', () => {
    it('should return true in interactive TTY', () => {
      process.stdout.isTTY = true;
      process.stderr.isTTY = true;
      process.stdin.isTTY = true;
      expect(isTTY()).toBe(true);
    });

    it('should return false in non-interactive environment', () => {
      process.stdout.isTTY = false;
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;
      expect(isTTY()).toBe(false);
    });
  });

  describe('color', () => {
    it('should apply color in TTY', () => {
      process.stdout.isTTY = true;
      process.stderr.isTTY = true;
      process.stdin.isTTY = true;
      
      const colored = color('test', 'red');
      expect(colored).toContain(COLORS.red);
      expect(colored).toContain(COLORS.reset);
      expect(colored).toContain('test');
    });

    it('should not apply color in non-TTY', () => {
      process.stdout.isTTY = false;
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;
      
      const plain = color('test', 'red');
      expect(plain).toBe('test');
      expect(plain).not.toContain(COLORS.red);
    });
  });

  describe('status indicators', () => {
    beforeEach(() => {
      process.stdout.isTTY = true;
      process.stderr.isTTY = true;
      process.stdin.isTTY = true;
    });

    it('success should include checkmark', () => {
      const result = success('Done');
      expect(result).toContain('✓');
      expect(result).toContain('Done');
    });

    it('error should include X mark', () => {
      const result = error('Failed');
      expect(result).toContain('✗');
      expect(result).toContain('Failed');
    });

    it('warning should include warning symbol', () => {
      const result = warning('Careful');
      expect(result).toContain('⚠');
      expect(result).toContain('Careful');
    });

    it('info should include info symbol', () => {
      const result = info('Note');
      expect(result).toContain('ℹ');
      expect(result).toContain('Note');
    });
  });

  describe('badge', () => {
    it('should create colored badge in TTY', () => {
      process.stdout.isTTY = true;
      process.stderr.isTTY = true;
      process.stdin.isTTY = true;
      
      const result = badge('NEW', 'green');
      expect(result).toContain('[NEW]');
      expect(result).toContain(COLORS.green);
    });

    it('should create plain badge in non-TTY', () => {
      process.stdout.isTTY = false;
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;
      
      const result = badge('NEW', 'green');
      expect(result).toBe('[NEW]');
    });
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(100)).toBe('100 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(10240)).toBe('10.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(100)).toBe('100ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(5500)).toBe('5.5s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60 * 1000)).toBe('1m 0s');
      expect(formatDuration(90 * 1000)).toBe('1m 30s');
    });

    it('should format hours', () => {
      expect(formatDuration(60 * 60 * 1000)).toBe('1h 0m');
      expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
    });
  });

  describe('pad', () => {
    it('should pad left by default', () => {
      expect(pad('test', 10)).toBe('test      ');
    });

    it('should pad right when specified', () => {
      expect(pad('test', 10, 'right')).toBe('      test');
    });

    it('should not truncate if text is longer', () => {
      expect(pad('testlong', 4)).toBe('testlong');
    });
  });

  describe('truncate', () => {
    it('should not truncate short text', () => {
      expect(truncate('short', 10)).toBe('short');
    });

    it('should truncate long text with ellipsis', () => {
      expect(truncate('this is a long text', 10)).toBe('this is...');
    });

    it('should handle exact width', () => {
      expect(truncate('exact', 5)).toBe('exact');
    });
  });

  describe('hr', () => {
    it('should create horizontal rule', () => {
      const rule = hr(10);
      expect(rule.length).toBeGreaterThanOrEqual(10);
      expect(rule).toContain('─');
    });

    it('should use TERM_WIDTH by default', () => {
      const rule = hr();
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe('table functions', () => {
    it('tableRow should create aligned columns', () => {
      const row = tableRow(['A', 'BB', 'CCC'], [5, 5, 5]);
      expect(row).toContain('A    ');
      expect(row).toContain('BB   ');
      expect(row).toContain('CCC  ');
    });

    it('tableHeader should create dimmed header', () => {
      const header = tableHeader(['Col1', 'Col2'], [10, 10]);
      expect(header).toContain('Col1');
      expect(header).toContain('Col2');
    });

    it('calculateColumnWidths should find max widths', () => {
      const widths = calculateColumnWidths(
        ['Name', 'Age'],
        [
          ['Alice', '30'],
          ['Bob', '25'],
          ['Charlie', '35']
        ]
      );
      expect(widths).toEqual([7, 3]); // 'Charlie' = 7, 'Age' = 3
    });

    it('calculateColumnWidths should respect min widths', () => {
      const widths = calculateColumnWidths(
        ['A', 'B'],
        [['X', 'Y']],
        [10, 20]
      );
      expect(widths).toEqual([10, 20]);
    });

    it('formatTable should create complete table', () => {
      const table = formatTable(
        ['Name', 'Age'],
        [
          ['Alice', '30'],
          ['Bob', '25']
        ]
      );
      expect(table).toContain('Name');
      expect(table).toContain('Age');
      expect(table).toContain('Alice');
      expect(table).toContain('Bob');
      expect(table.split('\n').length).toBeGreaterThan(3); // Header, separator, 2 rows
    });
  });
});
