/**
 * Tests for Tool Adapter (Phase 4.0)
 */

import { describe, it, expect } from 'vitest';
import {
  formatInputSchema,
  type ToolInputSchema,
} from './adapter.js';

describe('formatInputSchema', () => {
  it('should return empty arrays for undefined schema', () => {
    const result = formatInputSchema(undefined);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it('should return empty arrays for schema without properties', () => {
    const schema: ToolInputSchema = { type: 'object' };
    const result = formatInputSchema(schema);
    expect(result.required).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it('should separate required and optional properties', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock symbol' },
        limit: { type: 'number', description: 'Result limit', default: 10 },
      },
      required: ['symbol'],
    };

    const result = formatInputSchema(schema);

    expect(result.required).toHaveLength(1);
    expect(result.required[0]).toEqual({
      name: 'symbol',
      type: 'string',
      description: 'Stock symbol',
      default: undefined,
    });

    expect(result.optional).toHaveLength(1);
    expect(result.optional[0]).toEqual({
      name: 'limit',
      type: 'number',
      description: 'Result limit',
      default: 10,
    });
  });

  it('should handle schema with all required properties', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['name', 'value'],
    };

    const result = formatInputSchema(schema);

    expect(result.required).toHaveLength(2);
    expect(result.optional).toHaveLength(0);
    expect(result.required.map(r => r.name)).toEqual(['name', 'value']);
  });

  it('should handle schema with all optional properties', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number', default: 0 },
      },
      // No required array
    };

    const result = formatInputSchema(schema);

    expect(result.required).toHaveLength(0);
    expect(result.optional).toHaveLength(2);
  });

  it('should handle complex types', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          properties: {
            nested: { type: 'string' },
          },
        },
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['options'],
    };

    const result = formatInputSchema(schema);

    expect(result.required).toHaveLength(1);
    expect(result.required[0].name).toBe('options');
    expect(result.required[0].type).toBe('object');

    expect(result.optional).toHaveLength(1);
    expect(result.optional[0].name).toBe('items');
    expect(result.optional[0].type).toBe('array');
  });
});
