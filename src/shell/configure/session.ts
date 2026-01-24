/**
 * Edit Session Manager
 *
 * Manages the editing state for a single connector in configure mode.
 * Handles set/unset operations and tracks pending secrets.
 */

import type { Connector, StdioTransport } from '../../types/config.js';
import type {
  EditSession,
  SetOptions,
  SetResult,
  UnsetResult,
  ConnectorDiff,
  ParsedPath,
} from './types.js';
import { parseFieldPath, isSecretPath } from './types.js';
import { detectSecret } from '../../secrets/detection.js';
import { SqliteSecretStore } from '../../secrets/store.js';
import { isSecretRef } from '../../secrets/types.js';

/**
 * Manager for editing a connector in configure mode
 */
export class EditSessionManager {
  private session: EditSession;

  constructor(session: EditSession) {
    this.session = session;
  }

  /**
   * Get the current edit session
   */
  getSession(): EditSession {
    return this.session;
  }

  /**
   * Get the candidate connector
   */
  getCandidate(): Connector {
    return this.session.candidate;
  }

  /**
   * Check if the session has unsaved changes
   * Note: A new connector (isNew=true) is always considered dirty,
   * even if no fields have been modified (the connector itself is new)
   */
  isDirty(): boolean {
    return this.session.isNew || this.session.modifiedFields.size > 0 || this.session.pendingSecrets.size > 0;
  }

  /**
   * Check if the session has actual field modifications (excluding isNew status)
   */
  hasFieldChanges(): boolean {
    return this.session.modifiedFields.size > 0 || this.session.pendingSecrets.size > 0;
  }

  /**
   * Set a field value
   */
  set(path: string, value: string, options: SetOptions = {}): SetResult {
    const parsed = parseFieldPath(path);

    if (!parsed) {
      return {
        success: false,
        isSecret: false,
        error: `Invalid path: ${path}. Valid paths: enabled, command, cwd, args, args[N], env.KEY`,
      };
    }

    const transport = this.session.candidate.transport as StdioTransport;

    switch (parsed.field) {
      case 'enabled':
        return this.setEnabled(value);

      case 'command':
        return this.setCommand(value);

      case 'cwd':
        return this.setCwd(value);

      case 'args':
        if (parsed.index !== undefined) {
          return this.setArgsIndex(parsed.index, value);
        }
        return this.setArgs(value);

      case 'env':
        if (!parsed.key) {
          return {
            success: false,
            isSecret: false,
            error: 'env requires a key: env.KEY',
          };
        }
        return this.setEnv(parsed.key, value, options);

      default:
        return {
          success: false,
          isSecret: false,
          error: `Unknown field: ${parsed.field}`,
        };
    }
  }

  /**
   * Unset (remove) a field
   */
  unset(path: string): UnsetResult {
    const parsed = parseFieldPath(path);

    if (!parsed) {
      return {
        success: false,
        wasSecret: false,
        error: `Invalid path: ${path}`,
      };
    }

    const transport = this.session.candidate.transport as StdioTransport;

    switch (parsed.field) {
      case 'enabled':
        return {
          success: false,
          wasSecret: false,
          error: 'Cannot unset enabled (use "set enabled false" instead)',
        };

      case 'command':
        return {
          success: false,
          wasSecret: false,
          error: 'Cannot unset command (use "set command <value>" instead)',
        };

      case 'cwd':
        delete transport.cwd;
        this.session.modifiedFields.add('cwd');
        return { success: true, wasSecret: false, path: 'cwd' };

      case 'args':
        if (parsed.index !== undefined) {
          return this.unsetArgsIndex(parsed.index);
        }
        transport.args = [];
        this.session.modifiedFields.add('args');
        return { success: true, wasSecret: false, path: 'args' };

      case 'env':
        if (!parsed.key) {
          return {
            success: false,
            wasSecret: false,
            error: 'env requires a key: env.KEY',
          };
        }
        return this.unsetEnv(parsed.key);

      default:
        return {
          success: false,
          wasSecret: false,
          error: `Unknown field: ${parsed.field}`,
        };
    }
  }

  /**
   * Get the diff between original and candidate
   */
  getDiff(): ConnectorDiff {
    const diff: ConnectorDiff = {
      added: new Map(),
      removed: new Map(),
      modified: new Map(),
      hasChanges: false,
    };

    const original = this.session.original;
    const candidate = this.session.candidate;

    // Compare enabled
    if (original.enabled !== candidate.enabled) {
      diff.modified.set('enabled', { old: original.enabled, new: candidate.enabled });
      diff.hasChanges = true;
    }

    // Compare transport fields
    const origTransport = original.transport as StdioTransport;
    const candTransport = candidate.transport as StdioTransport;

    if (origTransport.command !== candTransport.command) {
      diff.modified.set('command', { old: origTransport.command, new: candTransport.command });
      diff.hasChanges = true;
    }

    if (origTransport.cwd !== candTransport.cwd) {
      if (origTransport.cwd && !candTransport.cwd) {
        diff.removed.set('cwd', origTransport.cwd);
      } else if (!origTransport.cwd && candTransport.cwd) {
        diff.added.set('cwd', candTransport.cwd);
      } else {
        diff.modified.set('cwd', { old: origTransport.cwd, new: candTransport.cwd });
      }
      diff.hasChanges = true;
    }

    // Compare args
    const origArgs = origTransport.args || [];
    const candArgs = candTransport.args || [];
    if (JSON.stringify(origArgs) !== JSON.stringify(candArgs)) {
      diff.modified.set('args', { old: origArgs, new: candArgs });
      diff.hasChanges = true;
    }

    // Compare env
    const origEnv = origTransport.env || {};
    const candEnv = candTransport.env || {};

    for (const key of Object.keys(candEnv)) {
      if (!(key in origEnv)) {
        diff.added.set(`env.${key}`, candEnv[key]);
        diff.hasChanges = true;
      } else if (origEnv[key] !== candEnv[key]) {
        diff.modified.set(`env.${key}`, { old: origEnv[key], new: candEnv[key] });
        diff.hasChanges = true;
      }
    }

    for (const key of Object.keys(origEnv)) {
      if (!(key in candEnv)) {
        diff.removed.set(`env.${key}`, origEnv[key]);
        diff.hasChanges = true;
      }
    }

    return diff;
  }

  /**
   * Finalize pending secrets (store them and replace with references)
   */
  async finalizeSecrets(configDir: string): Promise<Connector> {
    if (this.session.pendingSecrets.size === 0) {
      return this.session.candidate;
    }

    const store = new SqliteSecretStore(configDir);
    const transport = this.session.candidate.transport as StdioTransport;

    try {
      for (const [key, plaintext] of this.session.pendingSecrets) {
        // Store the secret and get reference
        const result = await store.store(plaintext, {
          connectorId: this.session.candidate.id,
          keyName: key,
        });

        // Replace in env with reference
        if (!transport.env) {
          transport.env = {};
        }
        transport.env[key] = result.reference;
      }

      // Clear pending secrets
      this.session.pendingSecrets.clear();
    } finally {
      store.close();
    }

    return this.session.candidate;
  }

  // Private helpers

  private setEnabled(value: string): SetResult {
    const lower = value.toLowerCase();
    if (lower !== 'true' && lower !== 'false') {
      return {
        success: false,
        isSecret: false,
        error: 'enabled must be "true" or "false"',
      };
    }

    this.session.candidate.enabled = lower === 'true';
    this.session.modifiedFields.add('enabled');

    return { success: true, isSecret: false, path: 'enabled' };
  }

  private setCommand(value: string): SetResult {
    const transport = this.session.candidate.transport as StdioTransport;
    transport.command = value;
    this.session.modifiedFields.add('command');

    return { success: true, isSecret: false, path: 'command' };
  }

  private setCwd(value: string): SetResult {
    const transport = this.session.candidate.transport as StdioTransport;
    transport.cwd = value;
    this.session.modifiedFields.add('cwd');

    return { success: true, isSecret: false, path: 'cwd' };
  }

  private setArgs(value: string): SetResult {
    const transport = this.session.candidate.transport as StdioTransport;

    // Parse quoted arguments: "arg1" "arg2" or simple space-separated
    const args = this.parseQuotedArgs(value);
    transport.args = args;
    this.session.modifiedFields.add('args');

    return { success: true, isSecret: false, path: 'args' };
  }

  private setArgsIndex(index: number, value: string): SetResult {
    const transport = this.session.candidate.transport as StdioTransport;

    if (!transport.args) {
      transport.args = [];
    }

    // Extend array if needed
    while (transport.args.length <= index) {
      transport.args.push('');
    }

    transport.args[index] = value;
    this.session.modifiedFields.add('args');

    return { success: true, isSecret: false, path: `args[${index}]` };
  }

  private unsetArgsIndex(index: number): UnsetResult {
    const transport = this.session.candidate.transport as StdioTransport;

    if (!transport.args || index >= transport.args.length) {
      return {
        success: false,
        wasSecret: false,
        error: `args[${index}] does not exist`,
      };
    }

    transport.args.splice(index, 1);
    this.session.modifiedFields.add('args');

    return { success: true, wasSecret: false, path: `args[${index}]` };
  }

  private setEnv(key: string, value: string, options: SetOptions): SetResult {
    const transport = this.session.candidate.transport as StdioTransport;

    if (!transport.env) {
      transport.env = {};
    }

    // Check if this should be a secret
    let isSecret = options.forceSecret ?? false;

    if (!isSecret && !options.interactive) {
      // Auto-detect if the key looks like a secret
      const detection = detectSecret(key, value);
      isSecret = detection.action === 'store';
    }

    if (isSecret) {
      // Store in pending secrets (will be finalized on commit)
      this.session.pendingSecrets.set(key, value);
      // Temporarily mark with placeholder
      transport.env[key] = `[secret pending: ${key}]`;
    } else {
      // Store directly
      transport.env[key] = value;
    }

    this.session.modifiedFields.add(`env.${key}`);

    return {
      success: true,
      isSecret,
      path: `env.${key}`,
    };
  }

  private unsetEnv(key: string): UnsetResult {
    const transport = this.session.candidate.transport as StdioTransport;

    if (!transport.env || !(key in transport.env)) {
      return {
        success: false,
        wasSecret: false,
        error: `env.${key} does not exist`,
      };
    }

    const wasSecret = isSecretRef(transport.env[key]) || this.session.pendingSecrets.has(key);

    delete transport.env[key];
    this.session.pendingSecrets.delete(key);
    this.session.modifiedFields.add(`env.${key}`);

    return { success: true, wasSecret, path: `env.${key}` };
  }

  /**
   * Parse a quoted argument string into an array
   * e.g., '"arg1" "arg2"' -> ['arg1', 'arg2']
   * e.g., 'arg1 arg2' -> ['arg1', 'arg2']
   */
  private parseQuotedArgs(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
          if (current) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuote = true;
          quoteChar = char;
        } else if (char === ' ' || char === '\t') {
          if (current) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }
}
