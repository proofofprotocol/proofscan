/**
 * Less Pager for psh Shell
 *
 * Interactive pager with vim-style navigation.
 * Supports j/k scrolling, page up/down, and g/G for first/last.
 */

import type { Pager, PagerOptions } from './types.js';
import type { PipelineValue } from '../pipeline-types.js';
import { renderRowsToLines } from './renderer.js';

export class LessPager implements Pager {
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
    const pageSize = Math.max(1, terminalHeight - 2); // Reserve space for footer

    if (lines.length <= pageSize) {
      lines.forEach(line => console.log(line));
      return;
    }

    // Enable raw mode for key input
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Hide cursor while in pager mode
    process.stdout.write('\x1B[?25l');

    try {
      await this.runLoop(lines, pageSize);
    } finally {
      // Show cursor again
      process.stdout.write('\x1B[?25h');

      // Restore raw mode
      process.stdin.setRawMode(false);
    }
  }

  private async runLoop(lines: string[], pageSize: number): Promise<void> {
    let offset = 0;

    return new Promise((resolve) => {
      const render = () => {
        // Clear screen and move cursor to top
        process.stdout.write('\x1B[2J\x1B[H');

        // Show visible lines
        const visible = lines.slice(offset, offset + pageSize);
        visible.forEach(line => console.log(line));

        // Footer with position info
        const start = offset + 1;
        const end = Math.min(offset + pageSize, lines.length);
        const position = `${start}-${end}/${lines.length}`;
        process.stdout.write(`\x1b[2m-- pfscan less -- ${position} | j/k scroll | space page | q quit\x1b[0m`);
      };

      const cleanup = () => {
        process.stdin.removeListener('data', onKey);
        // Show cursor and clear screen before returning to shell
        process.stdout.write('\x1B[?25h\x1B[2J\x1B[H');
      };

      const maxOffset = Math.max(0, lines.length - pageSize);

      const onKey = (key: Buffer) => {
        const ch = key.toString();

        // Handle escape sequences (arrow keys, page up/down)
        if (ch.startsWith('\x1B[')) {
          switch (ch) {
            case '\x1B[B': // Down arrow
              if (offset < maxOffset) {
                offset++;
              }
              render(); // Always re-render to clear any stray characters
              break;
            case '\x1B[A': // Up arrow
              if (offset > 0) {
                offset--;
              }
              render();
              break;
            case '\x1B[6~': // Page Down
              offset = Math.min(offset + pageSize, maxOffset);
              render();
              break;
            case '\x1B[5~': // Page Up
              offset = Math.max(0, offset - pageSize);
              render();
              break;
            default:
              // Unknown escape sequence - re-render to clear
              render();
          }
          return;
        }

        // Single character commands - always re-render to prevent stray chars
        switch (ch) {
          case 'q':
          case '\x03': // Ctrl+C
            cleanup();
            resolve();
            return; // Don't render after cleanup
          case 'j': // Down
            if (offset < maxOffset) {
              offset++;
            }
            break;
          case 'k': // Up
            if (offset > 0) {
              offset--;
            }
            break;
          case ' ': // Page down
          case 'f': // Forward (like less)
            offset = Math.min(offset + pageSize, maxOffset);
            break;
          case 'b': // Page up / backward
            offset = Math.max(0, offset - pageSize);
            break;
          case 'g': // First line
            offset = 0;
            break;
          case 'G': // Last line
            offset = maxOffset;
            break;
          case 'd': // Half page down (like vim)
            offset = Math.min(offset + Math.floor(pageSize / 2), maxOffset);
            break;
          case 'u': // Half page up (like vim)
            offset = Math.max(0, offset - Math.floor(pageSize / 2));
            break;
        }
        // Re-render after any key to clear potential stray characters
        render();
      };

      process.stdin.on('data', onKey);
      render();
    });
  }
}
