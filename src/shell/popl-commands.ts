/**
 * Shell POPL commands (Phase 6.0)
 *
 * Shell commands for POPL with @reference support.
 *
 * Commands:
 * - popl init                    : Initialize .popl in current directory
 * - popl session [@ref]          : Create POPL entry for session
 * - popl ls                      : List POPL entries
 * - popl show <entry-id>         : Show POPL entry details
 *
 * Reference resolution:
 * - @this     : Current session from context
 * - @last     : Most recent session
 * - @ref:name : User-defined reference
 * - @session:id : Explicit session ID
 *
 * IMPORTANT: Shell resolves @references to session IDs,
 * then calls the shared service layer (same as CLI).
 */

import type { ShellContext } from './types.js';
import { printSuccess, printError, printInfo, dimText } from './prompt.js';
import { ConfigManager } from '../config/index.js';
import { EventsStore } from '../db/events-store.js';
import {
  RefResolver,
  createRefDataProvider,
  isRef,
} from './ref-resolver.js';
import {
  hasPoplDir,
  initPoplDir,
  createSessionPoplEntry,
  listPoplEntries,
  readPoplEntry,
  getPoplEntriesDir,
} from '../popl/index.js';
import { join, relative } from 'path';
import { existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import type { PoplDocument } from '../popl/types.js';

/** View names mapping to artifact files */
const VIEW_ARTIFACT_MAP: Record<string, string> = {
  popl: 'POPL.yml',
  status: 'status.json',
  rpc: 'rpc.sanitized.jsonl',
  log: 'validation-run.log',
};

/** Valid view names */
export const VALID_VIEWS = Object.keys(VIEW_ARTIFACT_MAP);

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
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

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

/**
 * Get POPL entry ID prefixes for TAB completion (async version)
 */
export async function getPoplEntryPrefixes(limit: number = 50): Promise<string[]> {
  const cwd = process.cwd();
  if (!hasPoplDir(cwd)) {
    return [];
  }
  try {
    const entries = await listPoplEntries(cwd);
    return entries.slice(0, limit).map(e => e.id);
  } catch {
    return [];
  }
}

/**
 * Get POPL entry IDs synchronously for TAB completion
 * Uses readdirSync to avoid async issues with readline completer
 */
export function getPoplEntryIdsSync(limit: number = 50): string[] {
  const cwd = process.cwd();
  if (!hasPoplDir(cwd)) {
    return [];
  }
  try {
    const entriesDir = getPoplEntriesDir(cwd);
    if (!existsSync(entriesDir)) {
      return [];
    }
    const entries = readdirSync(entriesDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Handle 'popl' shell command
 */
export async function handlePopl(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  if (args.length === 0) {
    printPoplHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'init':
      await handlePoplInit();
      break;
    case 'session':
      await handlePoplSession(subArgs, context, configPath);
      break;
    case 'ls':
    case 'list':
      await handlePoplList(subArgs);
      break;
    case 'show':
      await handlePoplShow(subArgs, configPath);
      break;
    default:
      // Check if it's a direct @reference (popl @last)
      if (subcommand.startsWith('@')) {
        await handlePoplSession([subcommand, ...subArgs], context, configPath);
      } else {
        printError(`Unknown popl subcommand: ${subcommand}`);
        printPoplHelp();
      }
  }
}

/**
 * Print help for popl command
 */
function printPoplHelp(): void {
  printInfo('Usage: popl <subcommand>');
  printInfo('');
  printInfo('Subcommands:');
  printInfo('  popl init                  Initialize .popl in current directory');
  printInfo('  popl session [@ref]        Create POPL entry for session');
  printInfo('  popl ls [-s|--oneline]     List POPL entries');
  printInfo('  popl show <id|@ref> [view] Show POPL entry or artifact');
  printInfo('');
  printInfo('Views for show command:');
  printInfo('  popl, status, rpc, log     (default: popl)');
  printInfo('');
  printInfo('Reference shortcuts:');
  printInfo('  popl @this               Create entry for current session');
  printInfo('  popl @last               Create entry for latest session');
  printInfo('  popl @ref:name           Create entry for named reference');
  printInfo('');
  printInfo('Options for session:');
  printInfo('  --json                   Output JSON for piping');
  printInfo('  --title <title>          Set custom title');
  printInfo('');
  printInfo('Examples:');
  printInfo('  popl init');
  printInfo('  popl ls --oneline');
  printInfo('  popl show 01JG status');
  printInfo('  popl session @last --title "My audit"');
  printInfo('  popl @last --json | ref add myentry');
  printInfo('  popl show @ref:myentry');
}

/**
 * Handle 'popl init' command
 */
async function handlePoplInit(): Promise<void> {
  const cwd = process.cwd();

  if (hasPoplDir(cwd)) {
    printInfo('.popl directory already exists.');
    return;
  }

  try {
    await initPoplDir(cwd);
    printSuccess('Initialized .popl directory.');
    printInfo('');
    printInfo('Next steps:');
    printInfo('  1. Edit .popl/config.json to set your author info');
    printInfo('  2. Run "popl session @last" to create an entry');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    printError(`Failed to initialize: ${msg}`);
  }
}

/**
 * Handle 'popl session' command with @reference resolution
 *
 * Options:
 * - --json: Output JSON only (for piping to ref add)
 * - --title <title>: Set custom title
 * - --unsafe-include-raw: Include unsanitized artifacts
 */
async function handlePoplSession(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  const cwd = process.cwd();
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();

  // Check .popl exists
  if (!hasPoplDir(cwd)) {
    printError('.popl directory not found.');
    printInfo('Run "popl init" to initialize.');
    return;
  }

  // Parse arguments
  let refArg: string | undefined;
  let title: string | undefined;
  let unsafeIncludeRaw = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === '--unsafe-include-raw') {
      unsafeIncludeRaw = true;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg.startsWith('@') || !arg.startsWith('-')) {
      refArg = arg;
    }
  }

  // Default to @this if no reference and we have context
  if (!refArg) {
    if (context.session) {
      refArg = '@this';
    } else {
      refArg = '@last';
    }
  }

  // Resolve reference to session ID
  let sessionId: string;

  if (isRef(refArg)) {
    // Create resolver
    const eventsStore = new EventsStore(configDir);
    const dataProvider = createRefDataProvider(eventsStore);
    const resolver = new RefResolver(dataProvider);

    const resolved = resolver.resolve(refArg, context);

    if (!resolved.success || !resolved.ref) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: resolved.error || 'unknown error' }));
      } else {
        printError(`Failed to resolve reference: ${resolved.error || 'unknown error'}`);
      }
      return;
    }

    // Must have a session
    if (!resolved.ref.session) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: `Reference does not point to a session: ${refArg}` }));
      } else {
        printError(`Reference does not point to a session: ${refArg}`);
        printInfo('POPL entries require a session. Use @last or cd into a session first.');
      }
      return;
    }

    sessionId = resolved.ref.session;
  } else {
    // Literal session ID
    sessionId = refArg;
  }

  // Create POPL entry using service layer
  if (!jsonOutput) {
    printInfo(`Creating POPL entry for session: ${sessionId.slice(0, 8)}...`);
  }

  const result = await createSessionPoplEntry(sessionId, configDir, {
    outputRoot: cwd,
    title,
    unsafeIncludeRaw,
  });

  if (!result.success) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      printError(`Failed to create POPL entry: ${result.error}`);
    }
    return;
  }

  // JSON output for piping (no local absolute paths for public ledger safety)
  if (jsonOutput) {
    const output = {
      kind: 'popl',
      entry_id: result.entryId,
      target: `popl/${result.entryId}`,
    };
    console.log(JSON.stringify(output));
    return;
  }

  printSuccess('POPL entry created successfully.');
  printInfo('');
  printInfo(`  Entry ID: ${result.entryId}`);
  printInfo(`  Path: ${result.entryPath}`);
  printInfo(`  POPL.yml: ${result.poplYmlPath}`);
}

/**
 * Handle 'popl ls' command
 */
async function handlePoplList(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // Parse options
  const oneline = args.includes('-s') || args.includes('--oneline');

  if (!hasPoplDir(cwd)) {
    printError('.popl directory not found.');
    printInfo('Run "popl init" to initialize.');
    return;
  }

  try {
    const entries = await listPoplEntries(cwd);

    if (entries.length === 0) {
      printInfo('No POPL entries found.');
      printInfo('Run "popl session @last" to create one.');
      return;
    }

    if (oneline) {
      // One-line format: <timestamp> | <title> | <id>
      for (const entry of entries) {
        const doc = await readPoplEntry(entry.path);
        if (doc) {
          const observed = getObservedTime(doc);
          const formatted = formatTimestamp(observed);
          const title = doc.entry.title || '(no title)';
          console.log(`${formatted} | ${title} | ${doc.entry.id}`);
        } else {
          console.log(`(invalid) | (invalid POPL.yml) | ${entry.id}`);
        }
      }
    } else {
      // Default detailed format
      console.log(`\nPOPL Entries (${entries.length}):\n`);

      for (const entry of entries) {
        const doc = await readPoplEntry(entry.path);
        if (doc) {
          const observed = getObservedTime(doc);
          console.log(`  ${doc.entry.id}`);
          console.log(`    Title: ${doc.entry.title}`);
          console.log(`    Target: ${doc.target.kind} (${doc.target.ids.connector_id || 'N/A'})`);
          console.log(`    Observed: ${formatTimestamp(observed)}`);
          console.log(`    Recorded: ${formatTimestamp(doc.entry.created_at)}`);
          console.log(`    Trust: ${doc.entry.trust.label}`);
          console.log('');
        } else {
          console.log(`  ${entry.id} ${dimText('(invalid POPL.yml)')}`);
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    printError(`Failed to list entries: ${msg}`);
  }
}

/**
 * Handle 'popl show' command
 *
 * Supports:
 * - popl show <entry-id>       : Direct entry ID (with prefix matching)
 * - popl show <id> [view]      : Show specific artifact view
 * - popl show @ref:<name>      : Resolve ref to POPL entry
 * - popl show @popl:<id>       : Explicit POPL reference
 */
async function handlePoplShow(args: string[], configPath: string): Promise<void> {
  const cwd = process.cwd();

  if (args.length === 0) {
    printError('Usage: popl show <entry-id|@ref:name> [view]');
    printInfo('Views: popl, status, rpc, log');
    return;
  }

  if (!hasPoplDir(cwd)) {
    printError('.popl directory not found.');
    return;
  }

  // Parse arguments: <entry-id|@ref> [view]
  let entryIdArg = args[0];
  const view = args.length > 1 ? args[1].toLowerCase() : undefined;

  // Check if it's a @ref:<name> or @popl:<id> reference
  if (isRef(entryIdArg)) {
    const manager = new ConfigManager(configPath);
    const eventsStore = new EventsStore(manager.getConfigDir());
    const dataProvider = createRefDataProvider(eventsStore);
    const resolver = new RefResolver(dataProvider);

    const result = resolver.resolve(entryIdArg, {});

    if (!result.success || !result.ref) {
      printError(`Failed to resolve reference: ${result.error || 'unknown error'}`);
      return;
    }

    // Must be a popl kind reference
    if (result.ref.kind !== 'popl') {
      printError(`Reference is not a POPL entry: ${entryIdArg}`);
      printInfo(`Reference kind: ${result.ref.kind}`);
      return;
    }

    // Get entry_id from the resolved ref
    if (!result.ref.entry_id) {
      printError(`Reference does not have a POPL entry ID: ${entryIdArg}`);
      return;
    }

    entryIdArg = result.ref.entry_id;
  }

  // Validate view if provided
  if (view && !VALID_VIEWS.includes(view)) {
    printError(`Invalid view: ${view}`);
    printInfo(`Valid views: ${VALID_VIEWS.join(', ')}`);
    return;
  }

  // Resolve entry ID (supports prefix matching)
  const resolved = await resolveEntryId(cwd, entryIdArg);
  if (!resolved.success) {
    printError(resolved.error);
    if (resolved.candidates && resolved.candidates.length > 0) {
      printInfo('Matching entries:');
      const displayLimit = 10;
      for (const candidate of resolved.candidates.slice(0, displayLimit)) {
        printInfo(`  ${candidate}`);
      }
      if (resolved.candidates.length > displayLimit) {
        printInfo(`  ... and ${resolved.candidates.length - displayLimit} more`);
      }
      printInfo('Provide a longer prefix to disambiguate.');
    }
    return;
  }

  const { entryId, entryPath } = resolved;
  const displayPath = relative(cwd, entryPath) || '.';

  // If view is specified, show artifact content
  if (view) {
    const artifactFile = VIEW_ARTIFACT_MAP[view];
    const artifactPath = join(entryPath, artifactFile);

    if (!existsSync(artifactPath)) {
      printError(`Artifact not found: ${artifactFile}`);
      printInfo(`Path: ${relative(cwd, artifactPath)}`);
      return;
    }

    try {
      const content = await readFile(artifactPath, 'utf-8');
      process.stdout.write(content);
      // Ensure newline at end
      if (!content.endsWith('\n')) {
        process.stdout.write('\n');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      printError(`Failed to read artifact: ${msg}`);
    }
    return;
  }

  // Default: show POPL entry metadata
  const doc = await readPoplEntry(entryPath);

  if (!doc) {
    printError(`Failed to read POPL.yml: ${entryId}`);
    return;
  }

  const observed = getObservedTime(doc);

  // Display entry
  console.log('\nPOPL Entry');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`ID:       ${doc.entry.id}`);
  console.log(`Title:    ${doc.entry.title}`);
  console.log(`Author:   ${doc.entry.author.name}${doc.entry.author.handle ? ` (@${doc.entry.author.handle})` : ''}`);
  console.log(`Observed: ${formatTimestamp(observed)}`);
  console.log(`Recorded: ${formatTimestamp(doc.entry.created_at)}`);
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
    console.log(`    - ${artifact.name} ${dimText(`(${artifact.sha256.slice(0, 16)}...)`)}`);
  }

  console.log(`\nPath: ${displayPath}`);
  console.log(`\nTip: Use "popl show ${entryId.slice(0, 8)} <view>" to see artifact content`);
  console.log(`     Views: ${VALID_VIEWS.join(', ')}`);
}
