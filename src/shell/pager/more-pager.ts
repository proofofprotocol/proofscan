/**
 * More Pager for psh Shell
 *
 * Simple page-by-page pager with Enter/Space to advance.
 * No backward navigation (like classic more command).
 */

import type { Pager, PagerOptions } from './types.js';
import type { PipelineValue } from '../pipeline-types.js';
import { renderRowsToLines } from './renderer.js';

export class MorePager implements Pager {
  private options: PagerOptions;

  constructor(options?: PagerOptions) {
    this.options = options ?? {};
  }

  async run(input: PipelineValue): Promise<void> {
    // TTY check - non-TTY outputs all lines without paging
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const lines = renderRowsToLines(input, { useColor: false });
      lines.forEach(line => console.log(line));
      return;
    }

    const lines = renderRowsToLines(input, { useColor: true });

    // If content fits in one page, just print and return
    const terminalHeight = this.options.height ?? (process.stdout.rows || 24);
    const pageSize = Math.max(1, terminalHeight - 2); // Reserve space for prompt

    if (lines.length <= pageSize) {
      lines.forEach(line => console.log(line));
      return;
    }

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
        // Restore mode
        process.stdin.setRawMode(false);
        process.stdin.pause();
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
