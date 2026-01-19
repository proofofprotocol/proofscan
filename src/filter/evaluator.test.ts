/**
 * Filter DSL Evaluator Tests
 */

import { describe, it, expect } from 'vitest';
import { evaluateFilter } from './evaluator.js';
import type { FilterAst, FilterContext } from './types.js';

// Helper to create AST
function ast(...conditions: FilterAst['conditions']): FilterAst {
  return { conditions };
}

describe('evaluateFilter', () => {
  describe('empty filter', () => {
    it('matches everything when no conditions', () => {
      const result = evaluateFilter(ast(), { 'rpc.method': 'test' });
      expect(result).toBe(true);
    });

    it('matches empty context', () => {
      const result = evaluateFilter(ast(), {});
      expect(result).toBe(true);
    });
  });

  describe('equality operator (==)', () => {
    it('matches exact string value', () => {
      const filter = ast({ field: 'rpc.method', operator: '==', value: 'tools/call' });
      expect(evaluateFilter(filter, { 'rpc.method': 'tools/call' })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.method': 'other' })).toBe(false);
    });

    it('is case-insensitive', () => {
      const filter = ast({ field: 'rpc.status', operator: '==', value: 'OK' });
      expect(evaluateFilter(filter, { 'rpc.status': 'ok' })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.status': 'Ok' })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.status': 'OK' })).toBe(true);
    });

    it('matches numbers', () => {
      const filter = ast({ field: 'rpc.latency', operator: '==', value: 100 });
      expect(evaluateFilter(filter, { 'rpc.latency': 100 })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.latency': 200 })).toBe(false);
    });

    it('compares numbers and strings correctly', () => {
      const filter = ast({ field: 'rpc.latency', operator: '==', value: '100' });
      expect(evaluateFilter(filter, { 'rpc.latency': 100 })).toBe(true);
    });
  });

  describe('inequality operator (!=)', () => {
    it('returns true when values differ', () => {
      const filter = ast({ field: 'rpc.status', operator: '!=', value: 'err' });
      expect(evaluateFilter(filter, { 'rpc.status': 'ok' })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.status': 'err' })).toBe(false);
    });

    it('is case-insensitive', () => {
      const filter = ast({ field: 'rpc.status', operator: '!=', value: 'ERR' });
      expect(evaluateFilter(filter, { 'rpc.status': 'err' })).toBe(false);
      expect(evaluateFilter(filter, { 'rpc.status': 'Err' })).toBe(false);
    });
  });

  describe('substring operator (~=)', () => {
    it('matches substring', () => {
      const filter = ast({ field: 'tools.name', operator: '~=', value: 'read' });
      expect(evaluateFilter(filter, { 'tools.name': 'read_file' })).toBe(true);
      expect(evaluateFilter(filter, { 'tools.name': 'file_reader' })).toBe(true);
      expect(evaluateFilter(filter, { 'tools.name': 'write' })).toBe(false);
    });

    it('is case-insensitive', () => {
      const filter = ast({ field: 'tools.name', operator: '~=', value: 'READ' });
      expect(evaluateFilter(filter, { 'tools.name': 'read_file' })).toBe(true);
      expect(evaluateFilter(filter, { 'tools.name': 'FileReader' })).toBe(true);
    });

    it('works with numbers converted to strings', () => {
      const filter = ast({ field: 'rpc.id', operator: '~=', value: '123' });
      expect(evaluateFilter(filter, { 'rpc.id': 'abc123def' })).toBe(true);
    });
  });

  describe('greater than operator (>)', () => {
    it('compares numbers', () => {
      const filter = ast({ field: 'rpc.latency', operator: '>', value: 1000 });
      expect(evaluateFilter(filter, { 'rpc.latency': 1500 })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.latency': 1000 })).toBe(false);
      expect(evaluateFilter(filter, { 'rpc.latency': 500 })).toBe(false);
    });

    it('handles string numbers', () => {
      const filter = ast({ field: 'rpc.latency', operator: '>', value: '1000' });
      expect(evaluateFilter(filter, { 'rpc.latency': '1500' })).toBe(true);
    });

    it('returns false for NaN', () => {
      const filter = ast({ field: 'rpc.latency', operator: '>', value: 1000 });
      expect(evaluateFilter(filter, { 'rpc.latency': 'not-a-number' })).toBe(false);
    });
  });

  describe('less than operator (<)', () => {
    it('compares numbers', () => {
      const filter = ast({ field: 'rpc.latency', operator: '<', value: 1000 });
      expect(evaluateFilter(filter, { 'rpc.latency': 500 })).toBe(true);
      expect(evaluateFilter(filter, { 'rpc.latency': 1000 })).toBe(false);
      expect(evaluateFilter(filter, { 'rpc.latency': 1500 })).toBe(false);
    });

    it('handles decimal numbers', () => {
      const filter = ast({ field: 'session.latency', operator: '<', value: 100.5 });
      expect(evaluateFilter(filter, { 'session.latency': 100.4 })).toBe(true);
      expect(evaluateFilter(filter, { 'session.latency': 100.5 })).toBe(false);
    });

    it('handles negative numbers', () => {
      const filter = ast({ field: 'rpc.latency', operator: '<', value: 0 });
      expect(evaluateFilter(filter, { 'rpc.latency': -10 })).toBe(true);
    });
  });

  describe('null/undefined handling', () => {
    it('!= returns true for null field', () => {
      const filter = ast({ field: 'tools.name', operator: '!=', value: 'test' });
      expect(evaluateFilter(filter, { 'tools.name': null })).toBe(true);
    });

    it('!= returns true for undefined field', () => {
      const filter = ast({ field: 'tools.name', operator: '!=', value: 'test' });
      expect(evaluateFilter(filter, {})).toBe(true);
    });

    it('== returns false for null field', () => {
      const filter = ast({ field: 'tools.name', operator: '==', value: 'test' });
      expect(evaluateFilter(filter, { 'tools.name': null })).toBe(false);
    });

    it('~= returns false for undefined field', () => {
      const filter = ast({ field: 'tools.name', operator: '~=', value: 'test' });
      expect(evaluateFilter(filter, {})).toBe(false);
    });

    it('> returns false for null field', () => {
      const filter = ast({ field: 'rpc.latency', operator: '>', value: 100 });
      expect(evaluateFilter(filter, { 'rpc.latency': null })).toBe(false);
    });
  });

  describe('multiple conditions (AND)', () => {
    it('all conditions must match', () => {
      const filter = ast(
        { field: 'rpc.method', operator: '==', value: 'tools/call' },
        { field: 'rpc.status', operator: '==', value: 'ok' }
      );

      expect(
        evaluateFilter(filter, { 'rpc.method': 'tools/call', 'rpc.status': 'ok' })
      ).toBe(true);

      expect(
        evaluateFilter(filter, { 'rpc.method': 'tools/call', 'rpc.status': 'err' })
      ).toBe(false);

      expect(
        evaluateFilter(filter, { 'rpc.method': 'other', 'rpc.status': 'ok' })
      ).toBe(false);
    });

    it('handles complex multi-condition filter', () => {
      const filter = ast(
        { field: 'rpc.method', operator: '==', value: 'tools/call' },
        { field: 'rpc.latency', operator: '>', value: 100 },
        { field: 'tools.name', operator: '~=', value: 'read' }
      );

      const ctx: FilterContext = {
        'rpc.method': 'tools/call',
        'rpc.latency': 200,
        'tools.name': 'read_file',
      };
      expect(evaluateFilter(filter, ctx)).toBe(true);

      const ctx2: FilterContext = {
        'rpc.method': 'tools/call',
        'rpc.latency': 50, // too low
        'tools.name': 'read_file',
      };
      expect(evaluateFilter(filter, ctx2)).toBe(false);
    });
  });
});
