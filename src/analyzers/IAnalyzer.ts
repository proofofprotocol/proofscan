/**
 * Analyzer Interface
 *
 * Phase 2.1: Skeleton for event analysis hooks
 * Full implementation in Phase 3
 */

import type { EventLine, EventLinePair } from '../eventline/types.js';

/**
 * Analysis result
 */
export interface AnalysisResult {
  /** Analyzer identifier */
  analyzer: string;

  /** Analysis timestamp */
  ts_ms: number;

  /** Findings from analysis */
  findings: AnalysisFinding[];

  /** Statistics */
  stats?: Record<string, unknown>;

  /** Metadata */
  meta?: Record<string, unknown>;
}

/**
 * Individual finding from analysis
 */
export interface AnalysisFinding {
  /** Finding type */
  type: 'info' | 'warning' | 'error' | 'suggestion';

  /** Finding category */
  category: string;

  /** Human-readable message */
  message: string;

  /** Related event(s) */
  events?: EventLine[];

  /** Related pair(s) */
  pairs?: EventLinePair[];

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Analyzer interface
 *
 * Analyzers process events and produce findings
 */
export interface IAnalyzer {
  /** Analyzer name */
  readonly name: string;

  /** Analyzer version */
  readonly version: string;

  /** Description */
  readonly description: string;

  /**
   * Analyze a batch of events
   * @param events - Events to analyze
   * @returns Analysis result
   */
  analyze(events: EventLine[]): Promise<AnalysisResult>;

  /**
   * Analyze RPC pairs
   * @param pairs - RPC pairs to analyze
   * @returns Analysis result
   */
  analyzePairs(pairs: EventLinePair[]): Promise<AnalysisResult>;
}

/**
 * Analyzer registry
 */
export class AnalyzerRegistry {
  private analyzers: Map<string, IAnalyzer> = new Map();

  /**
   * Register an analyzer
   */
  register(analyzer: IAnalyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  /**
   * Get analyzer by name
   */
  get(name: string): IAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  /**
   * Get all registered analyzers
   */
  getAll(): IAnalyzer[] {
    return Array.from(this.analyzers.values());
  }

  /**
   * Run all analyzers on events
   */
  async analyzeAll(events: EventLine[]): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];

    for (const analyzer of this.analyzers.values()) {
      try {
        const result = await analyzer.analyze(events);
        results.push(result);
      } catch (error) {
        // Log error but continue with other analyzers
        console.error(`Analyzer ${analyzer.name} failed:`, error);
      }
    }

    return results;
  }
}
