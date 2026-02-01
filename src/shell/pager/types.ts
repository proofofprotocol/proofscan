/**
 * Pager Types for psh Shell
 *
 * Defines interfaces for pager implementations (less, more).
 */

import type { PipelineValue } from '../pipeline-types.js';

/** Pager common interface */
export interface Pager {
  /**
   * Run pager with pipeline input
   * @returns true if pager was used, false if output was printed directly (fits one page)
   */
  run(input: PipelineValue): Promise<boolean>;
}

/** Pager options */
export interface PagerOptions {
  /** Terminal width (default: process.stdout.columns) */
  width?: number;
  /** Terminal height (default: process.stdout.rows) */
  height?: number;
}
