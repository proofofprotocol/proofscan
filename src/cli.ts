#!/usr/bin/env node
/**
 * proofscan CLI
 * MCP Server scanner - eliminate black boxes
 *
 * Command structure (git-style flat):
 *   pfscan view        # View events (default)
 *   pfscan tree        # Structure overview
 *   pfscan shell       # Interactive REPL
 *   pfscan scan        # Run scan
 *   pfscan status      # System status
 *   pfscan archive     # Archive/prune data
 *   pfscan config      # Configuration
 *   pfscan connectors  # MCP Connector management
 *   pfscan agent       # A2A Agent management
 *
 * Shortcuts:
 *   v = view, t = tree, s = scan
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
  createAgentCommand,
  createScanCommand,
  createSessionsCommand,
  createArchiveCommand,
  createViewCommand,
  createTreeCommand,
  createStatusCommand,
  createRpcCommand,
  createTaskCommand,
  createSummaryCommand,
  createAnalyzeCommand,
  createRecordCommand,
  createDoctorCommand,
  createShellCommand,
  createSecretsCommand,
  createToolCommand,
  createProxyCommand,
  createLogCommand,
  createPoplCommand,
  createCatalogCommand,
  createRegistryCommand,
  createRunnersCommand,
  createPlansCommand,
  createMonitorCommand,
  createServeCommand,
} from './commands/index.js';
import { createHelpCommand, generateGuideHelp } from './help/index.js';

const program = new Command();

// Global state for config path
let globalConfigPath: string | undefined;

function getConfigPath(): string {
  return resolveConfigPath({ configPath: globalConfigPath });
}

program
  .name('pfscan')
  .description('MCP Server scanner - eliminate black boxes by capturing JSON-RPC')
  .version(VERSION)
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output in JSON format')
  .option('-v, --verbose', 'Verbose output')
  .helpOption(false) // Disable default help, use custom help command
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

// agent (Phase 7.0: A2A agent management)
program.addCommand(createAgentCommand(getConfigPath));

// task (Phase 2.2: A2A task management)
program.addCommand(createTaskCommand(getConfigPath));

// sessions (kept for compatibility)
program.addCommand(createSessionsCommand(getConfigPath));

// rpc
program.addCommand(createRpcCommand(getConfigPath));

// summary (Phase 3: capabilities, tool calls, concerns)
program.addCommand(createSummaryCommand(getConfigPath));

// analyze (replaces permissions - cross-session tool analysis)
program.addCommand(createAnalyzeCommand(getConfigPath));

// record (Phase 3: record dry-run)
program.addCommand(createRecordCommand(getConfigPath));

// doctor (Phase 3.4: diagnostics and repair)
program.addCommand(createDoctorCommand(getConfigPath));

// shell (Phase 4: interactive REPL)
program.addCommand(createShellCommand(getConfigPath));

// secrets (Phase 3.6: secret management)
program.addCommand(createSecretsCommand(getConfigPath));

// Alias: secret = secrets (common typo/singular form)
const secretCmd = createSecretsCommand(getConfigPath);
secretCmd.name('secret').description('Alias for secrets');
program.addCommand(secretCmd);

// tool (Phase 4.4: CLI tool commands - ls, show, call)
program.addCommand(createToolCommand(getConfigPath));

// proxy (Phase 5.0: MCP Proxy server)
program.addCommand(createProxyCommand(getConfigPath));

// log (Phase 5.0+: Proxy log viewing)
program.addCommand(createLogCommand(getConfigPath));

// popl (Phase 6.0: Public Observable Proof Ledger)
program.addCommand(createPoplCommand(getConfigPath));

// catalog (Phase 7.0: MCP Registry)
program.addCommand(createCatalogCommand(getConfigPath));

// Alias: cat = catalog
const catCmd = createCatalogCommand(getConfigPath);
catCmd.name('cat').description('Alias for catalog');
program.addCommand(catCmd);

// registry (Phase 7.6: Local connector discovery)
program.addCommand(createRegistryCommand(getConfigPath));

// runners (Phase 7.x: Package runners)
program.addCommand(createRunnersCommand());

// plans (Phase 5.2: Validation plans)
program.addCommand(createPlansCommand(getConfigPath));

// monitor (Web Monitor)
program.addCommand(createMonitorCommand(getConfigPath));

// serve (Phase 8: Protocol Gateway HTTP server)
program.addCommand(createServeCommand());

// i18n (Issue #47: Internationalization utilities)
import { createI18nCommand } from './commands/i18n.js';
program.addCommand(createI18nCommand());

// help (custom help command)
program.addCommand(createHelpCommand(program));

// ============================================================
// Default action: pfscan → pfscan view
// ============================================================

// Check if help flag is present (should show root help, not view help)
function hasHelpFlag(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

// Known CLI commands (registered with commander)
const KNOWN_COMMANDS = new Set([
  'view', 'v', 'tree', 't', 'status', 'st',
  'scan', 's', 'archive', 'a', 'config', 'c',
  'connectors', 'connector', 'sessions', 'rpc', 'task', 'summary', 'analyze', 'record', 'doctor', 'shell', 'secrets', 'secret', 'tool', 'proxy', 'log', 'popl', 'catalog', 'cat', 'registry', 'runners', 'plans', 'monitor', 'i18n', 'help', 'agent', 'serve'
]);

// Shell-only commands (not available as CLI commands)
const SHELL_ONLY_COMMANDS = new Set(['send']);

/**
 * Check if no subcommand is provided (only options like --config, --json)
 * Returns: { hasCommand: boolean, unknownCommand?: string }
 */
function checkSubcommand(): { hasCommand: boolean; unknownCommand?: string } {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    // Skip option flags and their values
    if (arg.startsWith('-')) {
      // If it's --config, skip the next arg too (with bounds check)
      if (arg === '-c' || arg === '--config') {
        if (i + 1 < process.argv.length) i++;
      }
      continue;
    }
    // This is a positional argument - check if it's a known command
    if (KNOWN_COMMANDS.has(arg)) {
      return { hasCommand: true };
    }
    // Check if it's a shell-only command or unknown
    return { hasCommand: false, unknownCommand: arg };
  }
  return { hasCommand: false };
}

// If no subcommand and no help flag, insert 'view' right after program name
// This ensures `pfscan --help` shows root help, not `pfscan view` help
const subcommandCheck = checkSubcommand();

if (subcommandCheck.unknownCommand) {
  // Unknown command detected - show error and exit
  const cmd = subcommandCheck.unknownCommand;
  const isShellOnly = SHELL_ONLY_COMMANDS.has(cmd);

  console.error(`✗ Unknown command: ${cmd}`);
  if (isShellOnly) {
    console.error(`  '${cmd}' is a shell-only command. Run: pfscan shell`);
  }
  console.error(`  Run 'pfscan --help' for available commands.`);
  process.exit(1);
}

// Handle -h / --help at root level
if (!subcommandCheck.hasCommand && hasHelpFlag()) {
  console.log(generateGuideHelp());
  process.exit(0);
}

if (!subcommandCheck.hasCommand && !hasHelpFlag()) {
  process.argv.splice(2, 0, 'view');
}

// Parse and run
program.parse();
