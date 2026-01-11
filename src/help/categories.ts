/**
 * Command category definitions for help display
 *
 * Single source of truth for command organization.
 * Supports two display modes:
 * - Guide mode (pfscan help): Use-case focused, no aliases
 * - Inventory mode (pfscan help -a): git-style, with aliases and subcommands
 */

/**
 * Subcommand entry for inventory display
 */
export interface SubcommandEntry {
  name: string;
  description: string;
}

/**
 * Command entry for help display
 */
export interface CommandEntry {
  /** Command name */
  name: string;
  /** Alias (shown in inventory mode only) */
  alias?: string;
  /** Short description */
  description: string;
  /** Subcommands (shown in inventory mode only) */
  subcommands?: SubcommandEntry[];
}

/**
 * Category of commands
 */
export interface CommandCategory {
  name: string;
  commands: CommandEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Guide Categories (pfscan help)
// Use-case focused, no aliases shown
// ─────────────────────────────────────────────────────────────────────────────

export const GUIDE_CATEGORIES: CommandCategory[] = [
  {
    name: 'Observe & Inspect',
    commands: [
      { name: 'view', description: 'View recent events timeline (default)' },
      { name: 'tree', description: 'Show connector → session → RPC structure' },
      { name: 'rpc', description: 'Inspect RPC call details' },
      { name: 'summary', description: 'Show session summary and capabilities' },
      { name: 'analyze', description: 'Analyze tool usage across sessions' },
    ],
  },
  {
    name: 'Run & Capture',
    commands: [
      { name: 'scan', description: 'Run a new scan against MCP servers' },
      { name: 'proxy', description: 'Run MCP proxy server' },
    ],
  },
  {
    name: 'Explore Interactively',
    commands: [
      { name: 'shell', description: 'Start interactive shell (REPL)' },
    ],
  },
  {
    name: 'Work with MCP Tools',
    commands: [
      { name: 'tool', description: 'List, inspect and call MCP tools' },
      { name: 'catalog', description: 'Search and inspect MCP servers from registry' },
      { name: 'runners', description: 'Manage package runners (npx, uvx)' },
    ],
  },
  {
    name: 'Manage Configuration & Data',
    commands: [
      { name: 'connectors', description: 'Manage MCP server connectors' },
      { name: 'config', description: 'Configuration management' },
      { name: 'secrets', description: 'Secret management' },
      { name: 'archive', description: 'Data retention and cleanup' },
      { name: 'doctor', description: 'Diagnose and fix issues' },
    ],
  },
  {
    name: 'Proof & Ledger',
    commands: [
      { name: 'popl', description: 'Public Observable Proof Ledger management' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Inventory Categories (pfscan help -a)
// git-style: Main / Ancillary, alphabetical, with aliases and subcommands
// ─────────────────────────────────────────────────────────────────────────────

export const MAIN_COMMANDS: CommandEntry[] = [
  {
    name: 'analyze',
    description: 'Analyze tool usage across sessions and connectors',
  },
  {
    name: 'archive',
    alias: 'a',
    description: 'Manage data retention and cleanup',
    subcommands: [
      { name: 'run', description: 'Execute archive cleanup' },
    ],
  },
  {
    name: 'catalog',
    alias: 'cat',
    description: 'Search and view MCP servers from registry',
    subcommands: [
      { name: 'search', description: 'Search for MCP servers' },
      { name: 'view', description: 'View server details' },
      { name: 'install', description: 'Install MCP server to connectors' },
      { name: 'sources', description: 'Manage catalog sources' },
    ],
  },
  {
    name: 'config',
    alias: 'c',
    description: 'Manage proofscan configuration',
    subcommands: [
      { name: 'path', description: 'Show the config file path' },
      { name: 'init', description: 'Initialize a new config file' },
      { name: 'show', description: 'Show current config' },
      { name: 'validate', description: 'Validate the config file' },
      { name: 'add', description: 'Add connectors from MCP server JSON' },
      { name: 'save', description: 'Save a snapshot of the current config' },
      { name: 'ls', description: 'List saved config snapshots' },
      { name: 'load', description: 'Load a saved snapshot' },
      { name: 'delete', description: 'Delete a saved snapshot' },
      { name: 'security', description: 'Manage catalog security settings' },
    ],
  },
  {
    name: 'connectors',
    description: 'Manage MCP server connectors',
    subcommands: [
      { name: 'ls', description: 'List all connectors' },
      { name: 'show', description: 'Show connector details' },
      { name: 'add', description: 'Add a new connector' },
      { name: 'enable', description: 'Enable a connector' },
      { name: 'disable', description: 'Disable a connector' },
      { name: 'delete', description: 'Delete a connector' },
      { name: 'import', description: 'Import connectors from mcpServers format' },
    ],
  },
  {
    name: 'doctor',
    description: 'Diagnose and fix database issues',
  },
  {
    name: 'proxy',
    description: 'Run MCP proxy server',
  },
  {
    name: 'rpc',
    description: 'View RPC call details',
    subcommands: [
      { name: 'ls', description: 'List RPC calls for a session' },
      { name: 'show', description: 'Show RPC call details' },
    ],
  },
  {
    name: 'scan',
    alias: 's',
    description: 'Run a new scan against MCP servers',
    subcommands: [
      { name: 'start', description: 'Start scanning a connector' },
    ],
  },
  {
    name: 'secrets',
    alias: 'secret',
    description: 'Secret management',
    subcommands: [
      { name: 'ls', description: 'List all stored secrets' },
      { name: 'set', description: 'Set a secret value' },
      { name: 'get', description: 'Check if a secret exists' },
      { name: 'edit', description: 'Edit secrets in $EDITOR' },
      { name: 'prune', description: 'Remove orphaned secrets' },
      { name: 'export', description: 'Export secrets' },
      { name: 'import', description: 'Import secrets' },
    ],
  },
  {
    name: 'shell',
    description: 'Start interactive shell (REPL)',
  },
  {
    name: 'status',
    alias: 'st',
    description: 'Show database and system status',
  },
  {
    name: 'summary',
    description: 'Show session summary and capabilities',
  },
  {
    name: 'tool',
    description: 'MCP tool operations',
    subcommands: [
      { name: 'ls', description: 'List tools on a connector' },
      { name: 'show', description: 'Show tool details' },
      { name: 'call', description: 'Call an MCP tool' },
    ],
  },
  {
    name: 'tree',
    alias: 't',
    description: 'Show connector → session → RPC structure',
  },
  {
    name: 'view',
    alias: 'v',
    description: 'View recent events timeline (default)',
  },
];

export const ANCILLARY_COMMANDS: CommandEntry[] = [
  {
    name: 'log',
    description: 'View proxy logs',
  },
  {
    name: 'popl',
    description: 'Public Observable Proof Ledger management',
    subcommands: [
      { name: 'init', description: 'Initialize .popl directory' },
      { name: 'session', description: 'Create a POPL entry for a session' },
      { name: 'ls', description: 'List POPL entries' },
      { name: 'show', description: 'Show details of a POPL entry' },
    ],
  },
  {
    name: 'record',
    description: 'Record management commands',
  },
  {
    name: 'runners',
    description: 'Manage package runners (npx, uvx)',
  },
  {
    name: 'sessions',
    description: 'Manage scan sessions',
  },
];
