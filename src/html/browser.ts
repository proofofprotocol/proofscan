/**
 * Browser Utility (Phase 5.0)
 *
 * Cross-platform browser opening functionality.
 */

import { exec } from 'child_process';

/**
 * Open a file in the default browser
 *
 * Platform-specific commands:
 * - macOS: open
 * - Windows: cmd /c start "" (handles paths with spaces)
 * - Linux: xdg-open
 */
export function openInBrowser(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;

    if (process.platform === 'darwin') {
      cmd = `open "${filePath}"`;
    } else if (process.platform === 'win32') {
      // Windows: cmd /c start "" to handle paths with spaces
      cmd = `cmd /c start "" "${filePath}"`;
    } else {
      // Linux and others
      cmd = `xdg-open "${filePath}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
