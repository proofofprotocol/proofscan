/**
 * i18n command - Internationalization utilities
 *
 * pfscan i18n keys [--prefix <prefix>]
 *
 * Lists all available i18n keys for reference.
 */

import { Command } from 'commander';
import { getAllKeys, getLang, t } from '../i18n/index.js';
import { output, getOutputOptions } from '../utils/output.js';

// ============================================================
// Command
// ============================================================

export function createI18nCommand(): Command {
  const cmd = new Command('i18n')
    .description('Internationalization utilities');

  // keys subcommand
  const keysCmd = new Command('keys')
    .description('List all available i18n keys')
    .option('--prefix <prefix>', 'Filter keys by prefix (e.g., "analyze.", "category.")')
    .action(async (options) => {
      const keys = getAllKeys(options.prefix);

      if (getOutputOptions().json) {
        output({
          lang: getLang(),
          prefix: options.prefix || null,
          keys,
          count: keys.length,
        });
        return;
      }

      // Terminal output
      console.log(`Language: ${getLang()}`);
      if (options.prefix) {
        console.log(`Prefix: ${options.prefix}`);
      }
      console.log(`Keys: ${keys.length}`);
      console.log();

      for (const key of keys) {
        const value = t(key);
        // Truncate long values
        const displayValue = value.length > 50 ? value.slice(0, 47) + '...' : value;
        console.log(`  ${key}: ${displayValue}`);
      }
    });

  cmd.addCommand(keysCmd);

  return cmd;
}
