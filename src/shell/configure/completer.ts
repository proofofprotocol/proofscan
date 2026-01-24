/**
 * Configure Mode TAB Completion
 *
 * Provides command, field path, and value completion for configure mode.
 */

import type { ConfigureMode } from './mode.js';
import type { Connector, StdioTransport, HttpTransport, SseTransport } from '../../types/config.js';

/**
 * Data provider for configure mode completions
 */
export interface ConfigureDataProvider {
  getConnectorIds: () => string[];
}

/**
 * Configure mode commands by context
 */
const ROOT_COMMANDS = [
  'connector',      // IOS-style shortcut: connector <id>
  'edit',           // edit connector <id>
  'ls',             // List all connectors
  'exit',           // Exit configure mode
  'help',
];

const EDIT_SESSION_COMMANDS = [
  'set',            // set <path> <value>
  'unset',          // unset <path>
  'show',           // Show current connector
  'commit',         // Save changes
  'discard',        // Discard changes
  'exit',           // Exit edit session
  'help',
];

/**
 * Field paths available for set/unset commands
 */
const FIELD_PATHS = [
  'enabled',
  'command',
  'cwd',
  'args',
  'args[0]',
  'args[1]',
  'args[2]',
  // env.* is dynamic, handled separately
];

/**
 * Common environment variable names for suggestions
 */
const COMMON_ENV_VARS = [
  'env.PATH',
  'env.HOME',
  'env.USER',
  'env.NODE_ENV',
  'env.DEBUG',
  'env.API_KEY',
  'env.OPENAI_API_KEY',
  'env.ANTHROPIC_API_KEY',
  'env.GITHUB_TOKEN',
];

/**
 * Options for various commands
 */
const COMMAND_OPTIONS: Record<string, string[]> = {
  'set': ['--secret'],
  'show': ['--json', 'candidate-config', 'diff'],
  'commit': ['--dry-run', '--no-reload'],
  'ls': ['--detail'],
};

/**
 * Parse input line into tokens (same logic as commands.ts)
 */
function tokenize(line: string): string[] {
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

/**
 * Get completions for configure mode
 */
export function getConfigureCompletions(
  line: string,
  mode: ConfigureMode,
  dataProvider: ConfigureDataProvider
): [string[], string] {
  const tokens = tokenize(line);
  const isNewToken = line.endsWith(' ') || tokens.length === 0;
  const currentToken = isNewToken ? '' : (tokens[tokens.length - 1] || '');
  const completedTokens = isNewToken ? tokens : tokens.slice(0, -1);

  // Get candidates based on context
  const candidates = getCandidates(completedTokens, currentToken, mode, dataProvider);

  // Filter by prefix
  const matches = candidates.filter(c =>
    c.toLowerCase().startsWith(currentToken.toLowerCase())
  );

  return [matches, currentToken];
}

/**
 * Get candidate completions based on tokens and mode state
 */
function getCandidates(
  completedTokens: string[],
  currentToken: string,
  mode: ConfigureMode,
  dataProvider: ConfigureDataProvider
): string[] {
  const isEditing = mode.isEditing();

  // No tokens yet - complete commands
  if (completedTokens.length === 0) {
    if (isEditing) {
      return EDIT_SESSION_COMMANDS;
    }
    return ROOT_COMMANDS;
  }

  const firstToken = completedTokens[0].toLowerCase();

  // Handle specific commands
  switch (firstToken) {
    case 'connector':
      // connector <id>
      if (completedTokens.length === 1) {
        return dataProvider.getConnectorIds();
      }
      return [];

    case 'edit':
      // edit connector <id>
      if (completedTokens.length === 1) {
        return ['connector'];
      }
      if (completedTokens.length === 2 && completedTokens[1].toLowerCase() === 'connector') {
        return dataProvider.getConnectorIds();
      }
      return [];

    case 'set':
      return getSetCompletions(completedTokens, currentToken, mode);

    case 'unset':
      return getUnsetCompletions(completedTokens, currentToken, mode);

    case 'show':
      return getShowCompletions(completedTokens);

    case 'commit':
      return getCommitCompletions(completedTokens);

    case 'ls':
      return getLsCompletions(completedTokens);

    case 'help':
      // help <command>
      if (completedTokens.length === 1) {
        return isEditing ? EDIT_SESSION_COMMANDS : ROOT_COMMANDS;
      }
      return [];

    default:
      return [];
  }
}

/**
 * Get completions for 'set' command
 * set <path> <value> [--secret]
 */
function getSetCompletions(
  completedTokens: string[],
  currentToken: string,
  mode: ConfigureMode
): string[] {
  // set <path>
  if (completedTokens.length === 1) {
    return getFieldPathCompletions(currentToken, mode);
  }

  const path = completedTokens[1];

  // set <path> <value>
  if (completedTokens.length === 2) {
    return getValueCompletions(path, mode);
  }

  // set <path> <value> [--secret]
  // Check if --secret was already used
  if (!completedTokens.includes('--secret')) {
    return ['--secret'];
  }

  return [];
}

/**
 * Get completions for 'unset' command
 * unset <path>
 */
function getUnsetCompletions(
  completedTokens: string[],
  currentToken: string,
  mode: ConfigureMode
): string[] {
  // unset <path>
  if (completedTokens.length === 1) {
    // Only suggest fields that are currently set
    return getSetFieldPaths(mode);
  }

  return [];
}

/**
 * Get completions for 'show' command
 */
function getShowCompletions(completedTokens: string[]): string[] {
  if (completedTokens.length === 1) {
    return COMMAND_OPTIONS['show'] || [];
  }
  return [];
}

/**
 * Get completions for 'commit' command
 */
function getCommitCompletions(completedTokens: string[]): string[] {
  const usedOptions = completedTokens.slice(1);
  const availableOptions = (COMMAND_OPTIONS['commit'] || [])
    .filter(opt => !usedOptions.includes(opt));
  return availableOptions;
}

/**
 * Get completions for 'ls' command in configure mode
 */
function getLsCompletions(completedTokens: string[]): string[] {
  if (completedTokens.length === 1) {
    return COMMAND_OPTIONS['ls'] || [];
  }
  return [];
}

/**
 * Get field path completions for set command
 */
function getFieldPathCompletions(currentToken: string, mode: ConfigureMode): string[] {
  const candidates: string[] = [...FIELD_PATHS];

  // Add common env vars
  candidates.push(...COMMON_ENV_VARS);

  // If editing, add current connector's env keys
  const connector = mode.getCurrentConnector();
  if (connector) {
    const transport = connector.transport as StdioTransport;
    if (transport.env) {
      for (const key of Object.keys(transport.env)) {
        const envPath = `env.${key}`;
        if (!candidates.includes(envPath)) {
          candidates.push(envPath);
        }
      }
    }

    // Add actual args indices
    if (transport.args && transport.args.length > 0) {
      for (let i = 0; i < transport.args.length; i++) {
        const argsPath = `args[${i}]`;
        if (!candidates.includes(argsPath)) {
          candidates.push(argsPath);
        }
      }
      // Suggest next index for adding
      const nextPath = `args[${transport.args.length}]`;
      if (!candidates.includes(nextPath)) {
        candidates.push(nextPath);
      }
    }
  }

  // If typing "env.", show custom key option
  if (currentToken.startsWith('env.')) {
    const existingEnvPaths = candidates.filter(c => c.startsWith('env.'));
    return existingEnvPaths;
  }

  return candidates;
}

/**
 * Get value completions based on field path
 */
function getValueCompletions(path: string, mode: ConfigureMode): string[] {
  const lowerPath = path.toLowerCase();

  // enabled: true/false
  if (lowerPath === 'enabled') {
    return ['true', 'false'];
  }

  // command: suggest common commands
  if (lowerPath === 'command') {
    return [
      'npx',
      'uvx',
      'node',
      'python',
      'python3',
      'deno',
      'bun',
    ];
  }

  // cwd: suggest some common patterns
  if (lowerPath === 'cwd') {
    return [
      '.',
      '..',
      '~',
      '/tmp',
    ];
  }

  // For env.* paths, suggest --secret if it looks like a secret key
  if (lowerPath.startsWith('env.')) {
    const key = path.slice(4).toUpperCase();
    const secretPatterns = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'AUTH'];
    if (secretPatterns.some(p => key.includes(p))) {
      return ['--secret']; // Hint to use --secret
    }
  }

  return [];
}

/**
 * Get field paths that are currently set (for unset completion)
 */
function getSetFieldPaths(mode: ConfigureMode): string[] {
  const connector = mode.getCurrentConnector();
  if (!connector) {
    return [];
  }

  const paths: string[] = [];
  const transport = connector.transport as StdioTransport;

  // Always-set fields that can't be unset
  // enabled and command are required - don't suggest them for unset

  // cwd is optional
  if (transport.cwd) {
    paths.push('cwd');
  }

  // args
  if (transport.args && transport.args.length > 0) {
    paths.push('args'); // Clear all args
    for (let i = 0; i < transport.args.length; i++) {
      paths.push(`args[${i}]`);
    }
  }

  // env
  if (transport.env) {
    for (const key of Object.keys(transport.env)) {
      paths.push(`env.${key}`);
    }
  }

  return paths;
}

/**
 * Create a readline-compatible completer function for configure mode
 */
export function createConfigureCompleter(
  mode: ConfigureMode,
  dataProvider: ConfigureDataProvider
): (line: string) => [string[], string] {
  return (line: string) => getConfigureCompletions(line, mode, dataProvider);
}
