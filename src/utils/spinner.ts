/**
 * Spinner utility for proofscan
 * 
 * Provides a unified spinner interface with:
 * - Automatic TTY detection
 * - JSON mode support
 * - SIGINT handling
 * - Consistent braille frames
 */

import ora, { type Ora } from 'ora';
import { getOutputOptions } from './output.js';
import { isInteractiveTTY } from './platform.js';

/** Braille spinner frames (consistent across the app) */
export const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Spinner configuration options
 */
export interface SpinnerOptions {
  /** Initial text to display */
  text: string;
  /** Force enable spinner (overrides detection) */
  force?: boolean;
  /** Stream to output to (default: stderr) */
  stream?: NodeJS.WritableStream;
}

/**
 * Check if spinner should be shown
 * 
 * Priority:
 * 1. --json mode → always false
 * 2. Not interactive TTY → false
 * 3. force option → true
 * 4. Otherwise → true (default)
 */
function shouldShowSpinner(force?: boolean): boolean {
  const opts = getOutputOptions();

  // --json always disables spinner
  if (opts.json) {
    return false;
  }

  // Must be interactive TTY
  if (!isInteractiveTTY()) {
    return false;
  }

  // Force explicitly enables
  if (force === true) {
    return true;
  }

  // Default: enable spinner
  return true;
}

/**
 * Create a spinner with unified configuration
 * 
 * @param options - Spinner configuration
 * @returns Ora spinner instance or null if spinner disabled
 * 
 * @example
 * ```typescript
 * const spinner = createSpinner({ text: 'Loading...' });
 * if (spinner) {
 *   spinner.start();
 *   // ... do work ...
 *   spinner.succeed('Done!');
 * }
 * ```
 */
export function createSpinner(options: SpinnerOptions): Ora | null {
  if (!shouldShowSpinner(options.force)) {
    return null;
  }

  const spinner = ora({
    text: options.text,
    stream: options.stream || process.stderr,
    spinner: {
      frames: BRAILLE_FRAMES,
      interval: 80,
    },
  });

  // SIGINT handling (graceful termination with exit code 130)
  // Exit code 130 = 128 + 2 (SIGINT signal number)
  // Note: Using 'on' instead of 'once' to properly handle cleanup
  let cleanupCalled = false;
  const cleanup = () => {
    if (cleanupCalled) return;
    cleanupCalled = true;
    spinner.stop();
    process.exit(130);
  };

  process.on('SIGINT', cleanup);
  spinner.start();

  // Remove SIGINT handler when spinner stops
  const removeCleanup = () => {
    if (!cleanupCalled) {
      process.removeListener('SIGINT', cleanup);
    }
  };

  const originalStop = spinner.stop.bind(spinner);
  const originalSucceed = spinner.succeed.bind(spinner);
  const originalFail = spinner.fail.bind(spinner);

  spinner.stop = () => {
    removeCleanup();
    return originalStop();
  };

  spinner.succeed = (text?: string) => {
    removeCleanup();
    return originalSucceed(text);
  };

  spinner.fail = (text?: string) => {
    removeCleanup();
    return originalFail(text);
  };

  return spinner;
}

/**
 * Run an async operation with a spinner
 * 
 * @param text - Spinner text
 * @param fn - Async function to execute
 * @param successText - Text to show on success (optional)
 * @param failText - Text to show on failure (optional)
 * @returns Result of the async function
 * 
 * @example
 * ```typescript
 * const result = await withSpinner(
 *   'Fetching data...',
 *   async () => {
 *     return await fetchData();
 *   },
 *   'Data fetched!',
 *   'Failed to fetch data'
 * );
 * ```
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successText?: string,
  failText?: string
): Promise<T> {
  const spinner = createSpinner({ text });

  try {
    const result = await fn();
    if (spinner) {
      spinner.succeed(successText);
    }
    return result;
  } catch (error) {
    if (spinner) {
      spinner.fail(failText);
    }
    throw error;
  }
}
