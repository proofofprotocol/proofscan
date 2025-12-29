/**
 * State management utilities
 * Handles persistent state like current session
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';

/**
 * Current session state
 */
export interface CurrentSessionState {
  sessionId: string;
  connectorId?: string;
  updatedAt: string;
}

/**
 * Get the state directory path (OS-specific)
 * Uses XDG_DATA_HOME on Linux, standard locations on Windows/macOS
 */
export function getStateDir(): string {
  const home = homedir();
  const os = platform();

  switch (os) {
    case 'win32':
      // Windows: %APPDATA%\proofscan\state
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'proofscan', 'state');
    case 'darwin':
      // macOS: ~/Library/Application Support/proofscan/state
      return join(home, 'Library', 'Application Support', 'proofscan', 'state');
    default:
      // Linux: ~/.local/share/proofscan/state
      return join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'proofscan', 'state');
  }
}

/**
 * Get the current session file path
 */
export function getCurrentSessionPath(): string {
  return join(getStateDir(), 'current-session.json');
}

/**
 * Get the current session state
 */
export function getCurrentSession(): CurrentSessionState | null {
  const path = getCurrentSessionPath();

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const state = JSON.parse(content) as CurrentSessionState;

    // Validate required fields
    if (!state.sessionId || !state.updatedAt) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Set the current session state
 */
export function setCurrentSession(sessionId: string, connectorId?: string): void {
  const path = getCurrentSessionPath();
  const dir = dirname(path);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const state: CurrentSessionState = {
    sessionId,
    connectorId,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Clear the current session state
 */
export function clearCurrentSession(): void {
  const path = getCurrentSessionPath();

  if (existsSync(path)) {
    try {
      writeFileSync(path, '{}', 'utf-8');
    } catch {
      // Ignore errors during cleanup
    }
  }
}
