/**
 * Plan digest calculation
 * Phase 5.2: Stable hash for plan content change detection
 */

import { createHash } from 'crypto';
import type { PlanDefinition, PlanStep } from './schema.js';

/**
 * Normalize a plan definition for digest calculation.
 * Produces a canonical JSON representation that:
 * - Sorts keys deterministically
 * - Excludes metadata (name, description) that doesn't affect execution
 * - Focuses on executable content (version, steps)
 */
export function normalizePlanForDigest(def: PlanDefinition): string {
  // Only include fields that affect execution
  const normalized = {
    version: def.version,
    steps: def.steps.map(normalizeStep),
  };

  return JSON.stringify(normalized, null, 0);
}

/**
 * Normalize a single step for digest calculation
 */
function normalizeStep(step: PlanStep): Record<string, unknown> {
  const result: Record<string, unknown> = {
    mcp: step.mcp,
  };

  // Only include when if present
  if (step.when !== undefined) {
    result.when = step.when;
  }

  return result;
}

/**
 * Calculate SHA-256 digest of normalized plan content
 * Returns full 64-char hex string
 */
export function calculatePlanDigest(def: PlanDefinition): string {
  const normalized = normalizePlanForDigest(def);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Calculate SHA-256 digest from raw normalized string
 * Used when loading from database
 */
export function calculateDigestFromNormalized(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
