/**
 * Context Applicator - applies shell context to command arguments
 *
 * This module ensures that the current connector/session context
 * is correctly injected into command arguments before execution.
 */

import type { ShellContext } from './types.js';

/**
 * Result of applying context to command arguments
 */
export interface ApplyContextResult {
  args: string[];
  warnings: string[];
}

/**
 * Boolean flags that don't take values
 */
const BOOLEAN_FLAGS = new Set([
  '--json',
  '--verbose',
  '-v',
  '--help',
  '-h',
  '--errors',
  '--fulltime',
  '--full-time',
  '--time-full',
  '--with-sessions',
  '--pairs',
  '--pair',
  '--sessions',
  '--rpc',
  '--rpc-all',
  '--compact',
  '--ids-only',
  '--dry-run',
  '--stdin',
  '-f',
  '--follow',
  '-l',
  // HTML export options
  '--html',
  '--open',
  '--redact',
  '--spill',
]);

/**
 * Check if a flag is a boolean flag (doesn't take a value)
 */
function isBooleanFlag(flag: string): boolean {
  return BOOLEAN_FLAGS.has(flag);
}

/**
 * Check if args already contain a specific option
 */
function hasOption(args: string[], ...optionNames: string[]): boolean {
  return optionNames.some(opt => args.includes(opt));
}

/**
 * Check if args have a positional argument at given position (0-indexed from command)
 * Positional = non-option argument (doesn't start with -)
 */
function hasPositionalAt(args: string[], position: number): boolean {
  let positionalCount = 0;
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith('-')) {
      if (positionalCount === position) {
        return true;
      }
      positionalCount++;
    } else {
      // Only skip next arg if this is a value-taking option
      // Boolean flags don't consume the next argument
      // Also check bounds before incrementing to avoid accessing past array end
      if (!isBooleanFlag(args[i]) && i + 1 < args.length) {
        i++;
      }
    }
  }
  return false;
}

/**
 * Get positional argument at given position
 */
function getPositionalAt(args: string[], position: number): string | undefined {
  let positionalCount = 0;
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith('-')) {
      if (positionalCount === position) {
        return args[i];
      }
      positionalCount++;
    } else {
      // Only skip next arg if this is a value-taking option
      // Also check bounds before incrementing to avoid accessing past array end
      if (!isBooleanFlag(args[i]) && i + 1 < args.length) {
        i++;
      }
    }
  }
  return undefined;
}

/**
 * Apply context to command arguments
 *
 * This function injects --connector, --session, --id options based on
 * the current shell context and the command being executed.
 */
export function applyContext(
  tokens: string[],
  context: ShellContext
): ApplyContextResult {
  const args = [...tokens];
  const warnings: string[] = [];
  const command = tokens[0];
  const subcommand = tokens[1];

  // === VIEW / V ===
  // - `view <connector>` -> `view --connector <connector>`
  // - Add --connector from context if not specified
  // - Add --session from context if not specified
  if (command === 'view' || command === 'v') {
    // Handle positional connector: `view yfinance` -> `view --connector yfinance`
    const positional = getPositionalAt(args, 0);
    if (positional && !hasOption(args, '--connector')) {
      // Remove positional and add as --connector
      const idx = args.indexOf(positional);
      args.splice(idx, 1);
      args.push('--connector', positional);
    }

    // Add --connector from context if not specified
    if (context.connector && !hasOption(args, '--connector')) {
      args.push('--connector', context.connector);
    }

    // Add --session from context if not specified
    if (context.session && !hasOption(args, '--session')) {
      args.push('--session', context.session);
    }
  }

  // === TREE / T ===
  // - Add --connector from context (tree uses positional connector)
  if (command === 'tree' || command === 't') {
    // tree takes positional connector, but we can also set context
    // Only add if no positional argument
    if (context.connector && !hasPositionalAt(args, 0) && !hasOption(args, '--connector')) {
      // Insert connector as positional argument after command
      args.splice(1, 0, context.connector);
    }

    // Add --session from context for tree
    if (context.session && !hasOption(args, '--session')) {
      args.push('--session', context.session);
    }
  }

  // === SCAN / S ===
  // - `scan start` needs --id from context
  // - `scan start <connector>` is positional
  if (command === 'scan' || command === 's') {
    if (subcommand === 'start' || (!subcommand?.startsWith('-') && tokens.length === 1)) {
      // `scan start` or just `scan` (which becomes `scan start`)
      const hasStartSubcmd = subcommand === 'start';
      const positionalIdx = hasStartSubcmd ? 1 : 0;

      // Check for positional connector after 'start'
      const hasPositionalConnector = hasPositionalAt(args, positionalIdx);

      if (!hasPositionalConnector && !hasOption(args, '--id') && context.connector) {
        args.push('--id', context.connector);
      }
    }
  }

  // === SESSIONS SHOW ===
  // - `sessions show` needs --id from context.session
  if (command === 'sessions' && subcommand === 'show') {
    if (!hasOption(args, '--id') && context.session) {
      args.push('--id', context.session);
    } else if (!hasOption(args, '--id') && !context.session) {
      warnings.push('No session in context. Try: cc <connector>|<session>');
    }
  }

  // === RPC LIST / RPC SHOW ===
  // - Both need --session from context
  if (command === 'rpc') {
    if (!hasOption(args, '--session') && context.session) {
      args.push('--session', context.session);
    } else if (!hasOption(args, '--session') && !context.session) {
      warnings.push('No session in context. Try: cc <connector>|<session>');
    }
  }

  // === SUMMARY ===
  // - Needs --session from context
  if (command === 'summary') {
    if (!hasOption(args, '--session') && context.session) {
      args.push('--session', context.session);
    } else if (!hasOption(args, '--session') && !context.session) {
      warnings.push('No session in context. Try: cc <connector>|<session>');
    }
  }

  // === PERMISSIONS ===
  // - Needs --session from context
  if (command === 'permissions') {
    if (!hasOption(args, '--session') && context.session) {
      args.push('--session', context.session);
    } else if (!hasOption(args, '--session') && !context.session) {
      warnings.push('No session in context. Try: cc <connector>|<session>');
    }
  }

  // === EVENTS ===
  // - Can use --session from context
  if (command === 'events') {
    if (!hasOption(args, '--session') && context.session) {
      args.push('--session', context.session);
    }
  }

  // === CONNECTORS SHOW ===
  // - `connectors show` needs --id from context.connector
  if ((command === 'connectors' || command === 'connector') && subcommand === 'show') {
    if (!hasOption(args, '--id') && context.connector) {
      args.push('--id', context.connector);
    }
  }

  // === PLANS RUN ===
  // - `plans run <name>` needs --connector from context
  if (command === 'plans' && subcommand === 'run') {
    if (!hasOption(args, '--connector') && context.connector) {
      args.push('--connector', context.connector);
    }
  }

  return { args, warnings };
}

/**
 * Generate context-aware hint message
 */
export function getContextHint(context: ShellContext): string {
  if (!context.connector && !context.session) {
    return 'Try: cc <connector> or cc <connector>|<session>';
  }
  if (context.connector && !context.session) {
    return `Try: cc <session> or ls (list sessions for ${context.connector})`;
  }
  return '';
}
