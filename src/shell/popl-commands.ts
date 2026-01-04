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
import { join } from 'path';

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
      await handlePoplList();
      break;
    case 'show':
      await handlePoplShow(subArgs);
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
  printInfo('  popl init                Initialize .popl in current directory');
  printInfo('  popl session [@ref]      Create POPL entry for session');
  printInfo('  popl ls                  List POPL entries');
  printInfo('  popl show <entry-id>     Show POPL entry details');
  printInfo('');
  printInfo('Reference shortcuts:');
  printInfo('  popl @this               Create entry for current session');
  printInfo('  popl @last               Create entry for latest session');
  printInfo('  popl @ref:name           Create entry for named reference');
  printInfo('');
  printInfo('Examples:');
  printInfo('  popl init');
  printInfo('  popl session @last');
  printInfo('  popl session @this --title "My audit"');
  printInfo('  popl @last');
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === '--unsafe-include-raw') {
      unsafeIncludeRaw = true;
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
      printError(`Failed to resolve reference: ${resolved.error || 'unknown error'}`);
      return;
    }

    // Must have a session
    if (!resolved.ref.session) {
      printError(`Reference does not point to a session: ${refArg}`);
      printInfo('POPL entries require a session. Use @last or cd into a session first.');
      return;
    }

    sessionId = resolved.ref.session;
  } else {
    // Literal session ID
    sessionId = refArg;
  }

  // Create POPL entry using service layer
  printInfo(`Creating POPL entry for session: ${sessionId.slice(0, 8)}...`);

  const result = await createSessionPoplEntry(sessionId, configDir, {
    outputRoot: cwd,
    title,
    unsafeIncludeRaw,
  });

  if (!result.success) {
    printError(`Failed to create POPL entry: ${result.error}`);
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
async function handlePoplList(): Promise<void> {
  const cwd = process.cwd();

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

    console.log(`\nPOPL Entries (${entries.length}):\n`);

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
        console.log(`  ${entry.id} ${dimText('(invalid POPL.yml)')}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    printError(`Failed to list entries: ${msg}`);
  }
}

/**
 * Handle 'popl show' command
 */
async function handlePoplShow(args: string[]): Promise<void> {
  const cwd = process.cwd();

  if (args.length === 0) {
    printError('Usage: popl show <entry-id>');
    return;
  }

  if (!hasPoplDir(cwd)) {
    printError('.popl directory not found.');
    return;
  }

  const entryId = args[0];
  const entriesDir = getPoplEntriesDir(cwd);
  const entryPath = join(entriesDir, entryId);

  const doc = await readPoplEntry(entryPath);

  if (!doc) {
    printError(`Entry not found: ${entryId}`);
    return;
  }

  // Display entry
  console.log('\nPOPL Entry');
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
    console.log(`    - ${artifact.name} ${dimText(`(${artifact.sha256.slice(0, 16)}...)`)}`);
  }

  console.log(`\nPath: ${entryPath}`);
}
