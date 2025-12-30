#!/usr/bin/env node
/**
 * proofscan CLI - Phase 2.1
 * MCP Server scanner - eliminate black boxes
 *
 * Command structure (git-style flat):
 *   pfscan view        # View events (default)
 *   pfscan tree        # Structure overview
 *   pfscan explore     # Interactive browse
 *   pfscan scan        # Run scan
 *   pfscan status      # System status
 *   pfscan archive     # Archive/prune data
 *   pfscan config      # Configuration
 *   pfscan connectors  # Connector management
 *
 * Shortcuts:
 *   v = view, t = tree, e = explore, s = scan
 *   st = status, a = archive, c = config
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { resolveConfigPath } from './utils/config-path.js';
import { setOutputOptions } from './utils/output.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const VERSION = packageJson.version;
import {
  createConfigCommand,
  createConnectorsCommand,
  createScanCommand,
  createMonitorCommand,
  createSessionsCommand,
  createArchiveCommand,
  createViewCommand,
  createTreeCommand,
  createExploreCommand,
  createStatusCommand,
  createEventsCommand,
  createRpcCommand,
  createSummaryCommand,
  createPermissionsCommand,
  createRecordCommand,
  createDoctorCommand,
  createShellCommand,
} from './commands/index.js';

const program = new Command();

// Global state for config path
let globalConfigPath: string | undefined;

function getConfigPath(): string {
  return resolveConfigPath({ configPath: globalConfigPath });
}

// Custom help formatting
const HELP_HEADER = `
proofscan - MCP Server scanner
Eliminate black boxes by capturing JSON-RPC communication.

Common Commands:
  view, v       View recent events timeline (default)
  tree, t       Show connector → session → rpc structure
  explore, e    Interactive data browser
  scan, s       Run a new scan
  status, st    Show system status
  shell         Interactive shell (REPL) with TAB completion
  rpc           View RPC call details (list, show)
  summary       Show session summary
  permissions   Show permission stats per category

Management:
  archive, a    Archive and prune old data
  config, c     Configuration management
  connectors    Connector management
  doctor        Diagnose and fix database issues

Shortcuts:
  v=view  t=tree  e=explore  s=scan  st=status  a=archive  c=config

Examples:
  pfscan                      # View recent events (default)
  pfscan shell                # Start interactive shell
  pfscan view --limit 50      # View last 50 events
  pfscan view --pairs         # View request/response pairs
  pfscan tree                 # Show structure overview
  pfscan scan start mcp       # Start scanning connector 'mcp'
`;

program
  .name('pfscan')
  .description('MCP Server scanner - eliminate black boxes by capturing JSON-RPC')
  .version(VERSION)
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output in JSON format')
  .option('-v, --verbose', 'Verbose output')
  .addHelpText('before', HELP_HEADER)
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    globalConfigPath = opts.config;
    setOutputOptions({
      json: opts.json,
      verbose: opts.verbose,
    });
  });

// ============================================================
// Primary commands (Phase 2.1 - git style)
// ============================================================

// view (default command)
const viewCmd = createViewCommand(getConfigPath);
program.addCommand(viewCmd);

// Alias: v = view
const vCmd = createViewCommand(getConfigPath);
vCmd.name('v').description('Alias for view');
program.addCommand(vCmd);

// tree
const treeCmd = createTreeCommand(getConfigPath);
program.addCommand(treeCmd);

// Alias: t = tree
const tCmd = createTreeCommand(getConfigPath);
tCmd.name('t').description('Alias for tree');
program.addCommand(tCmd);

// explore
const exploreCmd = createExploreCommand(getConfigPath);
program.addCommand(exploreCmd);

// Alias: e = explore
const eCmd = createExploreCommand(getConfigPath);
eCmd.name('e').description('Alias for explore');
program.addCommand(eCmd);

// status
const statusCmd = createStatusCommand(getConfigPath);
program.addCommand(statusCmd);

// Alias: st = status
const stCmd = createStatusCommand(getConfigPath);
stCmd.name('st').description('Alias for status');
program.addCommand(stCmd);

// ============================================================
// Existing commands (maintained for compatibility)
// ============================================================

// scan
const scanCmd = createScanCommand(getConfigPath);
program.addCommand(scanCmd);

// Alias: s = scan
const sCmd = createScanCommand(getConfigPath);
sCmd.name('s').description('Alias for scan');
program.addCommand(sCmd);

// archive
const archiveCmd = createArchiveCommand(getConfigPath);
program.addCommand(archiveCmd);

// Alias: a = archive
const aCmd = createArchiveCommand(getConfigPath);
aCmd.name('a').description('Alias for archive');
program.addCommand(aCmd);

// config
const configCmd = createConfigCommand(getConfigPath);
program.addCommand(configCmd);

// Alias: c = config
const cCmd = createConfigCommand(getConfigPath);
cCmd.name('c').description('Alias for config');
program.addCommand(cCmd);

// connectors
program.addCommand(createConnectorsCommand(getConfigPath));

// Alias: connector = connectors (common typo)
const connectorCmd = createConnectorsCommand(getConfigPath);
connectorCmd.name('connector').description('Alias for connectors');
program.addCommand(connectorCmd);

// sessions (kept for compatibility, but sessions list → view --with-sessions)
program.addCommand(createSessionsCommand(getConfigPath));

// monitor (kept for compatibility, but monitor tail → view)
program.addCommand(createMonitorCommand(getConfigPath));

// events (Phase 2.1: events ls, export events)
program.addCommand(createEventsCommand(getConfigPath));

// rpc (Phase 2.2: rpc list, rpc show)
program.addCommand(createRpcCommand(getConfigPath));

// summary (Phase 3: capabilities, tool calls, concerns)
program.addCommand(createSummaryCommand(getConfigPath));

// permissions (Phase 3: detailed permission stats)
program.addCommand(createPermissionsCommand(getConfigPath));

// record (Phase 3: record dry-run)
program.addCommand(createRecordCommand(getConfigPath));

// doctor (Phase 3.4: diagnostics and repair)
program.addCommand(createDoctorCommand(getConfigPath));

// shell (Phase 4: interactive REPL)
program.addCommand(createShellCommand(getConfigPath));

// ============================================================
// Default action: pfscan → pfscan view
// ============================================================

// Check if help flag is present (should show root help, not view help)
function hasHelpFlag(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

// Check if no subcommand is provided (only options like --config, --json)
function hasSubcommand(): boolean {
  const knownCommands = new Set([
    'view', 'v', 'tree', 't', 'explore', 'e', 'status', 'st',
    'scan', 's', 'archive', 'a', 'config', 'c',
    'connectors', 'connector', 'sessions', 'monitor', 'events', 'rpc', 'summary', 'permissions', 'record', 'doctor', 'shell', 'help'
  ]);

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    // Skip option flags and their values
    if (arg.startsWith('-')) {
      // If it's --config, skip the next arg too
      if (arg === '-c' || arg === '--config') {
        i++;
      }
      continue;
    }
    // This is a positional argument - check if it's a command
    if (knownCommands.has(arg)) {
      return true;
    }
  }
  return false;
}

// If no subcommand and no help flag, insert 'view' right after program name
// This ensures `pfscan --help` shows root help, not `pfscan view` help
if (!hasSubcommand() && !hasHelpFlag()) {
  process.argv.splice(2, 0, 'view');
}

// Parse and run
program.parse();
