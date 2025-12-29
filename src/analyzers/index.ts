/**
 * Analyzers
 *
 * Export all analyzers and utilities
 */

export * from './IAnalyzer.js';
export * from './NoopAnalyzer.js';

import { AnalyzerRegistry } from './IAnalyzer.js';
import { NoopAnalyzer } from './NoopAnalyzer.js';

/**
 * Create a default registry with all built-in analyzers
 */
export function createDefaultAnalyzerRegistry(): AnalyzerRegistry {
  const registry = new AnalyzerRegistry();

  // Register built-in analyzers
  registry.register(new NoopAnalyzer());

  // Future analyzers will be registered here:
  // registry.register(new LatencyAnalyzer());
  // registry.register(new ErrorPatternAnalyzer());
  // registry.register(new SecurityAnalyzer());

  return registry;
}
