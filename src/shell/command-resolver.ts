/**
 * Shell command resolver - Cisco-style unique prefix matching & context expansion
 */

import type { ShellContext } from './types.js';
import {
  TOP_LEVEL_COMMANDS,
  COMMAND_SUBCOMMANDS,
  CONNECTORS_SUBCOMMANDS,
  SHELL_BUILTINS,
  ROUTER_COMMANDS,
  TOOL_COMMANDS,
  REF_COMMANDS,
  INSCRIBE_COMMANDS,
} from './types.js';

export interface ResolveResult {
  success: boolean;
  resolved: string[];        // Normalized token array
  original: string[];        // Original token array
  error?: string;
  candidates?: string[];     // Candidates when ambiguous
}

/**
 * Unique prefix matching
 * @returns matched string if unique, null if no match, array if ambiguous
 */
function matchUniquePrefix(
  input: string,
  candidates: readonly string[]
): string | null | string[] {
  // Exact match first
  if (candidates.includes(input)) {
    return input;
  }

  const matches = candidates.filter(c => c.startsWith(input));

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches; // Ambiguous
}

/**
 * Get context level from shell context
 */
function getContextPath(context: ShellContext): 'root' | 'connector' | 'session' {
  if (context.session) return 'session';
  if (context.connector) return 'connector';
  return 'root';
}

/**
 * All commands that should NOT go through prefix matching
 * These are handled directly by the shell
 */
const PASSTHROUGH_COMMANDS = [
  ...SHELL_BUILTINS,
  ...ROUTER_COMMANDS,
  ...TOOL_COMMANDS,
  ...REF_COMMANDS,
  ...INSCRIBE_COMMANDS,
];

/**
 * Resolve command with prefix matching and context expansion
 *
 * Features:
 * 1. Cisco-style unique prefix matching (e.g., "conn ls" → "connectors ls")
 * 2. Context expansion at ROOT level only (e.g., "delete foo" → "connectors delete foo")
 * 3. Ambiguity detection with candidate suggestions
 */
export function resolveCommand(
  tokens: string[],
  context: ShellContext
): ResolveResult {
  if (tokens.length === 0) {
    return { success: true, resolved: [], original: [] };
  }

  const original = [...tokens];
  const resolved: string[] = [];
  const contextPath = getContextPath(context);

  let workingTokens = [...tokens];
  let firstToken = workingTokens[0];

  // --- Passthrough commands (builtins, router, tool, ref, inscribe) ---
  // These are handled directly without prefix matching
  if (PASSTHROUGH_COMMANDS.includes(firstToken)) {
    return { success: true, resolved: tokens, original };
  }

  // --- Context expansion ---
  // At ROOT level ONLY, allow connectors subcommands without prefix
  // NOT inside connector context (to avoid ambiguity with ls, show, etc.)
  const isConnectorsSubcommand = (CONNECTORS_SUBCOMMANDS as readonly string[]).includes(firstToken);

  if (contextPath === 'root' && isConnectorsSubcommand) {
    // Expand: "delete foo" → "connectors delete foo"
    workingTokens = ['connectors', ...workingTokens];
    firstToken = 'connectors';
  }

  // --- Unique prefix matching for top-level command ---
  const topLevelCandidates = [...TOP_LEVEL_COMMANDS];
  const topMatch = matchUniquePrefix(firstToken, topLevelCandidates);

  if (topMatch === null) {
    // No match - might be unknown command
    // Let the shell handle it (will show error)
    return { success: true, resolved: workingTokens, original };
  }

  if (Array.isArray(topMatch)) {
    // Ambiguous
    return {
      success: false,
      resolved: [],
      original,
      error: `Ambiguous command: '${firstToken}'`,
      candidates: topMatch,
    };
  }

  resolved.push(topMatch);

  // --- Subcommand prefix matching ---
  if (workingTokens.length > 1) {
    const subcommandToken = workingTokens[1];
    const subcommands = COMMAND_SUBCOMMANDS[topMatch];

    if (subcommands) {
      const subMatch = matchUniquePrefix(subcommandToken, subcommands);

      if (Array.isArray(subMatch)) {
        // Ambiguous subcommand
        return {
          success: false,
          resolved: [],
          original,
          error: `Ambiguous subcommand: '${subcommandToken}'`,
          candidates: subMatch,
        };
      }

      // Use matched subcommand or pass through if no match
      resolved.push(subMatch || subcommandToken);
    } else {
      // No subcommands defined, pass through
      resolved.push(subcommandToken);
    }

    // Rest of tokens pass through unchanged
    resolved.push(...workingTokens.slice(2));
  }

  return { success: true, resolved, original };
}

/**
 * Check if a command can be abbreviated to the given input
 * Used for history display and completion
 */
export function canAbbreviate(input: string, fullCommand: string): boolean {
  return fullCommand.startsWith(input) && input.length < fullCommand.length;
}

/**
 * Get the canonical (full) form of an abbreviated command
 * Returns the input unchanged if it cannot be resolved to a unique command
 */
export function getCanonicalCommand(
  input: string,
  candidates: readonly string[]
): string {
  const match = matchUniquePrefix(input, candidates);
  if (typeof match === 'string') {
    return match;
  }
  return input;
}
