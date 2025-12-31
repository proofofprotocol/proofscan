/**
 * Shell types and interfaces
 */

/**
 * Protocol type
 */
export type ProtoType = 'mcp' | 'a2a' | '?';

/**
 * Shell context - current connector/session state
 */
export interface ShellContext {
  connector?: string;
  session?: string;
  proto?: ProtoType;
  /** Previous location for cd - navigation */
  previousConnector?: string;
  previousSession?: string;
}

/**
 * Shell completion result
 */
export interface CompletionResult {
  completions: string[];
  prefix: string;
}

/**
 * Shell command definition for internal commands
 */
export interface ShellCommand {
  name: string;
  aliases?: string[];
  description: string;
  action: (args: string[], context: ShellContext) => Promise<void>;
}

/**
 * Top-level commands available in shell
 */
export const TOP_LEVEL_COMMANDS = [
  'view', 'v',
  'tree', 't',
  'explore', 'e',
  'scan', 's',
  'status', 'st',
  'archive', 'a',
  'config', 'c',
  'connectors', 'connector',
  'sessions',
  'monitor',
  'events',
  'rpc',
  'summary',
  'permissions',
  'record',
  'doctor',
];

/**
 * Commands with subcommands
 */
export const COMMAND_SUBCOMMANDS: Record<string, string[]> = {
  scan: ['start'],
  config: ['init', 'show', 'validate', 'path', 'ls', 'list', 'snapshot', 'restore'],
  connectors: ['list', 'show', 'add', 'enable', 'disable', 'remove', 'import'],
  connector: ['list', 'show', 'add', 'enable', 'disable', 'remove', 'import'],
  sessions: ['list', 'show', 'prune'],
  archive: ['run', 'status'],
  events: ['ls', 'export'],
  rpc: ['list', 'show'],
  record: ['dry-run'],
};

/**
 * Common options for commands
 */
export const COMMON_OPTIONS = [
  '--json',
  '--verbose',
  '-v',
  '--help',
  '-h',
];

/**
 * Command-specific options
 */
export const COMMAND_OPTIONS: Record<string, string[]> = {
  view: ['--limit', '--since', '--errors', '--method', '--connector', '--session', '--fulltime', '--full-time', '--time-full', '--with-sessions', '--pairs', '--pair'],
  tree: ['--sessions', '--rpc', '--session', '--rpc-all', '--method', '--status', '--compact', '--ids-only', '--since'],
  scan: ['--id', '--timeout', '--dry-run'],
  'scan start': ['--id', '--timeout', '--dry-run'],
  rpc: ['--session', '--id', '--format', '--copy'],
  'rpc list': ['--session', '--format'],
  'rpc show': ['--session', '--id', '--format', '--copy'],
  summary: ['--session', '--format'],
  permissions: ['--session', '--category'],
  connectors: ['--id', '--from', '--file', '--stdin', '--name'],
  sessions: ['--limit'],
  archive: ['--older-than', '--dry-run'],
  record: ['--output'],
};

/**
 * Shell built-in commands
 */
export const SHELL_BUILTINS = ['use', 'reset', 'pwd', 'help', 'exit', 'quit', 'clear'];

/**
 * Router-style navigation commands
 * Note: 'cd' is an alias for 'cc'
 */
export const ROUTER_COMMANDS = ['cc', 'cd', 'ls', 'show', '..'];
