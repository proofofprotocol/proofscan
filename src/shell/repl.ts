/**
 * Shell REPL implementation
 */

import * as readline from 'readline';
import { spawn } from 'child_process';
import type { ShellContext } from './types.js';
import {
  SHELL_BUILTINS,
  TOP_LEVEL_COMMANDS,
  ROUTER_COMMANDS,
  BLOCKED_IN_SHELL,
  BLOCKED_SUBCOMMANDS_IN_SHELL,
  DEFAULT_COMPLETION_LIMIT,
  SESSION_SEARCH_LIMIT,
} from './types.js';
import { applyContext } from './context-applicator.js';
import {
  handleCc,
  handleUp,
  handlePwd,
  handleLs,
  handleShow,
} from './router-commands.js';
import { generatePrompt, printSuccess, printError, printInfo, shortenSessionId } from './prompt.js';
import { loadHistory, saveHistory, addToHistory } from './history.js';
import { createCompleter, type DynamicDataProvider } from './completer.js';
import { selectConnector, selectSession, canInteract } from './selector.js';
import { EventLineStore } from '../eventline/store.js';
import { ConfigManager } from '../config/index.js';
import {
  getCurrentSession,
  setCurrentSession,
  clearCurrentSession,
} from '../utils/state.js';
import { handleTool, handleSend } from './tool-commands.js';
import { handleRef } from './ref-commands.js';
import { handleInscribe } from './inscribe-commands.js';
import { handlePopl, getPoplEntryIdsSync } from './popl-commands.js';
import { resolveCommand } from './command-resolver.js';

// Cache TTL in milliseconds (5 seconds)
const CACHE_TTL_MS = 5000;

/**
 * Validate an argument for safe command execution.
 * Since we use shell: false, most injection vectors are blocked.
 * We only reject the most dangerous shell metacharacters as defense-in-depth.
 *
 * Blocked characters: & | ; ` $ (command chaining and substitution)
 *                     \n \r (newline injection)
 *                     \0 (null byte injection)
 */
export function isValidArg(arg: string): boolean {
  const dangerousPattern = /[&|;`$\n\r\0]/;
  return !dangerousPattern.test(arg);
}

/**
 * Parse a pipe command (e.g., "pwd --json | ref add name" or "pwd --json|ref add name")
 * Returns null if no pipe, or the left and right parts if pipe found
 * Exported for testing
 */
export function parsePipeCommand(line: string): { left: string; right: string } | null {
  // Find pipe character - support both ' | ' and '|' forms
  // First try with spaces, then without
  let pipeIndex = line.indexOf(' | ');
  let pipeLen = 3;

  if (pipeIndex === -1) {
    // Try without spaces (e.g., "--json|ref")
    pipeIndex = line.indexOf('|');
    pipeLen = 1;
  }

  if (pipeIndex === -1) {
    return null;
  }

  const left = line.slice(0, pipeIndex).trim();
  const right = line.slice(pipeIndex + pipeLen).trim();

  if (!left || !right) {
    return null;
  }

  return { left, right };
}

/**
 * Simple cache entry with expiration
 */
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

/**
 * Shell REPL class
 */
export class ShellRepl {
  private context: ShellContext;
  private rl: readline.Interface | null = null;
  private history: string[] = [];
  private configPath: string;
  private running = false;

  // Caches for completion data
  private connectorsCache: CacheEntry<string[]> | null = null;
  private sessionsCache: Map<string, CacheEntry<string[]>> = new Map();
  private rpcsCache: Map<string, CacheEntry<string[]>> = new Map();
  private poplEntriesCache: CacheEntry<string[]> | null = null;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.context = {};

    // Load existing session state
    const currentSession = getCurrentSession();
    if (currentSession) {
      this.context.session = currentSession.sessionId;
      this.context.connector = currentSession.connectorId;
    }
  }

  /**
   * Invalidate all caches (called after data-modifying commands)
   */
  private invalidateCache(): void {
    this.connectorsCache = null;
    this.sessionsCache.clear();
    this.rpcsCache.clear();
    this.poplEntriesCache = null;
  }

  /**
   * Get data provider for completions with caching
   */
  private getDataProvider(): DynamicDataProvider {
    const manager = new ConfigManager(this.configPath);
    const configDir = manager.getConfigDir();

    return {
      getConnectorIds: () => {
        const now = Date.now();
        if (this.connectorsCache && this.connectorsCache.expiry > now) {
          return this.connectorsCache.data;
        }
        try {
          const store = new EventLineStore(configDir);
          const ids = store.getConnectors().map(c => c.id);
          this.connectorsCache = { data: ids, expiry: now + CACHE_TTL_MS };
          return ids;
        } catch {
          return [];
        }
      },
      getSessionPrefixes: (connectorId?: string, limit: number = DEFAULT_COMPLETION_LIMIT) => {
        const now = Date.now();
        const cacheKey = `${connectorId || '*'}:${limit}`;
        const cached = this.sessionsCache.get(cacheKey);
        if (cached && cached.expiry > now) {
          return cached.data;
        }
        try {
          const store = new EventLineStore(configDir);
          const sessions = store.getSessions(connectorId, limit);
          const prefixes = sessions.map(s => shortenSessionId(s.session_id));
          this.sessionsCache.set(cacheKey, { data: prefixes, expiry: now + CACHE_TTL_MS });
          return prefixes;
        } catch {
          return [];
        }
      },
      getRpcIds: (sessionId?: string) => {
        if (!sessionId) return [];
        const now = Date.now();
        const cached = this.rpcsCache.get(sessionId);
        if (cached && cached.expiry > now) {
          return cached.data;
        }
        try {
          const store = new EventLineStore(configDir);
          const rpcs = store.getRpcCalls(sessionId);
          const ids = rpcs.map((_, i) => String(i + 1));
          this.rpcsCache.set(sessionId, { data: ids, expiry: now + CACHE_TTL_MS });
          return ids;
        } catch {
          return [];
        }
      },
      getPoplEntryIds: (limit: number = DEFAULT_COMPLETION_LIMIT) => {
        const now = Date.now();
        if (this.poplEntriesCache && this.poplEntriesCache.expiry > now) {
          return this.poplEntriesCache.data.slice(0, limit);
        }
        try {
          const ids = getPoplEntryIdsSync(limit);
          this.poplEntriesCache = { data: ids, expiry: now + CACHE_TTL_MS };
          return ids;
        } catch {
          return [];
        }
      },
    };
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    // Load history
    this.history = loadHistory();

    // Create completer
    const dataProvider = this.getDataProvider();
    const completer = createCompleter(this.context, dataProvider);

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: generatePrompt(this.context),
      completer: (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
        const [completions, prefix] = completer(line);
        callback(null, [completions, prefix]);
      },
      history: this.history,
      historySize: 1000,
    });

    this.running = true;

    // Print welcome message
    console.log();
    printInfo('proofscan shell - Type "help" for available commands, "exit" to quit');
    console.log();

    // Start prompt loop
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();

      if (trimmed) {
        // Resolve command (prefix matching, context expansion)
        const tokens = trimmed.split(/\s+/).filter(t => t !== '');
        const resolution = resolveCommand(tokens, this.context);

        if (!resolution.success) {
          // Show error for ambiguous commands
          printError(resolution.error!);
          if (resolution.candidates) {
            printInfo(`Did you mean: ${resolution.candidates.join(', ')}?`);
          }
        } else {
          // Use normalized command for history (e.g., "conn ls" → "connectors ls")
          const normalizedLine = resolution.resolved.join(' ') || trimmed;
          this.history = addToHistory(this.history, normalizedLine);
          await this.processLine(normalizedLine);
        }
      }

      if (this.running) {
        // Update prompt (context may have changed)
        this.rl!.setPrompt(generatePrompt(this.context));
        this.rl!.prompt();
      }
    });

    this.rl.on('close', () => {
      this.running = false;
      saveHistory(this.history);
      console.log();
      printInfo('Goodbye!');
    });

    // Handle SIGINT (Ctrl+C)
    this.rl.on('SIGINT', () => {
      console.log();
      this.rl!.prompt();
    });
  }

  /**
   * Process a line of input
   */
  private async processLine(line: string): Promise<void> {
    // Check for pipe syntax (e.g., "pwd --json | ref add name")
    const pipeResult = this.parsePipe(line);
    if (pipeResult) {
      await this.handlePipe(pipeResult.left, pipeResult.right);
      return;
    }

    const tokens = line.trim().split(/\s+/).filter(t => t !== '');
    if (tokens.length === 0) return;

    const command = tokens[0];
    const args = tokens.slice(1);

    // Handle router-style commands first
    if (ROUTER_COMMANDS.includes(command)) {
      await this.handleRouterCommand(command, args);
      return;
    }

    // Handle tool commands (shell-native)
    // 'tool call' is an alias for 'send' (CLI/shell command unification)
    if (command === 'tool') {
      if (args[0] === 'call') {
        // tool call <tool-name> [...] → handleSend(<tool-name>, [...])
        if (!this.rl) {
          printError('Shell not initialized');
          return;
        }
        const sendArgs = args.slice(1); // Remove 'call' from args
        await handleSend(sendArgs, this.context, this.configPath, this.rl);
        return;
      }
      await handleTool(args, this.context, this.configPath);
      return;
    }

    // Handle send command (shell-native with interactive input)
    if (command === 'send') {
      if (!this.rl) {
        printError('Shell not initialized');
        return;
      }
      await handleSend(args, this.context, this.configPath, this.rl);
      return;
    }

    // Handle ref command (shell-native)
    if (command === 'ref') {
      await handleRef(args, this.context, this.configPath);
      return;
    }

    // Handle inscribe command (shell-native, Phase 4.3)
    if (command === 'inscribe') {
      await handleInscribe(args, this.context, this.configPath);
      return;
    }

    // Handle popl command (shell-native, Phase 6.0)
    if (command === 'popl') {
      await handlePopl(args, this.context, this.configPath);
      return;
    }

    // Handle built-in commands
    if (SHELL_BUILTINS.includes(command)) {
      await this.handleBuiltin(command, args);
      return;
    }

    // Handle pfscan commands
    if (TOP_LEVEL_COMMANDS.includes(command)) {
      await this.executeCommand(tokens);
      return;
    }

    // Unknown command
    printError(`Unknown command: ${command}`);
    printInfo('Type "help" for available commands');
  }

  /**
   * Handle router-style commands (cd, ls, show, ..)
   */
  private async handleRouterCommand(command: string, args: string[]): Promise<void> {
    switch (command) {
      case 'cd':
        await handleCc(args, this.context, this.configPath);
        break;
      case '..':
        handleUp(this.context);
        break;
      case 'ls':
        await handleLs(args, this.context, this.configPath, (tokens) => this.executeCommand(tokens));
        break;
      case 'show':
        await handleShow(args, this.context, this.configPath, (tokens) => this.executeCommand(tokens));
        break;
    }
  }

  /**
   * Handle built-in shell commands
   */
  private async handleBuiltin(command: string, args: string[]): Promise<void> {
    switch (command) {
      case 'exit':
      case 'quit':
        this.running = false;
        this.rl?.close();
        break;

      case 'help':
        this.showHelp(args[0]);
        break;

      case 'clear':
        console.clear();
        break;

      case 'pwd':
        handlePwd(this.context, this.configPath, args);
        break;

      case 'reset':
        this.resetContext();
        break;

      default:
        printError(`Unknown builtin: ${command}`);
    }
  }

  /**
   * Show help
   */
  private showHelp(topic?: string): void {
    // Handle -a / --all for detailed help
    if (topic === '-a' || topic === '--all') {
      this.showDetailedHelp();
      return;
    }

    // Handle blocked commands
    if (topic && BLOCKED_IN_SHELL.includes(topic)) {
      printError(`'${topic}' is not available in shell mode (stdin conflict)`);
      printInfo('Exit shell first, then run: pfscan ' + topic);
      return;
    }

    if (topic) {
      printInfo(`Help for "${topic}" - run "pfscan ${topic} --help" for details`);
      return;
    }

    console.log(`
proofscan shell - context-aware interactive exploration

Navigation & Inspection:
  cd <target>       Change context (/, .., -, <connector>, <session>, @last, @ref:name)
  ls                List items at current level
  pwd               Show current path
  show [target]     Show resource details

References & Tool Calls:
  ref <action>      Manage references (add, ls, rm)
  send <tool>       Call MCP tool interactively
  inscribe @...     Inscribe RPC to blockchain

Pipes & Filters:
  ls | where <expr> Filter rows (e.g., rpc.method == "tools/call")
  ls | grep <expr>  Alias for where

Session Control:
  reset             Clear all context
  help [-a]         Show help (-a for details)
  clear             Clear screen
  exit              Exit shell

CLI Commands (also available here):
  view, tree, scan, summary, rpc, analyze, tool
  config, connectors, secrets, catalog, archive, doctor
  popl, runners, status, sessions

Type 'help -a' for detailed command reference.
`);
  }

  /**
   * Show detailed help (help -a)
   */
  private showDetailedHelp(): void {
    console.log(`
proofscan shell - detailed command reference

Navigation:
  cd <target>             Change context
    cd /                  Go to root (clear context)
    cd <connector>        Enter connector context
    cd <session>          Enter session (in connector context)
    cd <conn>/<sess>      Enter session directly
    cd @last              Jump to latest session/RPC
    cd @ref:<name>        Jump to saved reference
    cd ..                 Go up one level
    cd -                  Go to previous location
  ls [-l] [--json]        List items at current level
  pwd [--json]            Show current path (--json for RefStruct)

Resource Details:
  show [target] [--json]  Show resource details (request/response data)
  show @rpc:abc           Show specific RPC details
  show @ref:<name>        Show referenced resource details

References:
  ref @this               Resolve current context to RefStruct
  ref @last               Resolve latest session/RPC
  ref @rpc:abc            Resolve specific RPC
  ref add <name> @...     Save a reference
  ref ls                  List saved references
  ref rm <name>           Remove a reference

Interactive Tool Calls:
  tool ls                 List tools on current connector
  tool show <name>        Show tool details
  send <tool-name>        Call a tool with interactive argument input
  send @last              Replay last RPC call
  send @ref:<name>        Replay from saved reference

Inscribe:
  inscribe @rpc:<id>      Inscribe RPC to blockchain
  inscribe @last          Inscribe latest RPC
  show @... --json | inscribe   Inscribe via pipe

Pipes & Filters (Filter DSL v0.1):
  ls | where <expr>       Filter rows by expression
  ls | grep <expr>        Alias for where

  Fields:
    rpc.method            RPC method name (e.g., "tools/call")
    rpc.status            Status: ok, err, pending
    rpc.latency           Response latency in ms
    tools.name            Tool name for tools/call (e.g., "read_file")
    session.id            Session ID

  Operators:
    ==, !=                Equality (case-insensitive for status)
    ~=                    Substring match
    >, <                  Numeric comparison

  Examples:
    ls | where rpc.method == "tools/call"
    ls | where rpc.status != ok
    ls | where rpc.latency > 1000
    ls | where tools.name ~= "read"

Session Control:
  reset                   Clear all context
  help [topic]            Show help
  clear                   Clear screen
  exit, quit              Exit shell

CLI Commands (passthrough to pfscan):
  view (v)          View recent events timeline (use -f for follow mode)
  tree (t)          Show connector/session/RPC structure
  scan (s)          Run a new scan
  summary           Show session summary and capabilities
  rpc               View RPC call details (ls, show)
  analyze           Analyze tool usage across sessions
  tool              MCP tool operations (ls, show, call)
  config (c)        Configuration management
  connectors        Manage MCP server connectors
  secrets           Secret management
  catalog (cat)     Search and inspect MCP servers from registry
  archive (a)       Data retention and cleanup
  doctor            Diagnose and fix database issues
  popl              Public Observable Proof Ledger
  runners           Manage package runners (npx, uvx)
  status (st)       Show database and system status
  sessions          Manage scan sessions

Tips:
  - @ is the dereference operator (e.g., @this, @last, @ref:<name>)
  - show = resource details (data), ref = address resolution (RefStruct)
  - Press TAB for auto-completion
  - Pipes: pwd --json | ref add myname, ls | where rpc.status != ok
`);
  }

  /**
   * Show current context
   */
  private showContext(): void {
    console.log();
    console.log('Current context:');
    console.log(`  Connector: ${this.context.connector || '(not set)'}`);
    console.log(`  Session:   ${this.context.session ? shortenSessionId(this.context.session) : '(not set)'}`);
    console.log();
  }

  /**
   * Reset context
   */
  private resetContext(): void {
    this.context.connector = undefined;
    this.context.session = undefined;
    clearCurrentSession();
    printSuccess('Context cleared');
  }

  /**
   * Parse a pipe command - delegates to exported function for testability
   */
  private parsePipe(line: string): { left: string; right: string } | null {
    return parsePipeCommand(line);
  }

  /**
   * Extract command name and raw args from pipe right side
   * Uses raw string to preserve quoted values
   */
  private extractCommand(input: string): { cmd: string; rest: string } {
    const trimmed = input.trim();
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
      return { cmd: trimmed, rest: '' };
    }
    return {
      cmd: trimmed.slice(0, spaceIdx),
      rest: trimmed.slice(spaceIdx + 1), // Keep rest as raw string
    };
  }

  /**
   * Handle piped commands
   * Supports:
   *   pwd --json | ref add <name>
   *   show @rpc:<id> --json | inscribe
   *   ls | where <filter-expr>
   *   ls | grep <filter-expr>
   */
  private async handlePipe(leftCmd: string, rightCmd: string): Promise<void> {
    const leftTokens = leftCmd.split(/\s+/).filter(t => t !== '');

    if (leftTokens.length === 0 || !rightCmd.trim()) {
      printError('Invalid pipe syntax');
      return;
    }

    // Extract command name from right side (preserving raw args for where/grep)
    const { cmd: rightCommand, rest: rawArgs } = this.extractCommand(rightCmd);

    // Handle: ls | where <filter-expr> or ls | grep <filter-expr>
    if (rightCommand === 'where' || rightCommand === 'grep') {
      await this.handlePipeToWhere(leftCmd, rawArgs);
      return;
    }

    // Parse right side for other commands
    const rightTokens = rightCmd.split(/\s+/).filter(t => t !== '');

    // Handle: show --json | inscribe
    if (rightCommand === 'inscribe') {
      await this.handlePipeToInscribe(leftTokens, rightTokens);
      return;
    }

    // Handle: pwd --json | ref add <name>
    if (rightCommand === 'ref' && rightTokens[1] === 'add') {
      await this.handlePipeToRefAdd(leftTokens, rightTokens);
      return;
    }

    printError('Unsupported pipe command');
    printInfo('Supported pipes:');
    printInfo('  pwd --json | ref add <name>');
    printInfo('  show @rpc:<id> --json | inscribe');
    printInfo('  ls | where <filter-expr>');
    printInfo('  ls | grep <filter-expr>');
  }

  /**
   * Handle: ls | where <filter-expr> or ls | grep <filter-expr>
   */
  private async handlePipeToWhere(leftCmd: string, expr: string): Promise<void> {
    const leftTokens = leftCmd.trim().split(/\s+/);

    // Currently only ls is supported as input
    if (leftTokens[0] !== 'ls') {
      printError('where/grep currently only supports "ls" as input');
      printInfo('Example: ls | where rpc.method == "tools/call"');
      return;
    }

    // Get ls rows
    const { getLsRows } = await import('./router-commands.js');
    const input = getLsRows(this.context, this.configPath);

    // Connector level is not supported
    if (input.kind === 'rows' && input.rowType === 'connector') {
      printError('where/grep is not supported for connectors');
      printInfo('Navigate to a connector first: cd <connector-id>');
      return;
    }

    // Apply where filter
    const { applyWhere } = await import('./where-command.js');
    const result = applyWhere(input, expr);

    if (!result.ok) {
      printError(`Filter error: ${result.error}`);
      if (result.position !== undefined) {
        printError(`  at position ${result.position + 1}`);
      }
      return;
    }

    // Render output
    this.renderPipelineOutput(result.result);
    printInfo(`rows: ${result.stats.matched} / ${result.stats.total}`);
  }

  /**
   * Render pipeline output (rows or text)
   */
  private renderPipelineOutput(output: import('./pipeline-types.js').PipelineValue): void {
    if (output.kind === 'text') {
      console.log(output.text);
      return;
    }

    if (output.rows.length === 0) {
      printInfo('No matching results');
      return;
    }

    const isTTY = process.stdout.isTTY;

    if (output.rowType === 'rpc') {
      this.renderRpcTable(output.rows as import('./pipeline-types.js').RpcRow[], isTTY);
    } else if (output.rowType === 'session') {
      this.renderSessionTable(output.rows as import('./pipeline-types.js').SessionRow[], isTTY);
    }
  }

  /**
   * Render RPC rows as table
   */
  private renderRpcTable(rows: import('./pipeline-types.js').RpcRow[], isTTY: boolean): void {
    const dimText = (text: string) => isTTY ? `\x1b[2m${text}\x1b[0m` : text;
    const statusColor = (status: string) => {
      if (!isTTY) return status;
      switch (status) {
        case 'OK': return '\x1b[32mOK\x1b[0m';
        case 'ERR': return '\x1b[31mERR\x1b[0m';
        default: return '\x1b[33mpending\x1b[0m';
      }
    };

    console.log();
    console.log(
      dimText('#'.padEnd(4)) + '  ' +
      dimText('Method'.padEnd(20)) + '  ' +
      dimText('Status'.padEnd(isTTY ? 16 : 8)) + '  ' +
      dimText('Latency')
    );
    console.log(dimText('-'.repeat(55)));

    rows.forEach((row, idx) => {
      const num = String(idx + 1).padEnd(4);
      const method = row.method.slice(0, 20).padEnd(20);
      const status = statusColor(row.status).padEnd(isTTY ? 16 : 8);
      const latency = row.latency_ms !== null ? `${row.latency_ms}ms` : '-';

      console.log(`${num}  ${method}  ${status}  ${latency}`);
    });
    console.log();
  }

  /**
   * Render Session rows as table
   */
  private renderSessionTable(rows: import('./pipeline-types.js').SessionRow[], isTTY: boolean): void {
    const dimText = (text: string) => isTTY ? `\x1b[2m${text}\x1b[0m` : text;

    console.log();
    console.log(
      dimText('Session'.padEnd(10)) + '  ' +
      dimText('RPCs'.padEnd(6)) + '  ' +
      dimText('Events'.padEnd(8)) + '  ' +
      dimText('Started')
    );
    console.log(dimText('-'.repeat(45)));

    rows.forEach((row) => {
      const sessionShort = shortenSessionId(row.session_id);
      const rpcs = String(row.rpc_count).padEnd(6);
      const events = String(row.event_count).padEnd(8);
      const started = row.started_at ? row.started_at.slice(0, 19).replace('T', ' ') : '-';

      console.log(`${sessionShort}  ${rpcs}  ${events}  ${started}`);
    });
    console.log();
  }

  /**
   * Handle: show --json | inscribe
   */
  private async handlePipeToInscribe(leftTokens: string[], rightTokens: string[]): Promise<void> {
    const leftCommand = leftTokens[0];

    // Validate left side is show --json
    if (leftCommand !== 'show' || !leftTokens.includes('--json')) {
      printError('Pipe to inscribe requires: show <@ref> --json');
      printInfo('Example: show @rpc:1 --json | inscribe');
      return;
    }

    // Get target reference from show command
    const target = leftTokens.find(t => t.startsWith('@'));
    if (!target) {
      printError('show command requires a reference target');
      printInfo('Example: show @rpc:1 --json | inscribe');
      return;
    }

    // Get RPC detail JSON by calling show internally
    const { getRpcDetailJson } = await import('./router-commands.js');
    const { ConfigManager } = await import('../config/index.js');

    const manager = new ConfigManager(this.configPath);
    const jsonOutput = await getRpcDetailJson(target, this.context, manager.getConfigDir());

    if (!jsonOutput) {
      printError('Failed to get RPC detail for inscribe');
      return;
    }

    // Call inscribe with JSON as stdin data
    const inscribeArgs = rightTokens.slice(1); // args after 'inscribe'
    await handleInscribe(inscribeArgs, this.context, this.configPath, jsonOutput);
  }

  /**
   * Handle: pwd --json | ref add <name>
   * Also supports: popl @... --json | ref add <name>
   */
  private async handlePipeToRefAdd(leftTokens: string[], rightTokens: string[]): Promise<void> {
    const leftCommand = leftTokens[0];
    const hasJson = leftTokens.includes('--json');

    // Support both pwd --json and popl @... --json
    if (leftCommand === 'popl' && hasJson) {
      await this.handlePoplPipeToRefAdd(leftTokens, rightTokens);
      return;
    }

    if (leftCommand !== 'pwd' || !hasJson) {
      printError('Pipe source must be: pwd --json or popl @... --json');
      printInfo('Examples:');
      printInfo('  pwd --json | ref add myref');
      printInfo('  popl @this --json | ref add myentry');
      return;
    }

    // Get pwd --json output
    const { createRefFromContext, refToJson } = await import('./ref-resolver.js');
    const { detectProto, detectConnectorProto, getContextLevel } = await import('./router-commands.js');
    const { EventLineStore } = await import('../eventline/store.js');
    const { ConfigManager } = await import('../config/index.js');

    const manager = new ConfigManager(this.configPath);
    const store = new EventLineStore(manager.getConfigDir());
    const level = getContextLevel(this.context);

    // Update proto for accurate output
    if (level === 'session' && this.context.session) {
      this.context.proto = detectProto(store, this.context.session);
    } else if (level === 'connector' && this.context.connector) {
      this.context.proto = detectConnectorProto(store, this.context.connector);
    }

    const ref = createRefFromContext(this.context);
    const jsonOutput = refToJson(ref);

    // Now call ref add with the JSON as stdin data
    const refArgs = rightTokens.slice(1); // ['add', '<name>']
    await handleRef(refArgs, this.context, this.configPath, jsonOutput);
  }

  /**
   * Handle: popl @... --json | ref add <name>
   */
  private async handlePoplPipeToRefAdd(leftTokens: string[], rightTokens: string[]): Promise<void> {
    // Execute popl command to get JSON output
    // Left tokens: ['popl', '@this', '--json'] or ['popl', '@last', '--json']
    const poplArgs = leftTokens.slice(1).filter(t => t !== '--json'); // Remove 'popl' and '--json'

    // Capture popl output by calling handlePopl with JSON flag
    const { getPoplJsonOutput } = await import('./popl-commands.js');

    const jsonOutput = await getPoplJsonOutput(poplArgs, this.context, this.configPath);

    if (!jsonOutput) {
      printError('Failed to get POPL JSON output');
      return;
    }

    // Now call ref add with the JSON as stdin data
    const refArgs = rightTokens.slice(1); // ['add', '<name>']
    await handleRef(refArgs, this.context, this.configPath, jsonOutput);
  }

  /**
   * Execute a pfscan command
   */
  private async executeCommand(tokens: string[]): Promise<void> {
    // Apply context to command arguments
    const { args: cmdArgs, warnings } = applyContext(tokens, this.context);
    const command = tokens[0];

    // Block commands that have their own readline (stdin conflict)
    if (BLOCKED_IN_SHELL.includes(command)) {
      printError(`'${command}' is not available in shell mode (stdin conflict)`);
      printInfo('Exit shell first, then run: pfscan ' + command);
      return;
    }

    // Block subcommands that use hidden input (stdin conflict)
    const subcommand = tokens.length > 1 ? tokens[1] : '';
    const fullCommand = `${command} ${subcommand}`;
    if (BLOCKED_SUBCOMMANDS_IN_SHELL.includes(fullCommand)) {
      printError(`'${fullCommand}' is not available in shell mode (requires hidden input)`);
      // Provide copy-paste ready command with default output file for export
      if (fullCommand === 'secrets export' || fullCommand === 'secret export') {
        printInfo('Exit shell first, then run:');
        printInfo('  pfscan secrets export -o proofscan-secrets.export.json');
      } else {
        printInfo('Exit shell first, then run: pfscan ' + tokens.join(' '));
      }
      return;
    }

    // Show context-aware warnings
    warnings.forEach(w => printInfo(w));

    // Validate all arguments for safety (defense-in-depth with shell: false)
    const invalidArgs = cmdArgs.filter(arg => !isValidArg(arg));
    if (invalidArgs.length > 0) {
      printError(`Invalid characters in arguments: ${invalidArgs.join(', ')}`);
      printInfo('Arguments cannot contain shell metacharacters: & | ; ` $');
      return;
    }

    // Spawn pfscan process
    // Windows requires shell: true for .cmd wrapper scripts (npm global installs)
    // Security is ensured by isValidArg() validation above which blocks dangerous characters
    const isWindows = process.platform === 'win32';
    return new Promise((resolve) => {
      const proc = spawn('pfscan', cmdArgs, {
        stdio: 'inherit',
        shell: isWindows,
      });

      proc.on('error', (err) => {
        printError(`Failed to run command: ${err.message}`);
        resolve();
      });

      proc.on('close', (code) => {
        // Invalidate cache after data-modifying commands
        const dataModifyingCommands = [
          'scan', 's',           // Creates new sessions/events
          'archive', 'a',        // Removes old data
          'connectors', 'connector', // Adds/removes connectors
          'config', 'c',         // Config changes may affect connectors
        ];
        if (dataModifyingCommands.includes(command)) {
          this.invalidateCache();
        }
        if (code !== 0 && code !== null) {
          printError(`Command exited with code ${code}`);
        }
        resolve();
      });
    });
  }
}
