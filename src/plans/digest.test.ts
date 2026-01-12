/**
 * Tests for Plan digest calculation
 */

import { describe, it, expect } from 'vitest';
import { normalizePlanForDigest, calculatePlanDigest } from './digest.js';
import type { PlanDefinition } from './schema.js';

describe('normalizePlanForDigest', () => {
  it('should normalize plan to canonical JSON', () => {
    const plan: PlanDefinition = {
      version: 1,
      name: 'test-plan',
      description: 'A test plan',
      steps: [
        { mcp: 'initialize' },
        { mcp: 'tools/list' },
      ],
    };

    const normalized = normalizePlanForDigest(plan);

    // Should be valid JSON
    expect(() => JSON.parse(normalized)).not.toThrow();

    // Should include all fields
    const parsed = JSON.parse(normalized);
    expect(parsed.version).toBe(1);
    expect(parsed.steps.length).toBe(2);
  });

  it('should produce consistent output regardless of property order', () => {
    const plan1: PlanDefinition = {
      version: 1,
      name: 'test',
      description: 'desc',
      steps: [{ mcp: 'initialize' }],
    };

    // Same content, but constructed differently
    const plan2 = JSON.parse(JSON.stringify({
      steps: [{ mcp: 'initialize' }],
      description: 'desc',
      name: 'test',
      version: 1,
    })) as PlanDefinition;

    const norm1 = normalizePlanForDigest(plan1);
    const norm2 = normalizePlanForDigest(plan2);

    expect(norm1).toBe(norm2);
  });

  it('should handle plans with when conditions', () => {
    const plan: PlanDefinition = {
      version: 1,
      steps: [
        { mcp: 'initialize' },
        { when: 'capabilities.resources', mcp: 'resources/list' },
      ],
    };

    const normalized = normalizePlanForDigest(plan);
    const parsed = JSON.parse(normalized);

    expect(parsed.steps[1].when).toBe('capabilities.resources');
    expect(parsed.steps[1].mcp).toBe('resources/list');
  });

  it('should exclude undefined fields', () => {
    const plan: PlanDefinition = {
      version: 1,
      steps: [{ mcp: 'initialize' }],
      // description is undefined
    };

    const normalized = normalizePlanForDigest(plan);
    const parsed = JSON.parse(normalized);

    expect(parsed.description).toBeUndefined();
  });
});

describe('calculatePlanDigest', () => {
  it('should return a SHA-256 hex string', () => {
    const plan: PlanDefinition = {
      version: 1,
      steps: [{ mcp: 'initialize' }],
    };

    const digest = calculatePlanDigest(plan);

    // SHA-256 produces 64 hex characters
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce same digest for equivalent plans', () => {
    const plan1: PlanDefinition = {
      version: 1,
      name: 'test',
      steps: [{ mcp: 'initialize' }],
    };

    const plan2: PlanDefinition = {
      version: 1,
      name: 'test',
      steps: [{ mcp: 'initialize' }],
    };

    const digest1 = calculatePlanDigest(plan1);
    const digest2 = calculatePlanDigest(plan2);

    expect(digest1).toBe(digest2);
  });

  it('should produce different digest for different plans', () => {
    const plan1: PlanDefinition = {
      version: 1,
      steps: [{ mcp: 'initialize' }],
    };

    const plan2: PlanDefinition = {
      version: 1,
      steps: [
        { mcp: 'initialize' },
        { mcp: 'tools/list' },
      ],
    };

    const digest1 = calculatePlanDigest(plan1);
    const digest2 = calculatePlanDigest(plan2);

    expect(digest1).not.toBe(digest2);
  });

  it('should produce different digest when when condition differs', () => {
    const plan1: PlanDefinition = {
      version: 1,
      steps: [
        { mcp: 'initialize' },
        { mcp: 'resources/list' },
      ],
    };

    const plan2: PlanDefinition = {
      version: 1,
      steps: [
        { mcp: 'initialize' },
        { when: 'capabilities.resources', mcp: 'resources/list' },
      ],
    };

    const digest1 = calculatePlanDigest(plan1);
    const digest2 = calculatePlanDigest(plan2);

    expect(digest1).not.toBe(digest2);
  });
});
