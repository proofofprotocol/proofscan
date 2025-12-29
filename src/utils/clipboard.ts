/**
 * Cross-platform clipboard reading utility
 */

import { execSync } from 'child_process';
import { platform } from 'os';

/**
 * Read text content from system clipboard
 *
 * OS support:
 * - Windows: PowerShell Get-Clipboard
 * - macOS: pbpaste
 * - Linux: wl-paste (Wayland), fallback to xclip (X11)
 */
export function readClipboard(): string {
  const os = platform();

  try {
    let command: string;

    switch (os) {
      case 'win32':
        // Windows: PowerShell Get-Clipboard
        command = 'powershell.exe -NoProfile -Command "Get-Clipboard -Raw"';
        break;

      case 'darwin':
        // macOS: pbpaste
        command = 'pbpaste';
        break;

      case 'linux':
        // Linux: try wl-paste (Wayland) first, fallback to xclip (X11)
        try {
          return execSync('wl-paste --no-newline 2>/dev/null', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Fallback to xclip
          command = 'xclip -selection clipboard -o';
        }
        break;

      default:
        throw new Error(`Unsupported platform: ${os}`);
    }

    const content = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Failed to read clipboard: ${message}\n` +
      'Hint: Use --file <path> or pipe JSON via stdin instead.'
    );
  }
}

/**
 * Check if clipboard tools are available
 */
export function isClipboardAvailable(): boolean {
  const os = platform();

  try {
    switch (os) {
      case 'win32':
        execSync('powershell.exe -NoProfile -Command "exit 0"', { stdio: 'pipe' });
        return true;

      case 'darwin':
        execSync('which pbpaste', { stdio: 'pipe' });
        return true;

      case 'linux':
        try {
          execSync('which wl-paste', { stdio: 'pipe' });
          return true;
        } catch {
          execSync('which xclip', { stdio: 'pipe' });
          return true;
        }

      default:
        return false;
    }
  } catch {
    return false;
  }
}
