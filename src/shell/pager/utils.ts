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
 * Run a pager command with content
 * @param cmd - Command to run
 * @param args - Command arguments
 * @param content - Content to pipe to pager
 */
export function runPager(cmd: string, args: string[], content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pager = spawn(cmd, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    pager.on('error', reject);
    pager.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Pager exited with code ${code}`));
      }
    });

    pager.stdin?.write(content);
    pager.stdin?.end();
  });
}
