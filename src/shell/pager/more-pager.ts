/**
 * More Pager for psh Shell
 *
 * "Page-forward" mode pager that auto-exits at end of content.
 * Uses 'less -E' for implementation (more feature-complete than system 'more').
 *
 * Pager selection priority:
 *   1. 'less' with -E option (quit at EOF, like more)
 *   2. Built-in pager (fallback)
 *
 * Note: When using external pager, standard pager key bindings apply.
 */

import type { Pager, PagerOptions } from './types.js';
import type { PipelineValue } from '../pipeline-types.js';
import { renderRowsToLines } from './renderer.js';
import { commandExists, runPager, FOOTER_RESERVE_LINES } from './utils.js';

export class MorePager implements Pager {
  private options: PagerOptions;

  constructor(options?: PagerOptions) {
    this.options = options ?? {};
  }

  async run(input: PipelineValue): Promise<boolean> {
    // TTY check - non-TTY outputs all lines without paging
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const lines = renderRowsToLines(input, { useColor: false });
      lines.forEach(line => console.log(line));
      return false; // No pager used
    }

    const lines = renderRowsToLines(input, { useColor: true });

    // If content fits in one page, just print and return
    const terminalHeight = this.options.height ?? (process.stdout.rows || 24);
    const pageSize = Math.max(1, terminalHeight - FOOTER_RESERVE_LINES);

    if (lines.length <= pageSize) {
      lines.forEach(line => console.log(line));
      return false; // No pager used
    }

    // Try external pager (less -E -> built-in)
    const pagerResult = await this.tryExternalPager(lines);
    if (!pagerResult) {
      // External pager failed, use built-in
      await this.runBuiltIn(lines, pageSize);
    }
    return true; // Pager was used
  }

  /**
   * Try external pager
   * Returns true if successful, false if failed
   */
  private async tryExternalPager(lines: string[]): Promise<boolean> {
    const content = lines.join('\n') + '\n';

    // Use 'less' with more-like options
    // -E: quit at end of file (like more)
    // -R: interpret ANSI color codes
    // -S: don't wrap long lines (preserves table layout)
    // -X: don't clear screen on exit
    if (commandExists('less')) {
      try {
        await runPager('less', ['-ERSX'], content);
        return true;
      } catch {
        // less failed, continue to built-in
      }
    }

    return false;
  }

  /**
   * Built-in pager fallback
   * Simple page-forward mode (no backward navigation)
   */
  private async runBuiltIn(lines: string[], pageSize: number): Promise<void> {
    // Page through content
    for (let i = 0; i < lines.length; i += pageSize) {
      const page = lines.slice(i, i + pageSize);
      page.forEach(line => console.log(line));

      // Show prompt if there's more content
      if (i + pageSize < lines.length) {
        const shouldContinue = await this.prompt(i + pageSize, lines.length);
        if (!shouldContinue) {
          break;
        }
      }
    }
  }

  private prompt(current: number, total: number): Promise<boolean> {
    return new Promise((resolve) => {
      // Show prompt
      process.stdout.write(`\x1b[2m-- more (${current}/${total}) -- Enter/Space: next | q: quit\x1b[0m`);

      // Enable raw mode for single key input
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onKey = (key: Buffer) => {
        // Restore raw mode but do NOT pause stdin
        // The shell's readline interface manages stdin and pausing would disrupt it
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);

        // Clear the prompt line
        process.stdout.write('\r\x1b[K');

        const ch = key.toString();
        if (ch === 'q' || ch === '\x03') { // q or Ctrl+C
          resolve(false);
        } else {
          resolve(true);
        }
      };

      process.stdin.once('data', onKey);
    });
  }
}
