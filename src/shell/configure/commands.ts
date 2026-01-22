/**
 * Configure Mode Command Handlers
 *
 * Implements the command handlers for configure mode:
 * - edit connector <id>
 * - set <path> <value>
 * - unset <path>
 * - show
 * - commit [--dry-run] [--no-reload]
 * - discard
 * - exit
 */

import type { Connector, StdioTransport } from '../../types/config.js';
import type { SetOptions, ConnectorDiff } from './types.js';
import { ConfigureMode, CommitResult } from './mode.js';
import { isSecretRef } from '../../secrets/types.js';

/**
 * Result of processing a configure mode command
 */
export interface CommandResult {
  success: boolean;
  message?: string;
  output?: string[];
  error?: string;
  exitMode?: boolean;
  exitSession?: boolean;
  needsConfirmation?: 'exit' | 'discard';
}

/**
 * Parse and execute a configure mode command
 */
export async function processConfigureCommand(
  mode: ConfigureMode,
  line: string
): Promise<CommandResult> {
  const trimmed = line.trim();
  if (!trimmed) {
    return { success: true };
  }

  // Parse command and arguments
  const parts = parseCommandLine(trimmed);
  const command = parts[0]?.toLowerCase();

  switch (command) {
    case 'exit':
      return handleExit(mode);

    case 'edit':
      return handleEdit(mode, parts.slice(1));

    case 'set':
      return handleSet(mode, parts.slice(1));

    case 'unset':
      return handleUnset(mode, parts.slice(1));

    case 'show':
      return handleShow(mode, parts.slice(1));

    case 'commit':
      return handleCommit(mode, parts.slice(1));

    case 'discard':
      return handleDiscard(mode);

    case 'help':
    case '?':
      return handleHelp(mode);

    default:
      return {
        success: false,
        error: `Unknown command: ${command}. Type 'help' for available commands.`,
      };
  }
}

/**
 * Handle 'exit' command
 */
function handleExit(mode: ConfigureMode): CommandResult {
  if (mode.isEditing() && mode.isDirty()) {
    return {
      success: false,
      needsConfirmation: 'exit',
      message: 'You have unsaved changes. Use "commit" to save or "discard" to abandon changes.',
    };
  }

  if (mode.isEditing()) {
    mode.endEditSession();
    return {
      success: true,
      exitSession: true,
      message: 'Exited edit session.',
    };
  }

  mode.forceExit();
  return {
    success: true,
    exitMode: true,
    message: 'Exited configure mode.',
  };
}

/**
 * Handle 'edit connector <id>' command
 */
async function handleEdit(mode: ConfigureMode, args: string[]): Promise<CommandResult> {
  if (args.length < 2 || args[0].toLowerCase() !== 'connector') {
    return {
      success: false,
      error: 'Usage: edit connector <id>',
    };
  }

  const connectorId = args[1];

  // Check if already editing
  if (mode.isEditing()) {
    const current = mode.getCurrentConnector();
    if (current?.id === connectorId) {
      return {
        success: true,
        message: `Already editing connector '${connectorId}'.`,
      };
    }

    if (mode.isDirty()) {
      return {
        success: false,
        error: 'You have unsaved changes. Use "commit" or "discard" first.',
      };
    }

    mode.endEditSession();
  }

  try {
    const result = await mode.editConnector(connectorId);
    if (result.isNew) {
      return {
        success: true,
        message: `Creating new connector '${connectorId}'.`,
      };
    } else {
      return {
        success: true,
        message: `Editing connector '${connectorId}'.`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to edit connector: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle 'set <path> <value>' command
 */
function handleSet(mode: ConfigureMode, args: string[]): CommandResult {
  if (!mode.isEditing()) {
    return {
      success: false,
      error: 'No connector being edited. Use "edit connector <id>" first.',
    };
  }

  if (args.length < 2) {
    return {
      success: false,
      error: 'Usage: set <path> <value> [--secret]',
    };
  }

  const path = args[0];

  // Check for --secret flag
  const secretFlagIndex = args.findIndex(a => a === '--secret');
  const forceSecret = secretFlagIndex !== -1;

  // Get value (everything between path and --secret flag, or to the end)
  let valueArgs: string[];
  if (forceSecret && secretFlagIndex > 1) {
    valueArgs = args.slice(1, secretFlagIndex);
  } else if (forceSecret && secretFlagIndex === 1) {
    return {
      success: false,
      error: 'Value is required for set command.',
    };
  } else {
    valueArgs = args.slice(1).filter(a => a !== '--secret');
  }

  // Handle special @secret syntax for interactive input
  if (valueArgs.length === 1 && valueArgs[0] === '@secret') {
    return {
      success: false,
      error: 'Interactive secret input (@secret) is not yet supported. Use --secret flag with a value.',
    };
  }

  const value = valueArgs.join(' ');

  const options: SetOptions = {
    forceSecret,
  };

  const manager = mode.getSessionManager();
  if (!manager) {
    return {
      success: false,
      error: 'No active session manager.',
    };
  }

  const result = manager.set(path, value, options);

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Set operation failed.',
    };
  }

  const secretMsg = result.isSecret ? ' (secret - will be stored securely on commit)' : '';
  return {
    success: true,
    message: `Set ${result.path}${secretMsg}`,
  };
}

/**
 * Handle 'unset <path>' command
 */
function handleUnset(mode: ConfigureMode, args: string[]): CommandResult {
  if (!mode.isEditing()) {
    return {
      success: false,
      error: 'No connector being edited. Use "edit connector <id>" first.',
    };
  }

  if (args.length < 1) {
    return {
      success: false,
      error: 'Usage: unset <path>',
    };
  }

  const path = args[0];
  const manager = mode.getSessionManager();

  if (!manager) {
    return {
      success: false,
      error: 'No active session manager.',
    };
  }

  const result = manager.unset(path);

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Unset operation failed.',
    };
  }

  const secretMsg = result.wasSecret ? ' (was a secret)' : '';
  return {
    success: true,
    message: `Unset ${result.path}${secretMsg}`,
  };
}

/**
 * Handle 'show' command
 */
function handleShow(mode: ConfigureMode, args: string[]): CommandResult {
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === 'candidate-config') {
    // Show full candidate config
    const session = mode.getSession();
    if (!session) {
      return {
        success: false,
        error: 'No connector being edited.',
      };
    }

    const output = formatConnector(session.candidate, session.pendingSecrets);
    return {
      success: true,
      output,
    };
  }

  if (subcommand === 'diff') {
    // Show diff between original and candidate
    const manager = mode.getSessionManager();
    if (!manager) {
      return {
        success: false,
        error: 'No connector being edited.',
      };
    }

    const session = mode.getSession()!;
    const diff = manager.getDiff();
    const output = formatDiff(diff, session.pendingSecrets);
    return {
      success: true,
      output,
    };
  }

  // Default: show current candidate
  if (!mode.isEditing()) {
    return {
      success: false,
      error: 'No connector being edited. Use "edit connector <id>" first.',
    };
  }

  const session = mode.getSession()!;
  const output = formatConnector(session.candidate, session.pendingSecrets);
  return {
    success: true,
    output,
  };
}

/**
 * Handle 'commit' command
 */
async function handleCommit(mode: ConfigureMode, args: string[]): Promise<CommandResult> {
  if (!mode.isEditing()) {
    return {
      success: false,
      error: 'No connector being edited. Use "edit connector <id>" first.',
    };
  }

  const dryRun = args.includes('--dry-run');
  const noReload = args.includes('--no-reload');

  // Show diff first if dry-run
  if (dryRun) {
    const manager = mode.getSessionManager()!;
    const session = mode.getSession()!;
    const diff = manager.getDiff();

    if (!diff.hasChanges && session.pendingSecrets.size === 0) {
      return {
        success: true,
        message: 'No changes to commit.',
      };
    }

    const output = [
      'Changes to be committed (dry-run):',
      '',
      ...formatDiff(diff, session.pendingSecrets),
    ];

    return {
      success: true,
      output,
    };
  }

  const result = await mode.commit({ dryRun, noReload });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Commit failed.',
    };
  }

  const output: string[] = [];
  output.push('Committed candidate-config -> running-config.');

  if (result.secretsStored > 0) {
    output.push(`Stored ${result.secretsStored} secret(s).`);
  }

  if (result.proxyReloaded) {
    output.push('Proxy reloaded.');
  } else if (result.message) {
    output.push(result.message);
  }

  return {
    success: true,
    output,
    exitSession: true,
  };
}

/**
 * Handle 'discard' command
 */
function handleDiscard(mode: ConfigureMode): CommandResult {
  if (!mode.isEditing()) {
    return {
      success: false,
      error: 'No connector being edited.',
    };
  }

  const result = mode.discard();

  return {
    success: true,
    message: result.hadChanges
      ? 'Discarded changes.'
      : 'No changes to discard.',
    exitSession: true,
  };
}

/**
 * Handle 'help' command
 */
function handleHelp(mode: ConfigureMode): CommandResult {
  const output: string[] = [];

  if (mode.isEditing()) {
    output.push('Configure Mode Commands (editing connector):');
    output.push('');
    output.push('  set <path> <value>    Set a field value');
    output.push('  set <path> <value> --secret  Force value as secret');
    output.push('  unset <path>          Remove a field');
    output.push('  show                  Show current connector config');
    output.push('  show diff             Show changes from original');
    output.push('  commit                Save changes and reload proxy');
    output.push('  commit --dry-run      Show changes without saving');
    output.push('  commit --no-reload    Save without reloading proxy');
    output.push('  discard               Discard all changes');
    output.push('  exit                  Exit edit session');
    output.push('');
    output.push('Field paths:');
    output.push('  enabled               true/false');
    output.push('  command               Executable command');
    output.push('  cwd                   Working directory');
    output.push('  args                  Arguments (space-separated or quoted)');
    output.push('  args[N]               Single argument at index N');
    output.push('  env.KEY               Environment variable');
  } else {
    output.push('Configure Mode Commands:');
    output.push('');
    output.push('  edit connector <id>   Start editing a connector');
    output.push('  exit                  Exit configure mode');
    output.push('  help                  Show this help');
  }

  return {
    success: true,
    output,
  };
}

/**
 * Format a connector for display
 */
function formatConnector(
  connector: Connector,
  pendingSecrets: Map<string, string>
): string[] {
  const output: string[] = [];
  const transport = connector.transport as StdioTransport;

  output.push(`Connector: ${connector.id}`);
  output.push(`  enabled: ${connector.enabled}`);
  output.push(`  command: ${transport.command || '(not set)'}`);

  if (transport.cwd) {
    output.push(`  cwd: ${transport.cwd}`);
  }

  if (transport.args && transport.args.length > 0) {
    output.push(`  args:`);
    for (let i = 0; i < transport.args.length; i++) {
      output.push(`    [${i}] ${transport.args[i]}`);
    }
  }

  if (transport.env && Object.keys(transport.env).length > 0) {
    output.push(`  env:`);
    for (const [key, value] of Object.entries(transport.env)) {
      const displayValue = formatEnvValue(key, value, pendingSecrets);
      output.push(`    ${key}=${displayValue}`);
    }
  }

  return output;
}

/**
 * Format an env value, masking secrets
 */
function formatEnvValue(
  key: string,
  value: string,
  pendingSecrets: Map<string, string>
): string {
  if (pendingSecrets.has(key)) {
    return '[secret pending]';
  }

  if (isSecretRef(value)) {
    return '[secret]';
  }

  return value;
}

/**
 * Format a diff for display
 */
function formatDiff(
  diff: ConnectorDiff,
  pendingSecrets: Map<string, string>
): string[] {
  const output: string[] = [];

  if (!diff.hasChanges && pendingSecrets.size === 0) {
    output.push('No changes.');
    return output;
  }

  // Added fields
  for (const [path, value] of diff.added) {
    const displayValue = formatDiffValue(path, value, pendingSecrets);
    output.push(`+ ${path}: ${displayValue}`);
  }

  // Modified fields
  for (const [path, { old: oldValue, new: newValue }] of diff.modified) {
    const oldDisplay = formatDiffValue(path, oldValue, pendingSecrets);
    const newDisplay = formatDiffValue(path, newValue, pendingSecrets);
    output.push(`~ ${path}: ${oldDisplay} -> ${newDisplay}`);
  }

  // Removed fields
  for (const [path, value] of diff.removed) {
    const displayValue = formatDiffValue(path, value, pendingSecrets);
    output.push(`- ${path}: ${displayValue}`);
  }

  // Pending secrets (not yet in diff as they're marked as placeholders)
  for (const key of pendingSecrets.keys()) {
    if (!diff.modified.has(`env.${key}`) && !diff.added.has(`env.${key}`)) {
      output.push(`+ env.${key}: [secret pending]`);
    }
  }

  return output;
}

/**
 * Format a diff value
 */
function formatDiffValue(
  path: string,
  value: unknown,
  pendingSecrets: Map<string, string>
): string {
  // Check for pending secrets
  if (path.startsWith('env.')) {
    const key = path.slice(4);
    if (pendingSecrets.has(key)) {
      return '[secret pending]';
    }

    if (typeof value === 'string' && isSecretRef(value)) {
      return '[secret]';
    }
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value.toString();
  }

  if (value === undefined) {
    return '(not set)';
  }

  return String(value);
}

/**
 * Parse a command line into parts, respecting quotes
 */
function parseCommandLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
        if (current) {
          parts.push(current);
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
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
