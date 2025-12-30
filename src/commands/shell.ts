/**
 * Shell command - interactive REPL for proofscan
 */

import { Command } from 'commander';
import { ShellRepl } from '../shell/index.js';

export function createShellCommand(getConfigPath: () => string): Command {
  const cmd = new Command('shell')
    .description('Start interactive shell (REPL)')
    .action(async () => {
      // Check if stdin is a TTY
      if (!process.stdin.isTTY) {
        console.error('Error: Shell requires an interactive terminal (TTY)');
        console.error('');
        console.error('The shell command cannot be used in non-interactive mode.');
        console.error('Use individual commands instead, e.g.:');
        console.error('  pfscan view');
        console.error('  pfscan tree');
        console.error('  pfscan scan start --id <connector>');
        process.exit(1);
      }

      // Check if stdout is a TTY
      if (!process.stdout.isTTY) {
        console.error('Error: Shell requires an interactive terminal (TTY)');
        console.error('');
        console.error('Output is being redirected. Use individual commands instead.');
        process.exit(1);
      }

      const repl = new ShellRepl(getConfigPath());
      await repl.start();
    });

  return cmd;
}
