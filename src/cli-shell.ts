#!/usr/bin/env node
/**
 * Shell-only CLI entry point (psh command)
 * Directly starts the interactive REPL without subcommand
 */

import { ShellRepl } from './shell/index.js';
import { getDefaultConfigPath } from './utils/config-path.js';

async function main() {
  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    console.error('Error: Shell requires an interactive terminal (TTY)');
    console.error('');
    console.error('The shell command cannot be used in non-interactive mode.');
    console.error('Use individual commands instead, e.g.:');
    console.error('  pfs view');
    console.error('  pfs tree');
    console.error('  pfs plans run --connector <id>');
    process.exit(1);
  }

  // Check if stdout is a TTY
  if (!process.stdout.isTTY) {
    console.error('Error: Shell requires an interactive terminal (TTY)');
    console.error('');
    console.error('Output is being redirected. Use individual commands instead.');
    process.exit(1);
  }

  const repl = new ShellRepl(getDefaultConfigPath());
  await repl.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
