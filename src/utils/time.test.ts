/**
 * Time utility tests
 */

import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './time.js';

describe('formatRelativeTime', () => {
  it('should return "just now" for current time', () => {
    expect(formatRelativeTime(new Date())).toBe('just now');
  });

  it('should return "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 5000);
    expect(formatRelativeTime(future)).toBe('just now');
  });

  it('should format seconds as "just now"', () => {
    const past = new Date(Date.now() - 30 * 1000);
    expect(formatRelativeTime(past)).toBe('just now');
  });

  it('should format minutes correctly', () => {
    const past = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(past)).toBe('5m ago');
  });

  it('should format hours correctly', () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(past)).toBe('3h ago');
  });

  it('should format days correctly', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(past)).toBe('2d ago');
  });

  it('should accept ISO timestamp strings', () => {
    const isoString = new Date(Date.now() - 60000).toISOString();
    expect(formatRelativeTime(isoString)).toBe('1m ago');
  });

  it('should handle exactly 1 minute', () => {
    const past = new Date(Date.now() - 60 * 1000);
    expect(formatRelativeTime(past)).toBe('1m ago');
  });

  it('should handle exactly 1 hour', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatRelativeTime(past)).toBe('1h ago');
  });

  it('should handle exactly 1 day', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(past)).toBe('1d ago');
  });
});
