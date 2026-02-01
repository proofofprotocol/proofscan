/**
 * Pager Utilities for psh Shell
 *
 * Common functionality shared between pager implementations.
 */

import { spawn, spawnSync } from 'child_process';

/** Number of lines reserved for pager footer/prompt */
export const FOOTER_RESERVE_LINES = 2;

/**
 * Check if a command exists on the system
 * Cross-platform: uses 'where' on Windows, 'which' on Unix
 */
export function commandExists(cmd: string): boolean {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [cmd], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Parse a pager command string that may include arguments
 * e.g., "less -R" -> { cmd: "less", args: ["-R"] }
 */
export function parsePagerCommand(pagerString: string): { cmd: string; args: string[] } {
  const parts = pagerString.trim().split(/\s+/);
  return {
    cmd: parts[0],
    args: parts.slice(1),
  };
}

/**
 * Run a pager command with content (synchronous)
 * Using spawnSync to ensure pager completes before returning,
 * preventing readline listener conflicts.
 *
 * @param cmd - Command to run
 * @param args - Command arguments
 * @param content - Content to pipe to pager
 */
export function runPager(cmd: string, args: string[], content: string): void {
  const result = spawnSync(cmd, args, {
    input: content,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== null) {
    throw new Error(`Pager exited with code ${result.status}`);
  }
}
