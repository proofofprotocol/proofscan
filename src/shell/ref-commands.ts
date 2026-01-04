/**
 * Shell ref commands: ref add, ref ls, ref rm, ref <@target> (Phase 4.1-4.2)
 *
 * These commands manage user-defined references and resolve references.
 *
 * Commands:
 * - ref add <name> @this     : Save current context as named reference
 * - ref add <name> @last     : Save latest session/rpc as named reference
 * - ref add <name> @rpc:<id> : Save specific RPC as named reference
 * - ref ls                   : List all user-defined references
 * - ref rm <name>            : Remove a user-defined reference
 *
 * Resolve mode (argument starts with @):
 * - ref @this                : Resolve and display current context
 * - ref @last                : Resolve and display latest session/RPC
 * - ref @rpc:<id>            : Resolve and display specific RPC reference
 * - ref @ref:<name>          : Resolve and display user-defined reference
 * - ref @... --json          : Output RefStruct as JSON
 *
 * Pipe support:
 * - pwd --json | ref add <name> : Save piped JSON as reference
 */

import type { ShellContext } from './types.js';
import { printSuccess, printError, printInfo, dimText } from './prompt.js';
import { EventsStore } from '../db/events-store.js';
import { ConfigManager } from '../config/index.js';
import {
  RefResolver,
  createRefDataProvider,
  createRefFromContext,
  parseRef,
  isRef,
  refFromJson,
  refToJson,
  type RefStruct,
} from './ref-resolver.js';

/** Max length for reference names */
const REF_NAME_MAX_LENGTH = 64;

/** Pattern for valid reference names: alphanumeric, hyphens, underscores */
const REF_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Reserved names that cannot be used as reference names */
const RESERVED_NAMES = ['this', 'last', 'rpc', 'session', 'fav', 'ref'];

/**
 * Pattern for valid POPL entry IDs
 * ULID format: 26 alphanumeric characters (Crockford's Base32)
 * Also allows shorter prefixes for prefix matching
 */
const ENTRY_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]+$/i;

/** Minimum entry ID length for validation */
const ENTRY_ID_MIN_LENGTH = 8;

/**
 * Validate POPL entry ID format
 * @returns Error message if invalid, null if valid
 */
function validateEntryId(entryId: string): string | null {
  if (!entryId) {
    return 'Entry ID is required';
  }
  if (entryId.length < ENTRY_ID_MIN_LENGTH) {
    return `Entry ID too short (min ${ENTRY_ID_MIN_LENGTH} chars): ${entryId}`;
  }
  if (entryId.includes('/') || entryId.includes('..')) {
    return `Invalid entry ID (contains path characters): ${entryId}`;
  }
  if (!ENTRY_ID_PATTERN.test(entryId)) {
    return `Invalid entry ID format (expected ULID): ${entryId}`;
  }
  return null;
}

/**
 * Validate reference name
 * @returns Error message if invalid, null if valid
 */
function validateRefName(name: string): string | null {
  if (!name) {
    return 'Reference name is required';
  }
  if (name.startsWith('@')) {
    return `Name cannot start with @: ${name}`;
  }
  if (name.length > REF_NAME_MAX_LENGTH) {
    return `Name too long (max ${REF_NAME_MAX_LENGTH} chars): ${name}`;
  }
  if (!REF_NAME_PATTERN.test(name)) {
    return `Invalid name. Use only letters, numbers, hyphens, and underscores: ${name}`;
  }
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    return `Reserved name cannot be used: ${name}`;
  }
  return null;
}

/**
 * Handle 'ref' command
 */
export async function handleRef(
  args: string[],
  context: ShellContext,
  configPath: string,
  stdinData?: string
): Promise<void> {
  if (args.length === 0) {
    printInfo('Usage: ref <subcommand> or ref <@target>');
    printInfo('');
    printInfo('Subcommands:');
    printInfo('  ref add <name> @this     Save current context');
    printInfo('  ref add <name> @last     Save latest session/rpc');
    printInfo('  ref add <name> @rpc:<id> Save specific RPC');
    printInfo('  ref ls                   List all refs');
    printInfo('  ref rm <name>            Remove a ref');
    printInfo('');
    printInfo('Resolve mode (@ prefix):');
    printInfo('  ref @this                Resolve current context');
    printInfo('  ref @last                Resolve latest session/RPC');
    printInfo('  ref @rpc:<id>            Resolve specific RPC');
    printInfo('  ref @ref:<name>          Resolve saved reference');
    printInfo('  ref @... --json          Output as JSON');
    printInfo('');
    printInfo('Pipe support:');
    printInfo('  pwd --json | ref add <name>');
    return;
  }

  const firstArg = args[0];

  // Resolve mode: if first argument starts with @, resolve the reference
  if (isRef(firstArg)) {
    await handleRefResolve(args, context, configPath);
    return;
  }

  const subcommand = firstArg;
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'add':
      await handleRefAdd(subArgs, context, configPath, stdinData);
      break;
    case 'ls':
    case 'list':
      await handleRefLs(subArgs, configPath);
      break;
    case 'rm':
    case 'remove':
    case 'delete':
      await handleRefRm(subArgs, configPath);
      break;
    default:
      printError(`Unknown subcommand: ${subcommand}`);
      printInfo('Available: add, ls, rm');
      printInfo('Or use: ref @this, ref @last, ref @rpc:<id>, ref @ref:<name>');
  }
}

/**
 * Handle 'ref @...' - resolve and display a reference (Phase 4.2)
 *
 * This is "resolve mode" - when the first argument starts with @
 *
 * Examples:
 *   ref @this           - Show current context as reference
 *   ref @last           - Show latest session/RPC as reference
 *   ref @rpc:abc123     - Show specific RPC reference
 *   ref @ref:myname     - Show saved user-defined reference
 *   ref @this --json    - Output as JSON for piping
 */
async function handleRefResolve(
  args: string[],
  context: ShellContext,
  configPath: string
): Promise<void> {
  const isJson = args.includes('--json');
  const target = args.find(a => !a.startsWith('-') && a.startsWith('@'));

  if (!target) {
    printError('No reference target specified');
    return;
  }

  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());
  const dataProvider = createRefDataProvider(eventsStore);
  const resolver = new RefResolver(dataProvider);

  // Special handling for @this - use createRefFromContext directly
  const parsed = parseRef(target);
  let ref: RefStruct;

  if (parsed.type === 'this') {
    ref = createRefFromContext(context);
    ref.source = '@this';
  } else {
    const result = resolver.resolve(target, context);
    if (!result.success || !result.ref) {
      printError(result.error || `Failed to resolve: ${target}`);
      return;
    }
    ref = result.ref;
  }

  // Output
  if (isJson) {
    console.log(refToJson(ref));
    return;
  }

  // Human-readable format
  console.log();
  console.log(`Reference: ${target}`);
  console.log(`  Kind: ${ref.kind}`);

  // Display appropriate fields based on kind
  if (ref.kind === 'popl') {
    if (ref.entry_id) console.log(`  Entry ID: ${ref.entry_id}`);
    if (ref.target) console.log(`  Target: ${ref.target}`);
  } else {
    if (ref.connector) console.log(`  Connector: ${ref.connector}`);
    if (ref.session) console.log(`  Session: ${ref.session.slice(0, 8)}...`);
    if (ref.rpc) console.log(`  RPC: ${ref.rpc}`);
    if (ref.proto) console.log(`  Proto: ${ref.proto}`);
    if (ref.level) console.log(`  Level: ${ref.level}`);
  }

  if (ref.captured_at) console.log(`  Captured: ${ref.captured_at}`);
  console.log();
  printInfo('Tip: Use --json to get JSON output for piping');
  printInfo('     Use "show ..." to view resource details instead of address');
}

/**
 * Handle 'ref add' - save a reference
 *
 * Supports multiple input modes:
 * 1. ref add <name> @ref       - Resolve @ref and save
 * 2. ... | ref add <name>      - Read JSON from stdin (pipe)
 * 3. ref add <name> (with stdin) - Read from stdin if available
 *
 * Stdin accepts:
 * - JSON: {"kind": "popl", "entry_id": "...", "target": "popl/..."}
 * - Simple string: popl/<entry_id>
 */
async function handleRefAdd(
  args: string[],
  context: ShellContext,
  configPath: string,
  stdinData?: string
): Promise<void> {
  // Check for stdin data first (pipe support)
  if (stdinData) {
    // Format: ref add <name> (with piped JSON or string)
    const name = args[0];
    if (!name) {
      printError('Usage: ... | ref add <name>');
      return;
    }

    const validationError = validateRefName(name);
    if (validationError) {
      printError(validationError);
      return;
    }

    // Try JSON first
    const ref = refFromJson(stdinData);
    if (ref) {
      // Validate entry_id for popl refs
      if (ref.kind === 'popl' && ref.entry_id) {
        const entryIdError = validateEntryId(ref.entry_id);
        if (entryIdError) {
          printError(entryIdError);
          return;
        }
      }
      await saveRef(name, ref, configPath);
      return;
    }

    // Try simple string format: popl/<entry_id>
    const trimmed = stdinData.trim();
    const poplMatch = trimmed.match(/^popl\/(.+)$/);
    if (poplMatch) {
      const entryId = poplMatch[1];

      // Validate entry_id format
      const entryIdError = validateEntryId(entryId);
      if (entryIdError) {
        printError(entryIdError);
        return;
      }

      const poplRef: RefStruct = {
        kind: 'popl',
        entry_id: entryId,
        target: `popl/${entryId}`,
        captured_at: new Date().toISOString(),
      };
      await saveRef(name, poplRef, configPath);
      return;
    }

    printError('Invalid stdin input');
    printInfo('Expected: JSON ({"kind": "popl", ...}) or string (popl/<id>)');
    return;
  }

  // Format: ref add <name> @ref
  if (args.length < 2) {
    printError('Usage: ref add <name> <@ref>');
    printInfo('Example: ref add myref @this');
    printInfo('Pipe:    popl @this --json | ref add myref');
    return;
  }

  const name = args[0];
  const refArg = args[1];

  const validationError = validateRefName(name);
  if (validationError) {
    printError(validationError);
    return;
  }

  // Parse and resolve the reference
  const parsed = parseRef(refArg);
  if (parsed.type === 'literal') {
    printError(`Not a valid reference: ${refArg}`);
    printInfo('Valid refs: @this, @last, @rpc:<id>, @session:<id>');
    return;
  }

  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());
  const dataProvider = createRefDataProvider(eventsStore);
  const resolver = new RefResolver(dataProvider);

  // Handle @this specially - use current context directly
  let ref: RefStruct;
  if (parsed.type === 'this') {
    ref = createRefFromContext(context);
  } else {
    const result = resolver.resolve(refArg, context);
    if (!result.success || !result.ref) {
      printError(result.error || `Failed to resolve: ${refArg}`);
      return;
    }
    ref = result.ref;
  }

  await saveRef(name, ref, configPath);
}

/**
 * Save a reference to the database
 */
async function saveRef(name: string, ref: RefStruct, configPath: string): Promise<void> {
  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());

  eventsStore.saveUserRef(name, {
    kind: ref.kind,
    connector: ref.connector,
    session: ref.session,
    rpc: ref.rpc,
    proto: ref.proto,
    level: ref.level,
    captured_at: ref.captured_at,
    // popl-specific fields
    entry_id: ref.entry_id,
    target: ref.target,
  });

  printSuccess(`Saved reference: ${name}`);
  printInfo(`  Kind: ${ref.kind}`);

  // Display appropriate fields based on kind
  if (ref.kind === 'popl') {
    if (ref.entry_id) printInfo(`  Entry ID: ${ref.entry_id.slice(0, 12)}...`);
    if (ref.target) printInfo(`  Target: ${ref.target}`);
  } else {
    if (ref.connector) printInfo(`  Connector: ${ref.connector}`);
    if (ref.session) printInfo(`  Session: ${ref.session.slice(0, 8)}`);
    if (ref.rpc) printInfo(`  RPC: ${ref.rpc}`);
  }
}

/**
 * Handle 'ref ls' - list all references
 */
async function handleRefLs(args: string[], configPath: string): Promise<void> {
  const isJson = args.includes('--json');

  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());

  const refs = eventsStore.listUserRefs();

  if (refs.length === 0) {
    printInfo('No user-defined references');
    printInfo('Create one with: ref add <name> @this');
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(refs, null, 2));
    return;
  }

  // Table format
  const isTTY = process.stdout.isTTY;
  console.log();

  // Calculate column widths
  const maxName = Math.max(8, ...refs.map(r => r.name.length));

  // Header
  console.log(
    dimText('Name', isTTY).padEnd(isTTY ? maxName + 9 : maxName) + '  ' +
    dimText('Kind', isTTY).padEnd(isTTY ? 17 : 10) + '  ' +
    dimText('Target', isTTY)
  );
  console.log(dimText('-'.repeat(maxName + 50), isTTY));

  // Rows
  for (const ref of refs) {
    let target = '';

    // Handle different ref kinds
    if (ref.kind === 'popl') {
      // For popl refs, show target directly
      target = ref.target || `popl/${ref.entry_id || '?'}`;
    } else {
      // For other refs, build path from connector/session/rpc
      if (ref.connector) target = ref.connector;
      if (ref.session) target += '/' + ref.session.slice(0, 8);
      if (ref.rpc) target += '/' + ref.rpc.slice(0, 8);
      if (!target) target = '(root)';
    }

    console.log(
      ref.name.padEnd(maxName) + '  ' +
      ref.kind.padEnd(10) + '  ' +
      target
    );
  }

  console.log();
  printInfo(`${refs.length} reference(s). Use: @ref:<name> to reference`);
}

/**
 * Handle 'ref rm' - remove a reference
 */
async function handleRefRm(args: string[], configPath: string): Promise<void> {
  const name = args.find(a => !a.startsWith('-'));

  if (!name) {
    printError('Usage: ref rm <name>');
    return;
  }

  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());

  const deleted = eventsStore.deleteUserRef(name);

  if (deleted) {
    printSuccess(`Deleted reference: ${name}`);
  } else {
    printError(`Reference not found: ${name}`);
  }
}

/**
 * Get ref names for completion
 */
export async function getRefNamesForCompletion(configPath: string): Promise<string[]> {
  try {
    const manager = new ConfigManager(configPath);
    const eventsStore = new EventsStore(manager.getConfigDir());
    const refs = eventsStore.listUserRefs();
    return refs.map(r => r.name);
  } catch {
    return [];
  }
}
