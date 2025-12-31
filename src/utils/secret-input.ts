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
 * Uses raw mode to prevent any character display.
 *
 * @returns The entered secret (trimmed)
 */
export async function readSecretHidden(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Disable echo if possible
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let input = '';

    const onData = (key: Buffer): void => {
      const char = key.toString();

      // Handle Enter (CR or LF)
      if (char === '\r' || char === '\n') {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        resolve(input);
        return;
      }

      // Handle Ctrl+C - clean up and let the process handle termination
      if (char === '\x03') {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        // Send SIGINT to allow cleanup handlers to run
        process.kill(process.pid, 'SIGINT');
        return;
      }

      // Handle Backspace
      if (char === '\x7f' || char === '\x08') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          // Don't echo anything
        }
        return;
      }

      // Regular character
      if (char.length === 1 && char.charCodeAt(0) >= 32) {
        input += char;
        // Don't echo anything
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
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
