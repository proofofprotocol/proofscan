/**
 * Tests for secret types utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parseSecretRef,
  makeSecretRef,
  isSecretRef,
} from './types.js';

describe('parseSecretRef', () => {
  it('should parse dpapi references', () => {
    const result = parseSecretRef('dpapi:abc123');
    expect(result).toEqual({ provider: 'dpapi', id: 'abc123' });
  });

  it('should parse keychain references', () => {
    const result = parseSecretRef('keychain:xyz-789');
    expect(result).toEqual({ provider: 'keychain', id: 'xyz-789' });
  });

  it('should handle UUIDs', () => {
    const result = parseSecretRef('dpapi:550e8400-e29b-41d4-a716-446655440000');
    expect(result?.provider).toBe('dpapi');
    expect(result?.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should return null for invalid references', () => {
    expect(parseSecretRef('invalid')).toBeNull();
    expect(parseSecretRef('dpapi:')).toBeNull();
    expect(parseSecretRef(':abc')).toBeNull();
    expect(parseSecretRef('')).toBeNull();
    expect(parseSecretRef('plain:abc')).toBeNull();
  });

  it('should return null for unknown providers', () => {
    expect(parseSecretRef('unknown:abc')).toBeNull();
    expect(parseSecretRef('aws:abc')).toBeNull();
  });
});

describe('makeSecretRef', () => {
  it('should create dpapi reference', () => {
    expect(makeSecretRef('dpapi', 'abc123')).toBe('dpapi:abc123');
  });

  it('should create keychain reference', () => {
    expect(makeSecretRef('keychain', 'xyz')).toBe('keychain:xyz');
  });

  it('should create plain reference', () => {
    expect(makeSecretRef('plain', 'test')).toBe('plain:test');
  });
});

describe('isSecretRef', () => {
  it('should detect dpapi references', () => {
    expect(isSecretRef('dpapi:abc123')).toBe(true);
    expect(isSecretRef('dpapi:uuid-here')).toBe(true);
  });

  it('should detect keychain references', () => {
    expect(isSecretRef('keychain:abc')).toBe(true);
  });

  it('should not detect invalid references', () => {
    expect(isSecretRef('plain:abc')).toBe(false);
    expect(isSecretRef('not-a-ref')).toBe(false);
    expect(isSecretRef('dpapi')).toBe(false);
    expect(isSecretRef('')).toBe(false);
    expect(isSecretRef('dpapi:')).toBe(false);
  });
});
