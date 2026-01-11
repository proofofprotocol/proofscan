/**
 * Help generation utilities
 *
 * Generates customized help output for proofscan CLI:
 * - Guide mode (pfscan help): Use-case focused overview
 * - Inventory mode (pfscan help -a): Complete command reference
 * - Command mode (pfscan help <cmd>): Commander standard help
 */

import { Command } from 'commander';
import {
  GUIDE_CATEGORIES,
  MAIN_COMMANDS,
  ANCILLARY_COMMANDS,
  type CommandEntry,
} from './categories.js';

/**
 * Generate guide help (pfscan help)
 *
 * Shows 3-mode explanation and use-case focused categories.
 * No aliases displayed.
 */
export function generateGuideHelp(): string {
  const lines: string[] = [];

  lines.push('proofscan - MCP Server scanner');
  lines.push('Eliminate black boxes by capturing JSON-RPC communication.');
  lines.push('');
  lines.push('proofscan operates in three modes:');
  lines.push('  - CLI   : Run single commands to inspect, manage and analyze data');
  lines.push('  - SHELL : Explore connectors, sessions and RPCs interactively');
  lines.push('  - PROXY : Capture MCP traffic continuously as a proxy server');
  lines.push('');
  lines.push('Common tasks you can perform with proofscan:');
  lines.push('');

  for (const category of GUIDE_CATEGORIES) {
    lines.push(category.name);
    for (const cmd of category.commands) {
      const name = cmd.name.padEnd(14);
      lines.push(`  ${name}${cmd.description}`);
    }
    lines.push('');
  }

  lines.push("See 'pfscan help <command>' for details.");
  lines.push("See 'pfscan help -a' for a complete list of commands.");

  return lines.join('\n');
}

/**
 * Format a command entry for inventory display
 */
function formatCommandLine(cmd: CommandEntry, indent: number = 0): string[] {
  const lines: string[] = [];
  const prefix = ' '.repeat(indent);

  // Main command line: name (alias)  description
  const aliasStr = cmd.alias ? ` (${cmd.alias})` : '';
  const nameWithAlias = `${cmd.name}${aliasStr}`.padEnd(20 - indent);
  lines.push(`${prefix}${nameWithAlias}${cmd.description}`);

  // Subcommands (indented)
  if (cmd.subcommands && cmd.subcommands.length > 0) {
    for (const sub of cmd.subcommands) {
      const subName = `${cmd.name} ${sub.name}`.padEnd(22);
      lines.push(`     ${subName}${sub.description}`);
    }
  }

  return lines;
}

/**
 * Generate inventory help (pfscan help -a)
 *
 * git-style: Main commands / Ancillary commands
 * Alphabetical order, with aliases and subcommands.
 */
export function generateInventoryHelp(): string {
  const lines: string[] = [];

  lines.push("See 'pfscan help <command>' to read about a specific subcommand");
  lines.push('');
  lines.push('Main commands');

  for (const cmd of MAIN_COMMANDS) {
    lines.push(...formatCommandLine(cmd, 3));
  }

  lines.push('');
  lines.push('Ancillary commands');

  for (const cmd of ANCILLARY_COMMANDS) {
    lines.push(...formatCommandLine(cmd, 3));
  }

  return lines.join('\n');
}

/**
 * Create the help command for the CLI
 *
 * Handles:
 * - pfscan help → Guide mode
 * - pfscan help -a / --all → Inventory mode
 * - pfscan help <command> → Commander standard help
 */
export function createHelpCommand(program: Command): Command {
  const help = new Command('help')
    .description('Display help information')
    .argument('[command]', 'Command to get help for')
    .option('-a, --all', 'Show all commands including subcommands')
    .action((commandName: string | undefined, options: { all?: boolean }) => {
      if (options.all) {
        // Inventory mode: pfscan help -a
        console.log(generateInventoryHelp());
        return;
      }

      if (commandName) {
        // Command-specific help: pfscan help <command>
        const subCommand = program.commands.find(
          (cmd) => cmd.name() === commandName || cmd.aliases().includes(commandName)
        );

        if (subCommand) {
          subCommand.outputHelp();
        } else {
          console.error(`Unknown command: ${commandName}`);
          console.log('');
          console.log("Run 'pfscan help' for available commands.");
          process.exitCode = 1;
        }
        return;
      }

      // Default: Guide mode
      console.log(generateGuideHelp());
    });

  return help;
}

/**
 * Configure help options for the main program
 *
 * Disables Commander's default help and sets up custom handling.
 */
export function configureHelpOptions(program: Command): void {
  // Disable Commander's default help
  program.helpOption(false);

  // Add custom -h, --help handling
  program.option('-h, --help', 'Display help information');

  // Hook into pre-action to intercept -h/--help
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.help) {
      console.log(generateGuideHelp());
      process.exit(0);
    }
  });
}
