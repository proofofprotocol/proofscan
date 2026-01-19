/**
 * Filter Field Definitions Tests
 */

import { describe, it, expect } from 'vitest';
import { FILTER_FIELDS, VALID_FIELDS, suggestFields, isValidField } from './fields.js';

describe('FILTER_FIELDS', () => {
  it('has expected number of fields', () => {
    expect(FILTER_FIELDS.length).toBe(11);
  });

  it('includes all expected fields', () => {
    const fieldNames = FILTER_FIELDS.map((f) => f.name);
    expect(fieldNames).toContain('session.id');
    expect(fieldNames).toContain('session.latency');
    expect(fieldNames).toContain('rpc.id');
    expect(fieldNames).toContain('rpc.method');
    expect(fieldNames).toContain('rpc.status');
    expect(fieldNames).toContain('rpc.latency');
    expect(fieldNames).toContain('tools.method');
    expect(fieldNames).toContain('tools.name');
    expect(fieldNames).toContain('event.kind');
    expect(fieldNames).toContain('event.type');
    expect(fieldNames).toContain('direction');
  });

  it('all fields have description', () => {
    FILTER_FIELDS.forEach((field) => {
      expect(field.description).toBeTruthy();
      expect(typeof field.description).toBe('string');
    });
  });

  it('all fields have valid type', () => {
    FILTER_FIELDS.forEach((field) => {
      expect(['string', 'number']).toContain(field.type);
    });
  });

  it('latency fields are typed as number', () => {
    const latencyFields = FILTER_FIELDS.filter((f) => f.name.includes('latency'));
    latencyFields.forEach((field) => {
      expect(field.type).toBe('number');
    });
  });
});

describe('VALID_FIELDS', () => {
  it('is a Set', () => {
    expect(VALID_FIELDS).toBeInstanceOf(Set);
  });

  it('has same size as FILTER_FIELDS', () => {
    expect(VALID_FIELDS.size).toBe(FILTER_FIELDS.length);
  });

  it('contains all field names', () => {
    FILTER_FIELDS.forEach((field) => {
      expect(VALID_FIELDS.has(field.name)).toBe(true);
    });
  });
});

describe('isValidField', () => {
  it('returns true for valid fields', () => {
    expect(isValidField('rpc.method')).toBe(true);
    expect(isValidField('session.latency')).toBe(true);
    expect(isValidField('tools.name')).toBe(true);
    expect(isValidField('direction')).toBe(true);
  });

  it('returns false for invalid fields', () => {
    expect(isValidField('invalid')).toBe(false);
    expect(isValidField('rpc.invalid')).toBe(false);
    expect(isValidField('unknown.field')).toBe(false);
    expect(isValidField('')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isValidField('RPC.METHOD')).toBe(false);
    expect(isValidField('Rpc.Method')).toBe(false);
  });
});

describe('suggestFields', () => {
  it('returns all fields for empty prefix', () => {
    const suggestions = suggestFields('');
    // Empty prefix matches all fields (all start with empty string)
    expect(suggestions.length).toBe(11);
  });

  it('returns matching fields for prefix', () => {
    const suggestions = suggestFields('rpc');
    expect(suggestions.length).toBe(4);
    suggestions.forEach((s) => {
      expect(s.name.startsWith('rpc')).toBe(true);
    });
  });

  it('returns matching fields for partial prefix', () => {
    const suggestions = suggestFields('session');
    expect(suggestions.length).toBe(2);
    expect(suggestions.map((s) => s.name)).toContain('session.id');
    expect(suggestions.map((s) => s.name)).toContain('session.latency');
  });

  it('returns matching fields for dotted prefix', () => {
    const suggestions = suggestFields('rpc.m');
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].name).toBe('rpc.method');
  });

  it('is case-insensitive', () => {
    const suggestionsLower = suggestFields('rpc');
    const suggestionsUpper = suggestFields('RPC');
    const suggestionsMixed = suggestFields('Rpc');

    expect(suggestionsLower.length).toBe(4);
    expect(suggestionsUpper.length).toBe(4);
    expect(suggestionsMixed.length).toBe(4);
  });

  it('returns empty for non-matching prefix', () => {
    const suggestions = suggestFields('xyz');
    expect(suggestions.length).toBe(0);
  });

  it('returns fields starting with single char', () => {
    const suggestions = suggestFields('d');
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].name).toBe('direction');
  });
});
