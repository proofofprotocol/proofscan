/**
 * Shell TAB completion
 */

import type { ShellContext } from './types.js';
import {
  COMMAND_SUBCOMMANDS,
  COMMAND_OPTIONS,
  COMMON_OPTIONS,
  SHELL_BUILTINS,
  ROUTER_COMMANDS,
  BLOCKED_IN_SHELL,
  DEFAULT_COMPLETION_LIMIT,
  getAllowedCommands,
} from './types.js';

export type DynamicDataProvider = {
  getConnectorIds: () => string[];
  getSessionPrefixes: (connectorId?: string, limit?: number) => string[];
  getRpcIds: (sessionId?: string) => string[];
};

/**
 * Parse input line into tokens
 */
function tokenize(line: string): string[] {
  // Simple tokenization by whitespace
  return line.trim().split(/\s+/).filter(t => t !== '');
}

/**
 * Get completions for the current input
 */
export function getCompletions(
  line: string,
  context: ShellContext,
  dataProvider: DynamicDataProvider
): [string[], string] {
  const tokens = tokenize(line);
  const currentToken = tokens.length > 0 ? tokens[tokens.length - 1] : '';
  const isNewToken = line.endsWith(' ') || tokens.length === 0;

  // If line ends with space, we're completing a new token
  const tokenToComplete = isNewToken ? '' : currentToken;
  const completedTokens = isNewToken ? tokens : tokens.slice(0, -1);

  // Determine what to complete based on context
  const candidates = getCandidates(completedTokens, tokenToComplete, context, dataProvider);

  // Filter candidates by prefix
  const matches = candidates.filter(c => c.startsWith(tokenToComplete));

  return [matches, tokenToComplete];
}

/**
 * Get candidate completions based on parsed tokens
 */
function getCandidates(
  completedTokens: string[],
  currentToken: string,
  context: ShellContext,
  dataProvider: DynamicDataProvider
): string[] {
  // No tokens yet - complete top-level commands + builtins + router commands (excluding blocked commands)
  if (completedTokens.length === 0) {
    return [...SHELL_BUILTINS, ...ROUTER_COMMANDS, ...getAllowedCommands()];
  }

  const firstToken = completedTokens[0];

  // Handle router-style commands (cd, cc, ls, show, ..)
  if (ROUTER_COMMANDS.includes(firstToken)) {
    return getRouterCompletions(firstToken, completedTokens, currentToken, context, dataProvider);
  }

  // Handle shell builtins
  if (SHELL_BUILTINS.includes(firstToken)) {
    return getBuiltinCompletions(firstToken, completedTokens, currentToken, context, dataProvider);
  }

  // Handle command completions
  return getCommandCompletions(completedTokens, currentToken, context, dataProvider);
}

/**
 * Get context level for completion
 *
 * Context hierarchy (most specific to least):
 * - session: A specific session is selected (implies connector is also set)
 * - connector: A connector is selected, but no specific session
 * - root: No connector or session selected (top-level view)
 *
 * @param context - Current shell context with optional connector/session
 * @returns The current context level
 */
function getContextLevel(context: ShellContext): 'root' | 'connector' | 'session' {
  if (context.session) return 'session';
  if (context.connector) return 'connector';
  return 'root';
}

/**
 * Get completions for router-style commands (cd, cc, ls, show, ..)
 */
function getRouterCompletions(
  command: string,
  tokens: string[],
  _currentToken: string,
  context: ShellContext,
  dataProvider: DynamicDataProvider
): string[] {
  const level = getContextLevel(context);

  switch (command) {
    case 'cd':
    case 'cc':
      // cd/cc expects context-aware targets
      if (tokens.length === 1) {
        // Navigation shortcuts
        const candidates = ['/', '..', '-'];

        if (level === 'root') {
          // At root: complete connector ids
          candidates.push(...dataProvider.getConnectorIds());
        } else if (level === 'connector' || level === 'session') {
          // At connector/session: complete session prefixes (within current connector)
          candidates.push(...dataProvider.getSessionPrefixes(context.connector, DEFAULT_COMPLETION_LIMIT));
        }

        return candidates;
      }
      return [];

    case 'ls':
      // ls has limited options
      if (tokens.length === 1) {
        return ['-l', '--long', '--json', '--ids'];
      }
      return [];

    case 'show':
      // show expects context-aware targets
      if (tokens.length === 1) {
        const candidates = ['--json'];

        if (level === 'root') {
          // At root: show <connector>
          candidates.push(...dataProvider.getConnectorIds());
        } else if (level === 'connector') {
          // At connector: show <session>
          candidates.push(...dataProvider.getSessionPrefixes(context.connector, DEFAULT_COMPLETION_LIMIT));
        } else if (level === 'session') {
          // At session: show <rpcId>
          candidates.push(...dataProvider.getRpcIds(context.session));
        }

        return candidates;
      }
      return [];

    case '..':
      // No completions for ..
      return [];

    default:
      return [];
  }
}

/**
 * Get completions for shell builtins
 */
function getBuiltinCompletions(
  command: string,
  tokens: string[],
  _currentToken: string,
  _context: ShellContext,
  dataProvider: DynamicDataProvider
): string[] {
  switch (command) {
    case 'use':
      if (tokens.length === 1) {
        // `use <connector>` or `use session`
        return ['session', ...dataProvider.getConnectorIds()];
      }
      if (tokens.length === 2 && tokens[1] === 'session') {
        // `use session <sessionPrefix>`
        return dataProvider.getSessionPrefixes(undefined, DEFAULT_COMPLETION_LIMIT);
      }
      return [];

    case 'help':
      if (tokens.length === 1) {
        return [...SHELL_BUILTINS, ...ROUTER_COMMANDS, ...getAllowedCommands()];
      }
      return [];

    default:
      return [];
  }
}

/**
 * Get completions for regular commands
 */
function getCommandCompletions(
  tokens: string[],
  currentToken: string,
  context: ShellContext,
  dataProvider: DynamicDataProvider
): string[] {
  const firstToken = tokens[0];
  const candidates: string[] = [];

  // Check if this command has subcommands
  const subcommands = COMMAND_SUBCOMMANDS[firstToken];
  if (subcommands && tokens.length === 1) {
    candidates.push(...subcommands);
  }

  // Get options for the command
  const commandKey = tokens.slice(0, 2).join(' ');
  const options = COMMAND_OPTIONS[commandKey] || COMMAND_OPTIONS[firstToken] || [];
  candidates.push(...options, ...COMMON_OPTIONS);

  // Check if we're completing an option value
  const prevToken = tokens[tokens.length - 1];
  if (prevToken) {
    // --id expects connector id for certain commands
    if (prevToken === '--id') {
      if (['scan', 's', 'connectors', 'connector'].includes(firstToken)) {
        return dataProvider.getConnectorIds();
      }
      if (['rpc'].includes(firstToken)) {
        return dataProvider.getRpcIds(context.session);
      }
    }

    // --session expects session prefix
    if (prevToken === '--session') {
      return dataProvider.getSessionPrefixes(context.connector, DEFAULT_COMPLETION_LIMIT);
    }

    // --connector expects connector id
    if (prevToken === '--connector') {
      return dataProvider.getConnectorIds();
    }

    // --status expects ok/err/all
    if (prevToken === '--status') {
      return ['ok', 'err', 'all'];
    }

    // --format expects format options
    if (prevToken === '--format') {
      return ['json', 'yaml', 'table'];
    }

    // --from expects import format
    if (prevToken === '--from') {
      return ['mcpServers'];
    }
  }

  // For scan start without --id, suggest connector ids as positional
  if (tokens.length >= 2 && (firstToken === 'scan' || firstToken === 's') && tokens[1] === 'start') {
    if (!tokens.includes('--id') && !currentToken.startsWith('-')) {
      candidates.push(...dataProvider.getConnectorIds());
    }
  }

  // For tree command, suggest connector ids as positional argument
  if ((firstToken === 'tree' || firstToken === 't') && tokens.length === 1) {
    if (!currentToken.startsWith('-')) {
      candidates.push(...dataProvider.getConnectorIds());
    }
  }

  // For view command, suggest connector ids as positional argument
  if ((firstToken === 'view' || firstToken === 'v') && tokens.length === 1) {
    if (!currentToken.startsWith('-')) {
      candidates.push(...dataProvider.getConnectorIds());
    }
  }

  return [...new Set(candidates)]; // Deduplicate
}

/**
 * Create a readline completer function
 */
export function createCompleter(
  context: ShellContext,
  dataProvider: DynamicDataProvider
): (line: string) => [string[], string] {
  return (line: string) => getCompletions(line, context, dataProvider);
}
