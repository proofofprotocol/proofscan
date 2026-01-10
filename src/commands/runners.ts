/**
 * runners command - manage package runners (npx, uvx)
 */

import { Command } from 'commander';
import { detectAll, listRunnerNames, type RunnerStatus } from '../runners/index.js';
import { output, getOutputOptions } from '../utils/output.js';

/**
 * Format runner status for human display
 */
function formatRunnerStatus(status: RunnerStatus): string {
  const icon = status.available ? '\u2713' : '\u2717';
  const statusText = status.available ? 'available' : 'not available';

  if (status.available) {
    const version = status.version ? ` (${status.version})` : '';
    const path = status.path ? ` @ ${status.path}` : '';
    return `  ${icon} ${status.name}: ${statusText}${version}${path}`;
  }

  return `  ${icon} ${status.name}: ${statusText}`;
}

export function createRunnersCommand(_getConfigPath: () => string): Command {
  const cmd = new Command('runners').description('Manage package runners (npx, uvx)');

  // runners list
  cmd
    .command('list')
    .alias('ls')
    .description('List available package runners')
    .action(async () => {
      const opts = getOutputOptions();
      const statuses = await detectAll();

      if (opts.json) {
        output(statuses);
        return;
      }

      console.log('Package Runners:');
      console.log();

      for (const status of statuses) {
        console.log(formatRunnerStatus(status));
      }

      console.log();

      const available = statuses.filter((s) => s.available);
      if (available.length === 0) {
        console.log('No runners available. Install npm (for npx) or uv (for uvx).');
      } else {
        console.log(`${available.length} runner(s) available.`);
      }
    });

  // runners doctor
  cmd
    .command('doctor')
    .description('Diagnose runner availability')
    .action(async () => {
      const opts = getOutputOptions();
      const statuses = await detectAll();

      if (opts.json) {
        const result = {
          statuses,
          healthy: statuses.some((s) => s.available),
        };
        output(result);
        return;
      }

      console.log('Runner Diagnostics');
      console.log('==================');
      console.log();

      for (const status of statuses) {
        if (status.available) {
          console.log(`\u2713 ${status.name}: OK`);
          if (status.version) {
            console.log(`    Version: ${status.version}`);
          }
          if (status.path) {
            console.log(`    Path:    ${status.path}`);
          }
        } else {
          console.log(`\u2717 ${status.name}: Not found`);
          if (status.error) {
            console.log(`    Error: ${status.error}`);
          }
        }
        console.log();
      }

      const available = statuses.filter((s) => s.available);
      if (available.length === 0) {
        console.log('No runners available.');
        console.log();
        console.log('To install:');
        console.log('  npx: Install Node.js (https://nodejs.org)');
        console.log('  uvx: Install uv (https://github.com/astral-sh/uv)');
      } else {
        console.log(`\u2713 ${available.length}/${statuses.length} runner(s) ready`);
      }
    });

  // Default action (no subcommand): same as list
  cmd.action(async () => {
    const opts = getOutputOptions();
    const statuses = await detectAll();

    if (opts.json) {
      output(statuses);
      return;
    }

    console.log('Package Runners:');
    console.log();

    for (const status of statuses) {
      console.log(formatRunnerStatus(status));
    }

    console.log();

    const available = statuses.filter((s) => s.available);
    if (available.length === 0) {
      console.log('No runners available. Install npm (for npx) or uv (for uvx).');
    } else {
      console.log(`${available.length} runner(s) available.`);
    }

    console.log();
    console.log('Commands:');
    console.log('  pfscan runners list    List runners');
    console.log('  pfscan runners doctor  Diagnose runner issues');
  });

  return cmd;
}
