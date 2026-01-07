/**
 * Secret input utilities (Phase 3.6)
 *
 * Provides secure methods for reading secrets from user input without echoing.
 * Never logs, prints, or writes the secret value to disk.
 */

import * as readline from 'readline';
import { getClipboardContent } from './clipboard.js';

/**
 * Read a secret from stdin without echoing to the terminal.
 * Uses readline with output muted to hide input.
 *
 * @returns The entered secret (trimmed)
 */
export async function readSecretHidden(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !!process.stdin.isTTY,
    });

    // Mute output to hide the typed characters
    const originalWrite = process.stdout.write.bind(process.stdout);
    let muted = false;

    if (process.stdin.isTTY) {
      muted = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = (chunk: any, ...args: any[]) => {
        // Allow newlines through, mute everything else during input
        if (chunk === '\n' || chunk === '\r\n') {
          return originalWrite(chunk, ...args);
        }
        return true;
      };
    }

    rl.question('', (answer) => {
      // Restore stdout
      if (muted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stdout as any).write = originalWrite;
        process.stdout.write('\n');
      }
      rl.close();
      resolve(answer?.trim() || '');
    });

    // Handle Ctrl+C
    rl.on('SIGINT', () => {
      if (muted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stdout as any).write = originalWrite;
        process.stdout.write('\n');
      }
      rl.close();
      process.kill(process.pid, 'SIGINT');
    });
  });
}

/**
 * Read a secret from the system clipboard.
 * Trims whitespace from the result.
 *
 * @returns The clipboard content (trimmed)
 * @throws Error if clipboard is empty or unavailable
 */
export async function readSecretFromClipboard(): Promise<string> {
  const content = await getClipboardContent();

  if (!content || content.trim().length === 0) {
    throw new Error('Clipboard is empty');
  }

  return content.trim();
}
