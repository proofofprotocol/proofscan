/**
 * POPL Command (Phase 6.0)
 *
 * pfscan popl init
 * pfscan popl session --session <session_id> [options]
 * pfscan popl list
 * pfscan popl show <entry-id>
 *
 * CLI commands for POPL (Public Observable Proof Ledger) management.
 *
 * IMPORTANT: CLI does NOT handle @references (@last, @ref:xxx).
 * Those are resolved in the shell layer before calling service functions.
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  hasPoplDir,
  initPoplDir,
  createSessionPoplEntry,
  listPoplEntries,
  readPoplEntry,
  getPoplEntriesDir,
} from '../popl/index.js';

export function createPoplCommand(getConfigPath: () => string): Command {
  const cmd = new Command('popl').description(
    'Public Observable Proof Ledger (POPL) management'
  );

  // popl init
  cmd
    .command('init')
    .description('Initialize .popl directory in current working directory')
    .action(async () => {
      const cwd = process.cwd();

      if (hasPoplDir(cwd)) {
        if (getOutputOptions().json) {
          output({ success: true, message: '.popl directory already exists', path: cwd });
        } else {
          console.log('.popl directory already exists.');
        }
        return;
      }

      try {
        await initPoplDir(cwd);

        if (getOutputOptions().json) {
          output({
            success: true,
            message: 'Initialized .popl directory',
            path: cwd,
          });
        } else {
          console.log('Initialized .popl directory.');
          console.log('');
          console.log('Next steps:');
          console.log('  1. Edit .popl/config.json to set your author info');
          console.log('  2. Run "pfscan popl session --session <id>" to create an entry');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (getOutputOptions().json) {
          output({ success: false, error: msg });
        } else {
          console.error(`Failed to initialize: ${msg}`);
        }
        process.exit(1);
      }
    });

  // popl session
  cmd
    .command('session')
    .description('Create a POPL entry for a session')
    .requiredOption('--session <id>', 'Session ID (required)')
    .option('--title <title>', 'Entry title')
    .option('--unsafe-include-raw', 'Include raw unsanitized data (DANGEROUS)')
    .action(
      async (options: {
        session: string;
        title?: string;
        unsafeIncludeRaw?: boolean;
      }) => {
        const configPath = getConfigPath();
        const manager = new ConfigManager(configPath);
        const configDir = manager.getConfigDir();
        const cwd = process.cwd();

        // Validate session ID format (ULID is 26 chars, but allow shorter for partial IDs)
        const sessionId = options.session.trim();
        if (!sessionId || sessionId.length < 8) {
          if (getOutputOptions().json) {
            output({
              success: false,
              error: 'Invalid session ID: must be at least 8 characters',
            });
          } else {
            console.error('Invalid session ID: must be at least 8 characters.');
          }
          process.exit(1);
        }

        // Check for @reference (should use shell, not CLI)
        if (sessionId.startsWith('@')) {
          if (getOutputOptions().json) {
            output({
              success: false,
              error: '@references are not supported in CLI. Use shell mode or provide session ID.',
            });
          } else {
            console.error('@references are not supported in CLI.');
            console.error('Use shell mode (pfscan shell) or provide the full session ID.');
          }
          process.exit(1);
        }

        if (!hasPoplDir(cwd)) {
          if (getOutputOptions().json) {
            output({
              success: false,
              error: '.popl directory not found. Run "pfscan popl init" first.',
            });
          } else {
            console.error('.popl directory not found.');
            console.error('Run "pfscan popl init" to initialize.');
          }
          process.exit(1);
        }

        const result = await createSessionPoplEntry(sessionId, configDir, {
          outputRoot: cwd,
          title: options.title,
          unsafeIncludeRaw: options.unsafeIncludeRaw,
        });

        if (!result.success) {
          if (getOutputOptions().json) {
            output({ success: false, error: result.error });
          } else {
            console.error(`Failed to create POPL entry: ${result.error}`);
          }
          process.exit(1);
        }

        if (getOutputOptions().json) {
          output({
            success: true,
            entry_id: result.entryId,
            entry_path: result.entryPath,
            popl_yml_path: result.poplYmlPath,
          });
        } else {
          console.log('POPL entry created successfully.');
          console.log('');
          console.log(`  Entry ID: ${result.entryId}`);
          console.log(`  Path: ${result.entryPath}`);
          console.log(`  POPL.yml: ${result.poplYmlPath}`);
        }
      }
    );

  // popl list
  cmd
    .command('list')
    .alias('ls')
    .description('List POPL entries')
    .action(async () => {
      const cwd = process.cwd();

      if (!hasPoplDir(cwd)) {
        if (getOutputOptions().json) {
          output({ success: false, error: '.popl directory not found' });
        } else {
          console.error('.popl directory not found.');
          console.error('Run "pfscan popl init" to initialize.');
        }
        process.exit(1);
      }

      try {
        const entries = await listPoplEntries(cwd);

        if (getOutputOptions().json) {
          // Read full entry data for JSON output
          const fullEntries = [];
          for (const entry of entries) {
            const doc = await readPoplEntry(entry.path);
            if (doc) {
              fullEntries.push({
                id: entry.id,
                path: entry.path,
                ...doc,
              });
            }
          }
          output({ success: true, entries: fullEntries });
          return;
        }

        if (entries.length === 0) {
          console.log('No POPL entries found.');
          console.log('Run "pfscan popl session --session <id>" to create one.');
          return;
        }

        console.log(`POPL Entries (${entries.length}):`);
        console.log('');

        for (const entry of entries) {
          const doc = await readPoplEntry(entry.path);
          if (doc) {
            console.log(`  ${doc.entry.id}`);
            console.log(`    Title: ${doc.entry.title}`);
            console.log(`    Target: ${doc.target.kind} (${doc.target.ids.connector_id || 'N/A'})`);
            console.log(`    Created: ${doc.entry.created_at}`);
            console.log(`    Trust: ${doc.entry.trust.label}`);
            console.log('');
          } else {
            console.log(`  ${entry.id} (invalid POPL.yml)`);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (getOutputOptions().json) {
          output({ success: false, error: msg });
        } else {
          console.error(`Failed to list entries: ${msg}`);
        }
        process.exit(1);
      }
    });

  // popl show
  cmd
    .command('show <entry-id>')
    .description('Show details of a POPL entry')
    .action(async (entryId: string) => {
      const cwd = process.cwd();

      if (!hasPoplDir(cwd)) {
        if (getOutputOptions().json) {
          output({ success: false, error: '.popl directory not found' });
        } else {
          console.error('.popl directory not found.');
        }
        process.exit(1);
      }

      const entriesDir = getPoplEntriesDir(cwd);
      const { join } = await import('path');
      const entryPath = join(entriesDir, entryId);

      const doc = await readPoplEntry(entryPath);

      if (!doc) {
        if (getOutputOptions().json) {
          output({ success: false, error: `Entry not found: ${entryId}` });
        } else {
          console.error(`Entry not found: ${entryId}`);
        }
        process.exit(1);
      }

      if (getOutputOptions().json) {
        output({ success: true, path: entryPath, ...doc });
        return;
      }

      // Human-readable output
      console.log('POPL Entry');
      console.log('═══════════════════════════════════════════════════\n');

      console.log(`ID:       ${doc.entry.id}`);
      console.log(`Title:    ${doc.entry.title}`);
      console.log(`Author:   ${doc.entry.author.name}${doc.entry.author.handle ? ` (@${doc.entry.author.handle})` : ''}`);
      console.log(`Created:  ${doc.entry.created_at}`);
      console.log(`Trust:    ${doc.entry.trust.label} (level ${doc.entry.trust.level})`);

      console.log('\nTarget:');
      console.log(`  Kind:        ${doc.target.kind}`);
      if (doc.target.ids.connector_id) {
        console.log(`  Connector:   ${doc.target.ids.connector_id}`);
      }
      if (doc.target.ids.session_id) {
        console.log(`  Session:     ${doc.target.ids.session_id}`);
      }

      console.log('\nCapture:');
      console.log(`  Started:     ${doc.capture.window.started_at}`);
      console.log(`  Ended:       ${doc.capture.window.ended_at}`);
      console.log(`  RPC Total:   ${doc.capture.summary.rpc_total}`);
      console.log(`  Errors:      ${doc.capture.summary.errors}`);
      if (doc.capture.summary.latency_ms_p50) {
        console.log(`  Latency P50: ${doc.capture.summary.latency_ms_p50}ms`);
      }
      if (doc.capture.summary.latency_ms_p95) {
        console.log(`  Latency P95: ${doc.capture.summary.latency_ms_p95}ms`);
      }

      console.log('\nEvidence:');
      console.log(`  Redaction:   ${doc.evidence.policy.redaction}`);
      console.log(`  Ruleset:     v${doc.evidence.policy.ruleset_version}`);
      console.log('  Artifacts:');
      for (const artifact of doc.evidence.artifacts) {
        console.log(`    - ${artifact.name} (${artifact.sha256.slice(0, 16)}...)`);
      }

      console.log(`\nPath: ${entryPath}`);
    });

  return cmd;
}
