/**
 * Filter DSL Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { parseFilter } from './parser.js';

describe('parseFilter', () => {
  describe('empty input', () => {
    it('returns empty conditions for empty string', () => {
      const result = parseFilter('');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(0);
      }
    });

    it('returns empty conditions for whitespace only', () => {
      const result = parseFilter('   ');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(0);
      }
    });

    it('strips filter: prefix', () => {
      const result = parseFilter('filter: rpc.method == "test"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(1);
        expect(result.ast.conditions[0].field).toBe('rpc.method');
      }
    });
  });

  describe('simple expressions', () => {
    it('parses equality with quoted string', () => {
      const result = parseFilter('rpc.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(1);
        expect(result.ast.conditions[0]).toEqual({
          field: 'rpc.method',
          operator: '==',
          value: 'tools/call',
        });
      }
    });

    it('parses inequality', () => {
      const result = parseFilter('rpc.status != ok');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].operator).toBe('!=');
        expect(result.ast.conditions[0].value).toBe('ok');
      }
    });

    it('parses substring match', () => {
      const result = parseFilter('tools.name ~= read');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].operator).toBe('~=');
      }
    });

    it('parses greater than with number', () => {
      const result = parseFilter('rpc.latency > 1000');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0]).toEqual({
          field: 'rpc.latency',
          operator: '>',
          value: 1000,
        });
      }
    });

    it('parses less than with decimal', () => {
      const result = parseFilter('session.latency < 500.5');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe(500.5);
      }
    });

    it('parses negative numbers', () => {
      const result = parseFilter('rpc.latency > -100');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe(-100);
      }
    });
  });

  describe('multiple conditions', () => {
    it('parses multiple conditions (implicit AND)', () => {
      const result = parseFilter('rpc.method == "tools/call" rpc.status == ok');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(2);
        expect(result.ast.conditions[0].field).toBe('rpc.method');
        expect(result.ast.conditions[1].field).toBe('rpc.status');
      }
    });

    it('handles extra whitespace', () => {
      const result = parseFilter('  rpc.method   ==   "test"   rpc.status  ==  ok  ');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(2);
      }
    });

    it('handles no space around operators', () => {
      const result = parseFilter('rpc.latency>1000 session.latency<5000');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions).toHaveLength(2);
        expect(result.ast.conditions[0].value).toBe(1000);
        expect(result.ast.conditions[1].value).toBe(5000);
      }
    });
  });

  describe('string literals', () => {
    it('parses double-quoted strings', () => {
      const result = parseFilter('rpc.method == "tools/call"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('tools/call');
      }
    });

    it('parses single-quoted strings', () => {
      const result = parseFilter("rpc.method == 'tools/call'");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('tools/call');
      }
    });

    it('handles escaped quotes', () => {
      const result = parseFilter('rpc.method == "test\\"value"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('test"value');
      }
    });

    it('handles escaped backslash', () => {
      const result = parseFilter('rpc.method == "test\\\\value"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('test\\value');
      }
    });

    it('handles empty string', () => {
      const result = parseFilter('rpc.method == ""');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('');
      }
    });
  });

  describe('unquoted values', () => {
    it('parses unquoted alphanumeric values', () => {
      const result = parseFilter('rpc.status == ok');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('ok');
      }
    });

    it('allows slashes in unquoted values', () => {
      const result = parseFilter('rpc.method == tools/call');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('tools/call');
      }
    });

    it('allows hyphens in unquoted values', () => {
      const result = parseFilter('tools.name == my-tool');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ast.conditions[0].value).toBe('my-tool');
      }
    });
  });

  describe('all supported fields', () => {
    const validFields = [
      'session.id',
      'session.latency',
      'rpc.id',
      'rpc.method',
      'rpc.status',
      'rpc.latency',
      'tools.method',
      'tools.name',
      'event.kind',
      'event.type',
      'direction',
    ];

    it.each(validFields)('accepts field: %s', (field) => {
      const result = parseFilter(`${field} == test`);
      expect(result.ok).toBe(true);
    });
  });

  describe('error cases', () => {
    it('reports unknown field', () => {
      const result = parseFilter('unknown.field == test');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unknown field 'unknown.field'");
        expect(result.position).toBe(0);
      }
    });

    it('reports missing operator', () => {
      const result = parseFilter('rpc.method "test"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Expected operator');
      }
    });

    it('reports invalid operator', () => {
      const result = parseFilter('rpc.method === test');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Parser sees '==' as operator, then '=' as unexpected
        expect(result.error).toContain('Unexpected character');
      }
    });

    it('reports missing value', () => {
      const result = parseFilter('rpc.method ==');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Expected value');
      }
    });

    it('reports unterminated string', () => {
      const result = parseFilter('rpc.method == "unterminated');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unterminated string');
      }
    });

    it('reports invalid number', () => {
      const result = parseFilter('rpc.latency > -');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Expected number');
      }
    });

    it('reports unexpected character', () => {
      const result = parseFilter('rpc.method == @invalid');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unexpected character '@'");
      }
    });
  });
});
