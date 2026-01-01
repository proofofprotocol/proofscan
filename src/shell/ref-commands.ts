/**
 * Shell ref commands: ref add, ref ls, ref rm (Phase 4.1)
 *
 * These commands manage user-defined references.
 *
 * Commands:
 * - ref add <name> @this     : Save current context as named reference
 * - ref add <name> @last     : Save latest session/rpc as named reference
 * - ref add <name> @rpc:<id> : Save specific RPC as named reference
 * - ref ls                   : List all user-defined references
 * - ref rm <name>            : Remove a user-defined reference
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
  refFromJson,
  type RefStruct,
} from './ref-resolver.js';

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
    printInfo('Usage: ref <subcommand>');
    printInfo('  ref add <name> @this     Save current context');
    printInfo('  ref add <name> @last     Save latest session/rpc');
    printInfo('  ref add <name> @rpc:<id> Save specific RPC');
    printInfo('  ref ls                   List all refs');
    printInfo('  ref rm <name>            Remove a ref');
    printInfo('');
    printInfo('Pipe support:');
    printInfo('  pwd --json | ref add <name>');
    return;
  }

  const subcommand = args[0];
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
  }
}

/**
 * Handle 'ref add' - save a reference
 */
async function handleRefAdd(
  args: string[],
  context: ShellContext,
  configPath: string,
  stdinData?: string
): Promise<void> {
  // Check for stdin data first (pipe support)
  if (stdinData) {
    // Format: ref add <name> (with piped JSON)
    const name = args[0];
    if (!name) {
      printError('Usage: ... | ref add <name>');
      return;
    }

    if (name.startsWith('@')) {
      printError(`Name cannot start with @: ${name}`);
      printInfo('@ is reserved for reference resolution');
      return;
    }

    const ref = refFromJson(stdinData);
    if (!ref) {
      printError('Invalid JSON input');
      printInfo('Expected RefStruct JSON (use pwd --json to generate)');
      return;
    }

    await saveRef(name, ref, configPath);
    return;
  }

  // Format: ref add <name> @ref
  if (args.length < 2) {
    printError('Usage: ref add <name> <@ref>');
    printInfo('Example: ref add myref @this');
    return;
  }

  const name = args[0];
  const refArg = args[1];

  if (name.startsWith('@')) {
    printError(`Name cannot start with @: ${name}`);
    printInfo('@ is reserved for reference resolution');
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
  });

  printSuccess(`Saved reference: ${name}`);
  printInfo(`  Kind: ${ref.kind}`);
  if (ref.connector) printInfo(`  Connector: ${ref.connector}`);
  if (ref.session) printInfo(`  Session: ${ref.session.slice(0, 8)}`);
  if (ref.rpc) printInfo(`  RPC: ${ref.rpc}`);
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
    if (ref.connector) target = ref.connector;
    if (ref.session) target += '/' + ref.session.slice(0, 8);
    if (ref.rpc) target += '/' + ref.rpc.slice(0, 8);
    if (!target) target = '(root)';

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
