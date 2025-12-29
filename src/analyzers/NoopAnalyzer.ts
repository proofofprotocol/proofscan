/**
 * Noop Analyzer
 *
 * Phase 2.1: Placeholder analyzer that does nothing
 * Used as a template and for testing the analyzer infrastructure
 */

import type { IAnalyzer, AnalysisResult } from './IAnalyzer.js';
import type { EventLine, EventLinePair } from '../eventline/types.js';

/**
 * Noop Analyzer - does nothing, returns empty results
 *
 * This serves as:
 * 1. A template for creating new analyzers
 * 2. A test fixture for the analyzer infrastructure
 * 3. A way to verify the hook system works
 */
export class NoopAnalyzer implements IAnalyzer {
  readonly name = 'noop';
  readonly version = '1.0.0';
  readonly description = 'No-operation analyzer (placeholder)';

  async analyze(events: EventLine[]): Promise<AnalysisResult> {
    return {
      analyzer: this.name,
      ts_ms: Date.now(),
      findings: [],
      stats: {
        events_processed: events.length,
        findings_count: 0,
      },
      meta: {
        version: this.version,
        description: this.description,
      },
    };
  }

  async analyzePairs(pairs: EventLinePair[]): Promise<AnalysisResult> {
    return {
      analyzer: this.name,
      ts_ms: Date.now(),
      findings: [],
      stats: {
        pairs_processed: pairs.length,
        findings_count: 0,
      },
      meta: {
        version: this.version,
        description: this.description,
      },
    };
  }
}
