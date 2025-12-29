/**
 * Config path resolution utility
 * Priority:
 * 1) --config <path> (passed as argument)
 * 2) PROOFSCAN_CONFIG environment variable
 * 3) OS standard config location
 */

import { homedir, platform } from 'os';
import { join } from 'path';

export function getDefaultConfigDir(): string {
  const home = homedir();
  const os = platform();

  switch (os) {
    case 'win32':
      // Windows: %APPDATA%\proofscan
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'proofscan');
    case 'darwin':
      // macOS: ~/Library/Application Support/proofscan
      return join(home, 'Library', 'Application Support', 'proofscan');
    default:
      // Linux and others: ~/.config/proofscan
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'proofscan');
  }
}

export function getDefaultConfigPath(): string {
  return join(getDefaultConfigDir(), 'config.json');
}

export function getEventsDir(configDir?: string): string {
  return join(configDir || getDefaultConfigDir(), 'events');
}

export interface ConfigPathOptions {
  configPath?: string; // --config argument
}

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  // Priority 1: --config argument
  if (options.configPath) {
    return options.configPath;
  }

  // Priority 2: PROOFSCAN_CONFIG environment variable
  const envPath = process.env.PROOFSCAN_CONFIG;
  if (envPath) {
    return envPath;
  }

  // Priority 3: OS standard location
  return getDefaultConfigPath();
}
