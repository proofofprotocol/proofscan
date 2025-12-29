/**
 * Config commands
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { output, outputSuccess, outputError, maskSecretsInObject, getOutputOptions } from '../utils/output.js';

export function createConfigCommand(getConfigPath: () => string): Command {
  const cmd = new Command('config')
    .description('Manage proofscan configuration');

  cmd
    .command('path')
    .description('Show the config file path')
    .action(() => {
      const configPath = getConfigPath();
      output({ path: configPath }, configPath);
    });

  cmd
    .command('init')
    .description('Initialize a new config file')
    .option('-f, --force', 'Overwrite existing config')
    .option('-p, --path <path>', 'Custom config path')
    .action(async (options) => {
      try {
        const configPath = options.path || getConfigPath();
        const manager = new ConfigManager(configPath);
        const result = await manager.init(options.force);

        if (result.created) {
          outputSuccess(`Config created at: ${result.path}`);
        } else {
          output(
            { exists: true, path: result.path },
            `Config already exists at: ${result.path}\nUse --force to overwrite.`
          );
        }
      } catch (error) {
        outputError('Failed to initialize config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show current config (secrets masked)')
    .action(async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const config = await manager.load();
        const masked = maskSecretsInObject(config);

        if (getOutputOptions().json) {
          output(masked);
        } else {
          console.log(JSON.stringify(masked, null, 2));
        }
      } catch (error) {
        outputError('Failed to load config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('validate')
    .description('Validate the config file')
    .action(async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const result = await manager.validate();

        if (result.valid) {
          outputSuccess('Config is valid');
        } else {
          output(
            { valid: false, errors: result.errors },
            `Config validation failed:\n${result.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n')}`
          );
          process.exit(1);
        }
      } catch (error) {
        outputError('Failed to validate config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
