/**
 * Pager Types for psh Shell
 *
 * Defines interfaces for pager implementations (less, more).
 */

import type { PipelineValue } from '../pipeline-types.js';

/** Pager common interface */
export interface Pager {
  /** Run pager with pipeline input */
  run(input: PipelineValue): Promise<void>;
}

/** Pager options */
export interface PagerOptions {
  /** Terminal width (default: process.stdout.columns) */
  width?: number;
  /** Terminal height (default: process.stdout.rows) */
  height?: number;
}
