/**
 * Doctor command - diagnose and fix database issues
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { diagnoseEventsDb, fixEventsDb, diagnoseProofsDb, fixProofsDb } from '../db/connection.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';

export function createDoctorCommand(getConfigPath: () => string): Command {
  const cmd = new Command('doctor')
    .description('Diagnose database issues and optionally fix them')
    .option('--fix', 'Attempt to fix detected issues')
    .action((options) => {
      const manager = new ConfigManager(getConfigPath());
      const configDir = manager.getConfigDir();

      // Run diagnostics
      const eventsDiag = diagnoseEventsDb(configDir);
      const proofsDiag = diagnoseProofsDb(configDir);

      if (getOutputOptions().json) {
        const result: Record<string, unknown> = {
          config_path: manager.getConfigPath(),
          config_dir: configDir,
          events_db: eventsDiag,
          proofs_db: proofsDiag,
        };

        if (options.fix) {
          if (eventsDiag.missingTables.length > 0 || eventsDiag.missingColumns.length > 0) {
            result.events_fix_result = fixEventsDb(configDir);
          }
          if (proofsDiag.missingTables.length > 0) {
            result.proofs_fix_result = fixProofsDb(configDir);
          }
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
      console.log(`  events.db:  ${eventsDiag.path}`);
      console.log(`  proofs.db:  ${proofsDiag.path}`);
      console.log();

      // Events Database diagnostics
      console.log('Events Database:');
      console.log(`  Exists:     ${eventsDiag.exists ? '✓ Yes' : '✗ No'}`);

      let eventsHasIssues = false;
      if (eventsDiag.exists) {
        console.log(`  Readable:   ${eventsDiag.readable ? '✓ Yes' : '✗ No'}`);

        if (!eventsDiag.readable) {
          console.log();
          outputError(`Cannot read database: ${eventsDiag.error}`);
          console.log();
          console.log('  Try backing up and recreating:');
          console.log(`    mv "${eventsDiag.path}" "${eventsDiag.path}.bak"`);
          console.log('    pfscan scan start --id <connector>');
        } else {
          console.log(`  Version:    ${eventsDiag.userVersion}`);
          console.log(`  Tables:     ${eventsDiag.tables.join(', ') || '(none)'}`);

          eventsHasIssues = eventsDiag.missingTables.length > 0 || eventsDiag.missingColumns.length > 0;

          if (eventsDiag.missingTables.length > 0) {
            console.log();
            console.log('⚠ Missing Tables:');
            for (const table of eventsDiag.missingTables) {
              console.log(`  - ${table}`);
            }
          }

          if (eventsDiag.missingColumns.length > 0) {
            console.log();
            console.log('⚠ Missing Columns:');
            for (const { table, column } of eventsDiag.missingColumns) {
              console.log(`  - ${table}.${column}`);
            }
          }
        }
      }

      console.log();

      // Proofs Database diagnostics
      console.log('Proofs Database:');
      console.log(`  Exists:     ${proofsDiag.exists ? '✓ Yes' : '✗ No'}`);

      let proofsHasIssues = false;
      if (proofsDiag.exists) {
        console.log(`  Readable:   ${proofsDiag.readable ? '✓ Yes' : '✗ No'}`);

        if (!proofsDiag.readable) {
          console.log();
          outputError(`Cannot read database: ${proofsDiag.error}`);
          console.log();
          console.log('  Try backing up and recreating:');
          console.log(`    mv "${proofsDiag.path}" "${proofsDiag.path}.bak"`);
        } else {
          console.log(`  Version:    ${proofsDiag.userVersion} (expected: ${proofsDiag.expectedVersion})`);
          console.log(`  Tables:     ${proofsDiag.tables.join(', ') || '(none)'}`);

          proofsHasIssues = proofsDiag.missingTables.length > 0 ||
            (proofsDiag.userVersion !== null && proofsDiag.userVersion < proofsDiag.expectedVersion);

          if (proofsDiag.missingTables.length > 0) {
            console.log();
            console.log('⚠ Missing Tables:');
            for (const table of proofsDiag.missingTables) {
              console.log(`  - ${table}`);
            }
          }

          if (proofsDiag.userVersion !== null && proofsDiag.userVersion < proofsDiag.expectedVersion) {
            console.log();
            console.log(`⚠ Database version outdated: ${proofsDiag.userVersion} < ${proofsDiag.expectedVersion}`);
          }
        }
      }

      console.log();

      // Fix logic
      const hasIssues = eventsHasIssues || proofsHasIssues;

      if (hasIssues) {
        if (options.fix) {
          console.log('Attempting to fix...');
          console.log();

          // Fix events.db
          if (eventsHasIssues) {
            const fixResult = fixEventsDb(configDir);
            if (fixResult.success && fixResult.fixed.length > 0) {
              outputSuccess(`Events DB fixed: ${fixResult.fixed.join(', ')}`);
            } else if (!fixResult.success) {
              outputError(`Events DB fix failed: ${fixResult.error}`);
            }
          }

          // Fix proofs.db
          if (proofsHasIssues) {
            const fixResult = fixProofsDb(configDir);
            if (fixResult.success && fixResult.fixed.length > 0) {
              outputSuccess(`Proofs DB fixed: ${fixResult.fixed.join(', ')}`);
            } else if (!fixResult.success) {
              outputError(`Proofs DB fix failed: ${fixResult.error}`);
            }
          }

          // Verify fixes worked
          const postEventsDiag = diagnoseEventsDb(configDir);
          const postProofsDiag = diagnoseProofsDb(configDir);

          const remainingIssues =
            postEventsDiag.missingTables.length > 0 ||
            postEventsDiag.missingColumns.length > 0 ||
            postProofsDiag.missingTables.length > 0;

          if (remainingIssues) {
            console.log();
            outputError('Some issues remain after fix. Manual intervention may be required.');
          }
        } else {
          console.log('Run with --fix to attempt repair:');
          console.log('  pfscan doctor --fix');
        }
      } else if (eventsDiag.exists || proofsDiag.exists) {
        outputSuccess('All required tables and columns present');
      } else {
        console.log('No databases found. Run a scan to create them:');
        console.log('  pfscan scan start --id <connector>');
      }

      console.log();
    });

  return cmd;
}
