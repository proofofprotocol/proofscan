/**
 * Doctor command - diagnose and fix database issues
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { diagnoseEventsDb, fixEventsDb, getDbPaths } from '../db/connection.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';

export function createDoctorCommand(getConfigPath: () => string): Command {
  const cmd = new Command('doctor')
    .description('Diagnose database issues and optionally fix them')
    .option('--fix', 'Attempt to fix detected issues')
    .action((options) => {
      const manager = new ConfigManager(getConfigPath());
      const configDir = manager.getConfigDir();
      const dbPaths = getDbPaths(configDir);

      // Run diagnostics
      const diagnostic = diagnoseEventsDb(configDir);

      if (getOutputOptions().json) {
        const result: Record<string, unknown> = {
          config_path: manager.getConfigPath(),
          config_dir: configDir,
          events_db: diagnostic,
          proofs_db_path: dbPaths.proofs,
        };

        if (options.fix && (diagnostic.missingTables.length > 0 || diagnostic.missingColumns.length > 0)) {
          const fixResult = fixEventsDb(configDir);
          result.fix_result = fixResult;
        }

        output(result);
        return;
      }

      // Human-readable output
      console.log('proofscan Doctor');
      console.log('═════════════════════════════════════════════════════');
      console.log();

      console.log('Paths:');
      console.log(`  Config:     ${manager.getConfigPath()}`);
      console.log(`  Data dir:   ${configDir}`);
      console.log(`  events.db:  ${diagnostic.path}`);
      console.log(`  proofs.db:  ${dbPaths.proofs}`);
      console.log();

      console.log('Events Database:');
      console.log(`  Exists:     ${diagnostic.exists ? '✓ Yes' : '✗ No'}`);

      if (!diagnostic.exists) {
        console.log();
        console.log('  Database does not exist yet. Run a scan to create it:');
        console.log('    pfscan scan start --id <connector>');
        return;
      }

      console.log(`  Readable:   ${diagnostic.readable ? '✓ Yes' : '✗ No'}`);

      if (!diagnostic.readable) {
        console.log();
        outputError(`Cannot read database: ${diagnostic.error}`);
        console.log();
        console.log('  Try backing up and recreating:');
        console.log(`    mv "${diagnostic.path}" "${diagnostic.path}.bak"`);
        console.log('    pfscan scan start --id <connector>');
        return;
      }

      console.log(`  Version:    ${diagnostic.userVersion}`);
      console.log(`  Tables:     ${diagnostic.tables.join(', ') || '(none)'}`);

      const hasIssues = diagnostic.missingTables.length > 0 || diagnostic.missingColumns.length > 0;

      if (diagnostic.missingTables.length > 0) {
        console.log();
        console.log('⚠ Missing Tables:');
        for (const table of diagnostic.missingTables) {
          console.log(`  - ${table}`);
        }
      }

      if (diagnostic.missingColumns.length > 0) {
        console.log();
        console.log('⚠ Missing Columns:');
        for (const { table, column } of diagnostic.missingColumns) {
          console.log(`  - ${table}.${column}`);
        }
      }

      if (hasIssues) {
        if (options.fix) {
          console.log();
          console.log('Attempting to fix...');
          const fixResult = fixEventsDb(configDir);

          if (fixResult.success && fixResult.fixed.length > 0) {
            outputSuccess(`Fixed: ${fixResult.fixed.join(', ')}`);

            // Verify fix worked
            const postFixDiag = diagnoseEventsDb(configDir);
            if (postFixDiag.missingTables.length > 0 || postFixDiag.missingColumns.length > 0) {
              console.log();
              outputError('Some issues remain after fix. Manual intervention may be required.');
            }
          } else if (fixResult.success) {
            console.log('No fixes needed.');
          } else {
            outputError(`Fix failed: ${fixResult.error}`);
          }
        } else {
          console.log();
          console.log('  Run with --fix to attempt repair:');
          console.log('    pfscan doctor --fix');
        }
      } else {
        console.log();
        outputSuccess('All required tables and columns present');
      }

      console.log();
    });

  return cmd;
}
