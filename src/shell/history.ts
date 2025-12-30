/**
 * Shell history management
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';

const MAX_HISTORY_SIZE = 1000;

/**
 * Get the history file path (OS-specific)
 */
export function getHistoryPath(): string {
  const home = homedir();
  const os = platform();

  switch (os) {
    case 'win32':
      // Windows: %APPDATA%\proofscan\shell_history
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'proofscan', 'shell_history');
    case 'darwin':
      // macOS: ~/.config/proofscan/shell_history
      return join(home, '.config', 'proofscan', 'shell_history');
    default:
      // Linux: ~/.config/proofscan/shell_history
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'proofscan', 'shell_history');
  }
}

/**
 * Load history from file
 */
export function loadHistory(): string[] {
  const path = getHistoryPath();

  if (!existsSync(path)) {
    return [];
  }

  try {
    const content = readFileSync(path, 'utf-8');
    return content.split('\n').filter(line => line.trim() !== '');
  } catch {
    return [];
  }
}

/**
 * Save history to file
 */
export function saveHistory(history: string[]): void {
  const path = getHistoryPath();
  const dir = dirname(path);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Limit history size
  const trimmed = history.slice(-MAX_HISTORY_SIZE);

  try {
    writeFileSync(path, trimmed.join('\n') + '\n', 'utf-8');
  } catch {
    // Ignore errors during save
  }
}

/**
 * Add a line to history (deduplicates consecutive entries)
 */
export function addToHistory(history: string[], line: string): string[] {
  const trimmed = line.trim();
  if (trimmed === '') {
    return history;
  }

  // Don't add if same as last entry
  if (history.length > 0 && history[history.length - 1] === trimmed) {
    return history;
  }

  return [...history, trimmed];
}
