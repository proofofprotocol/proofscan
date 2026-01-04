/**
 * POPL Command (Phase 6.0)
 *
 * pfscan popl init
 * pfscan popl session --session <session_id> [options]
 * pfscan popl list [--oneline]
 * pfscan popl show <entry-id> [view]
 *
 * CLI commands for POPL (Public Observable Proof Ledger) management.
 *
 * IMPORTANT: CLI does NOT handle @references (@last, @ref:xxx).
 * Those are resolved in the shell layer before calling service functions.
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, relative } from 'path';
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
import type { PoplDocument } from '../popl/types.js';

/** View names mapping to artifact files */
const VIEW_ARTIFACT_MAP: Record<string, string> = {
  popl: 'POPL.yml',
  status: 'status.json',
  rpc: 'rpc.sanitized.jsonl',
  log: 'validation-run.log',
};

/** Valid view names */
const VALID_VIEWS = Object.keys(VIEW_ARTIFACT_MAP);

/**
 * Get the observed time from a POPL document
 * Priority: capture.window.ended_at > capture.window.started_at > entry.created_at
 */
function getObservedTime(doc: PoplDocument): string {
  if (doc.capture?.window?.ended_at) {
    return doc.capture.window.ended_at;
  }
  if (doc.capture?.window?.started_at) {
    return doc.capture.window.started_at;
  }
  return doc.entry.created_at;
}

/**
 * Format timestamp for oneline display
 * Returns: YYYY-MM-DD HH:mm:ss TZ (e.g., "2026-01-04 20:35:00 +09:00")
 *
 * Uses manual formatting instead of toLocaleString() for:
 * - Consistent output format across all locales and platforms
 * - Fixed field widths for CLI column alignment
 * - Explicit timezone offset (not timezone name which varies by OS)
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      // Invalid date - return original string
      return isoString;
    }
    // Format in local timezone (manual for consistency across locales)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // Get timezone abbreviation
    const tzOffset = -date.getTimezoneOffset();
    const tzHours = Math.floor(Math.abs(tzOffset) / 60);
    const tzMins = Math.abs(tzOffset) % 60;
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tz = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMins).padStart(2, '0')}`;

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${tz}`;
  } catch {
    return isoString;
  }
}

/**
 * Resolve entry ID by prefix matching
 * Returns: { entryId, entryPath } or error
 */
async function resolveEntryId(
  cwd: string,
  idOrPrefix: string
): Promise<{ success: true; entryId: string; entryPath: string } | { success: false; error: string; candidates?: string[] }> {
  const entries = await listPoplEntries(cwd);

  // Exact match first
  const exactMatch = entries.find(e => e.id === idOrPrefix);
  if (exactMatch) {
    return { success: true, entryId: exactMatch.id, entryPath: exactMatch.path };
  }

  // Prefix match
  const prefixMatches = entries.filter(e => e.id.startsWith(idOrPrefix));

  if (prefixMatches.length === 0) {
    return { success: false, error: `Entry not found: ${idOrPrefix}` };
  }

  if (prefixMatches.length === 1) {
    return { success: true, entryId: prefixMatches[0].id, entryPath: prefixMatches[0].path };
  }

  // Multiple matches - ambiguous
  return {
    success: false,
    error: `Ambiguous entry ID prefix: ${idOrPrefix} (${prefixMatches.length} matches)`,
    candidates: prefixMatches.map(e => e.id),
  };
}

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
    .option('--oneline', 'One line per entry (compact format)')
    .action(async (options: { oneline?: boolean }) => {
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
                path: relative(cwd, entry.path),
                observed_at: getObservedTime(doc),
                recorded_at: doc.entry.created_at,
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

        // Oneline format
        if (options.oneline) {
          for (const entry of entries) {
            const doc = await readPoplEntry(entry.path);
            if (doc) {
              const observed = formatTimestamp(getObservedTime(doc));
              const title = doc.entry.title || '(no title)';
              console.log(`${observed} | ${title} | ${doc.entry.id}`);
            } else {
              console.log(`(invalid) | (invalid POPL.yml) | ${entry.id}`);
            }
          }
          return;
        }

        // Detailed format (default)
        console.log(`POPL Entries (${entries.length}):`);
        console.log('');

        for (const entry of entries) {
          const doc = await readPoplEntry(entry.path);
          if (doc) {
            const observed = getObservedTime(doc);
            console.log(`  ${doc.entry.id}`);
            console.log(`    Title:    ${doc.entry.title}`);
            console.log(`    Target:   ${doc.target.kind} (${doc.target.ids.connector_id || 'N/A'})`);
            console.log(`    Observed: ${observed}`);
            console.log(`    Recorded: ${doc.entry.created_at}`);
            console.log(`    Trust:    ${doc.entry.trust.label}`);
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
    .command('show <entry-id> [view]')
    .description(
      'Show details of a POPL entry or view an artifact\n' +
      '  view: popl | status | rpc | log (optional, shows artifact content)'
    )
    .option('--local', 'Show local absolute paths (for debugging)')
    .action(async (entryIdOrPrefix: string, view: string | undefined, options: { local?: boolean }) => {
      const cwd = process.cwd();

      if (!hasPoplDir(cwd)) {
        if (getOutputOptions().json) {
          output({ success: false, error: '.popl directory not found' });
        } else {
          console.error('.popl directory not found.');
        }
        process.exit(1);
      }

      // Resolve entry ID (supports prefix matching)
      const resolved = await resolveEntryId(cwd, entryIdOrPrefix);

      if (!resolved.success) {
        if (getOutputOptions().json) {
          output({
            success: false,
            error: resolved.error,
            candidates: resolved.candidates,
          });
        } else {
          console.error(resolved.error);
          if (resolved.candidates && resolved.candidates.length > 0) {
            console.error('Did you mean one of these?');
            for (const candidate of resolved.candidates) {
              console.error(`  - ${candidate}`);
            }
          }
        }
        process.exit(1);
      }

      const { entryId, entryPath } = resolved;
      const doc = await readPoplEntry(entryPath);

      if (!doc) {
        if (getOutputOptions().json) {
          output({ success: false, error: `Invalid POPL.yml in entry: ${entryId}` });
        } else {
          console.error(`Invalid POPL.yml in entry: ${entryId}`);
        }
        process.exit(1);
      }

      // If view is specified, output the artifact content
      if (view) {
        const viewLower = view.toLowerCase();
        if (!VALID_VIEWS.includes(viewLower)) {
          if (getOutputOptions().json) {
            output({
              success: false,
              error: `Invalid view: ${viewLower}`,
              valid_views: VALID_VIEWS,
            });
          } else {
            console.error(`Invalid view: ${viewLower}`);
            console.error(`Valid views: ${VALID_VIEWS.join(', ')}`);
          }
          process.exit(1);
        }

        const artifactFile = VIEW_ARTIFACT_MAP[viewLower];
        const artifactPath = join(entryPath, artifactFile);

        if (!existsSync(artifactPath)) {
          // List available artifacts
          const availableArtifacts = doc.evidence.artifacts.map(a => a.name);

          if (getOutputOptions().json) {
            output({
              success: false,
              error: `Artifact not found: ${artifactFile}`,
              available: availableArtifacts,
            });
          } else {
            console.error(`Artifact not found: ${artifactFile}`);
            console.error('Available artifacts:');
            for (const name of availableArtifacts) {
              console.error(`  - ${name}`);
            }
          }
          process.exit(1);
        }

        // Read and output the artifact content
        const content = await readFile(artifactPath, 'utf-8');

        if (getOutputOptions().json) {
          // For JSON output, try to parse if it's JSON
          if (viewLower === 'status' || viewLower === 'popl') {
            try {
              const parsed = viewLower === 'popl'
                ? doc
                : JSON.parse(content);
              output({ success: true, entry_id: entryId, view: viewLower, data: parsed });
            } catch {
              output({ success: true, entry_id: entryId, view: viewLower, content });
            }
          } else {
            output({ success: true, entry_id: entryId, view: viewLower, content });
          }
        } else {
          // Raw output to stdout
          process.stdout.write(content);
          // Ensure newline at end if not present
          if (!content.endsWith('\n')) {
            process.stdout.write('\n');
          }
        }
        return;
      }

      // No view specified - show summary
      // Calculate relative path for display (avoid absolute paths in public output)
      const displayPath = relative(cwd, entryPath) || '.';

      if (getOutputOptions().json) {
        output({
          success: true,
          path: options.local ? entryPath : displayPath,
          ...doc,
        });
        return;
      }

      // Human-readable output
      console.log('POPL Entry');
      console.log('═══════════════════════════════════════════════════\n');

      console.log(`ID:       ${doc.entry.id}`);
      console.log(`Title:    ${doc.entry.title}`);
      console.log(`Author:   ${doc.entry.author.name}${doc.entry.author.handle ? ` (@${doc.entry.author.handle})` : ''}`);
      console.log(`Recorded: ${doc.entry.created_at}`);
      console.log(`Trust:    ${doc.entry.trust.label} (level ${doc.entry.trust.level})`);

      console.log('\nTarget:');
      console.log(`  Kind:        ${doc.target.kind}`);
      if (doc.target.ids.connector_id) {
        console.log(`  Connector:   ${doc.target.ids.connector_id}`);
      }
      if (doc.target.ids.session_id) {
        console.log(`  Session:     ${doc.target.ids.session_id}`);
      }

      console.log('\nCapture (Observed):');
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

      // Show path (relative by default, absolute with --local)
      if (options.local) {
        console.log(`\nPath: ${entryPath}`);
      } else {
        console.log(`\nPath: ${displayPath}`);
      }

      // Show available views hint
      console.log(`\nTip: Use "pfscan popl show ${entryId.slice(0, 8)} <view>" to see artifact content`);
      console.log(`     Views: ${VALID_VIEWS.join(', ')}`);
    });

  return cmd;
}
