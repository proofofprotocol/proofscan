/**
 * Configure Mode Types
 *
 * Type definitions for the psh configure mode, which allows
 * interactive editing of connector configurations.
 */

import type { Connector, StdioTransport } from '../../types/config.js';

/**
 * Edit session for a single connector
 */
export interface EditSession {
  /** Original connector from config (for diffing) */
  original: Connector;

  /** Working copy with pending changes */
  candidate: Connector;

  /** Track which fields were modified */
  modifiedFields: Set<string>;

  /** Pending secret values (not yet stored in secrets.db) */
  pendingSecrets: Map<string, string>;

  /** Whether this is a new connector (not in config yet) */
  isNew: boolean;
}

/**
 * Configure mode state
 */
export interface ConfigureModeState {
  /** Whether configure mode is active */
  active: boolean;

  /** Current edit session (null if not editing a connector) */
  editSession: EditSession | null;
}

/**
 * Options for the set command
 */
export interface SetOptions {
  /** Force the value to be treated as a secret */
  forceSecret?: boolean;

  /** Whether the value should be read interactively (for @secret) */
  interactive?: boolean;
}

/**
 * Result of a set operation
 */
export interface SetResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Whether the value is a secret */
  isSecret: boolean;

  /** Secret reference if stored (e.g., "dpapi:uuid") */
  secretRef?: string;

  /** Error message if failed */
  error?: string;

  /** Field path that was set */
  path?: string;
}

/**
 * Result of an unset operation
 */
export interface UnsetResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Whether the removed value was a secret */
  wasSecret: boolean;

  /** Error message if failed */
  error?: string;

  /** Field path that was unset */
  path?: string;
}

/**
 * Diff between original and candidate connector
 */
export interface ConnectorDiff {
  /** Fields that were added */
  added: Map<string, unknown>;

  /** Fields that were removed */
  removed: Map<string, unknown>;

  /** Fields that were modified (old value, new value) */
  modified: Map<string, { old: unknown; new: unknown }>;

  /** Whether there are any changes */
  hasChanges: boolean;
}

/**
 * Options for the commit command
 */
export interface CommitOptions {
  /** Only show diff, don't actually commit */
  dryRun?: boolean;

  /** Don't reload proxy after commit */
  noReload?: boolean;
}

/**
 * Result of a commit operation
 */
export interface CommitResult {
  /** Whether the commit succeeded */
  success: boolean;

  /** Whether the proxy was reloaded */
  proxyReloaded: boolean;

  /** Number of secrets stored */
  secretsStored: number;

  /** Message describing what happened */
  message?: string;

  /** Error message if failed */
  error?: string;

  /** Diff showing what changed */
  diff?: ConnectorDiff;

  /** Type of commit: 'added' (new connector), 'updated' (existing), or 'none' (no changes) */
  commitType?: 'added' | 'updated' | 'none';
}

/**
 * Supported field paths for the set command
 */
export type FieldPath =
  | 'enabled'
  | 'command'
  | 'cwd'
  | `args[${number}]`
  | `args`
  | `env.${string}`;

/**
 * Parse a field path into its components
 */
export interface ParsedPath {
  /** Top-level field (enabled, command, args, env, cwd) */
  field: 'enabled' | 'command' | 'cwd' | 'args' | 'env';

  /** Index for array fields (args[0]) */
  index?: number;

  /** Key for map fields (env.KEY) */
  key?: string;
}

/**
 * Create a deep copy of a connector
 */
export function cloneConnector(connector: Connector): Connector {
  return JSON.parse(JSON.stringify(connector));
}

/**
 * Create an empty connector template
 */
export function createEmptyConnector(id: string): Connector {
  return {
    id,
    enabled: true,
    transport: {
      type: 'stdio',
      command: '',
      args: [],
      env: {},
    } as StdioTransport,
  };
}

/**
 * Parse a field path string into components
 */
export function parseFieldPath(path: string): ParsedPath | null {
  // enabled
  if (path === 'enabled') {
    return { field: 'enabled' };
  }

  // command
  if (path === 'command') {
    return { field: 'command' };
  }

  // cwd
  if (path === 'cwd') {
    return { field: 'cwd' };
  }

  // args (whole array)
  if (path === 'args') {
    return { field: 'args' };
  }

  // args[n]
  const argsMatch = path.match(/^args\[(\d+)\]$/);
  if (argsMatch) {
    return { field: 'args', index: parseInt(argsMatch[1], 10) };
  }

  // env.KEY or env.KEY=VALUE (KEY part)
  const envMatch = path.match(/^env\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (envMatch) {
    return { field: 'env', key: envMatch[1] };
  }

  return null;
}

/**
 * Check if a path represents a secret field
 */
export function isSecretPath(path: string): boolean {
  return path.startsWith('env.');
}
