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
  handleA2ASend,
  handleHistory,
} from './router-commands.js';
import { generatePrompt, printSuccess, printError, printInfo, shortenSessionId } from './prompt.js';
import { loadHistory, saveHistory, addToHistory } from './history.js';
import { createCompleter, type DynamicDataProvider } from './completer.js';
import { selectConnector, selectSession, canInteract } from './selector.js';
import { EventLineStore } from '../eventline/store.js';
import { TargetsStore } from '../db/targets-store.js';
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
import type { PipelineValue, RpcRow, SessionRow, A2AMessageRow } from './pipeline-types.js';
import { parseFindArgs, executeFind } from './find-command.js';
import { ConfigureMode, processConfigureCommand, createConfigureCompleter, type ConfigureDataProvider } from './configure/index.js';

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
  private configureMode: ConfigureMode | null = null;

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
   * Get all connector IDs (MCP connectors with sessions + A2A agents)
   * Note: This is synchronous for readline completer compatibility.
   * Agent IDs are loaded asynchronously and cached.
   */
  private getAllConnectorIds(configDir: string): string[] {
    const now = Date.now();
    if (this.connectorsCache && this.connectorsCache.expiry > now) {
      return this.connectorsCache.data;
    }
    try {
      const store = new EventLineStore(configDir);
      const sessionIds = store.getConnectors().map(c => c.id);

      // Also include A2A agents from TargetsStore (loaded synchronously via static import)
      let agentIds: string[] = [];
      try {
        const ts = new TargetsStore(configDir);
        agentIds = ts.list({ type: 'agent' }).map((a: { id: string }) => a.id);
      } catch { /* ignore if TargetsStore unavailable */ }

      // Merge and deduplicate
      const ids = [...new Set([...sessionIds, ...agentIds])];
      this.connectorsCache = { data: ids, expiry: now + CACHE_TTL_MS };
      return ids;
    } catch {
      return [];
    }
  }

  /**
   * Get data provider for configure mode completions
   */
  private getConfigureDataProvider(): ConfigureDataProvider {
    const manager = new ConfigManager(this.configPath);
    const configDir = manager.getConfigDir();

    return {
      getConnectorIds: () => this.getAllConnectorIds(configDir),
    };
  }

  /**
   * Get data provider for completions with caching
   */
  private getDataProvider(): DynamicDataProvider {
    const manager = new ConfigManager(this.configPath);
    const configDir = manager.getConfigDir();

    return {
      getConnectorIds: () => this.getAllConnectorIds(configDir),
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
   * Create a dynamic completer that delegates based on current mode
   */
  private createDynamicCompleter(): (line: string, callback: (err: Error | null, result: [string[], string]) => void) => void {
    const shellDataProvider = this.getDataProvider();
    const shellCompleter = createCompleter(this.context, shellDataProvider);
    const configureDataProvider = this.getConfigureDataProvider();

    return (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
      if (this.configureMode?.isActive()) {
        const configureCompleter = createConfigureCompleter(this.configureMode, configureDataProvider);
        const [completions, prefix] = configureCompleter(line);
        callback(null, [completions, prefix]);
      } else {
        const [completions, prefix] = shellCompleter(line);
        callback(null, [completions, prefix]);
      }
    };
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    // Load history
    this.history = loadHistory();

    // Create dynamic completer that switches based on mode
    const dynamicCompleter = this.createDynamicCompleter();

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: generatePrompt(this.context),
      completer: dynamicCompleter,
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
        this.rl!.setPrompt(this.getCurrentPrompt());
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
    // Check if in configure mode
    if (this.configureMode?.isActive()) {
      await this.processConfigureLine(line);
      return;
    }

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

    // Handle history command (A2A session message history)
    if (command === 'history') {
      await handleHistory(args, this.context, this.configPath);
      return;
    }

    // Handle send command (A2A or MCP tool)
    if (command === 'send') {
      // Check if current target is an A2A agent
      let isA2A = false;
      if (this.context.connector) {
        try {
          const configDir = this.configPath.replace(/\/[^/]+$/, '');
          const { TargetsStore } = await import('../db/targets-store.js');
          const ts = new TargetsStore(configDir);
          isA2A = ts.list({ type: 'agent' }).some(a => a.id === this.context.connector);
        } catch { /* ignore */ }
      }

      if (isA2A) {
        await handleA2ASend(args, this.context, this.configPath);
      } else {
        if (!this.rl) {
          printError('Shell not initialized');
          return;
        }
        await handleSend(args, this.context, this.configPath, this.rl);
      }
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

    // Handle configure terminal command (with aliases: conf, config)
    if (command === 'configure' || command === 'conf' || command === 'config') {
      await this.handleConfigure(args);
      return;
    }

    // Handle proxy command (shell-native for reload/stop)
    if (command === 'proxy') {
      await this.handleProxy(args);
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
      case 'find':
        await this.handleFind(args);
        break;
      case 'history':
        await handleHistory(args, this.context, this.configPath);
        break;
    }
  }

  /**
   * Handle find command - cross-session search
   */
  private async handleFind(args: string[]): Promise<void> {
    const parseResult = parseFindArgs(args);

    if (!parseResult.ok) {
      // Help text is not an error
      if ('help' in parseResult && parseResult.help) {
        console.log(parseResult.error);
      } else {
        printError(parseResult.error);
      }
      return;
    }

    const result = executeFind(this.context, this.configPath, parseResult.options);

    if (!result.ok) {
      printError(result.error);
      return;
    }

    // Render output (reuse pipeline output renderer)
    this.renderPipelineOutput(result.result);
    printInfo(`rows: ${result.stats.count} (across ${result.stats.sessions} sessions)`);
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
  find <kind>       Cross-session search (session|rpc|event)

References & Tool Calls:
  ref <action>      Manage references (add, ls, rm)
  send <tool>       Call MCP tool interactively
  inscribe @...     Inscribe RPC to blockchain

Pipes & Filters:
  ls | where <expr> Filter rows (e.g., rpc.method == "tools/call")
  ls | grep <expr>  Alias for where (not regex)
  ls | less         Page through results (j/k scroll, q quit)
  find rpc | more   Simple page-by-page view

Session Control:
  reset             Clear all context
  help [-a]         Show help (-a for details)
  clear             Clear screen
  exit              Exit shell

A2A Session Commands:
  history           Show message history (A2A sessions only)
    history -n 20   Show last 20 messages
    history --role user  Show only user messages
    history --search <query>  Search messages

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

Cross-Session Search:
  find <kind> [options]   Search across sessions without cd
    Kinds: session, rpc, event
    Options:
      --limit N           Max rows to return (default: 200)
      --sessions N        Max sessions to search (default: 50)
      --errors-only       Only return error RPCs
    Scope:
      /                   Search all connectors
      /<connector>:       Search that connector
      /<conn>/<sess>:     Search that session only
    Examples:
      find rpc                      All RPCs across sessions
      find rpc --errors-only        Errors only
      find rpc | where tools.name ~= "read"   Chain with filter
      find session --limit 10       Latest sessions

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
  ls | grep <expr>        Alias for where (not regex)

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

Pager (less/more):
  ls | less               Interactive pager (j/k scroll, q quit)
  find rpc | less         Page through cross-session results
  ls | more               Simple page-by-page view (Enter/q)

  less keys:
    j/k, ↑/↓              Scroll one line
    space, b              Page down/up
    g, G                  First/last line
    q, Ctrl+C             Quit

Session Control:
  reset                   Clear all context
  help [topic]            Show help
  clear                   Clear screen
  exit, quit              Exit shell

A2A Session Commands (history):
  history                 Show A2A message history
    history -n <count>    Show last N messages (default: 100)
    history --role user   Show only user messages
    history --role assistant  Show only assistant messages
    history --search <query>  Search messages by text

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
   * Check if an expression is a simple text (not a filter expression)
   * Returns true if expression does not contain filter operators with proper context.
   * Uses regex to avoid false positives like "<script>" or "a!=b" in text.
   */
  private isSimpleTextSearch(expr: string): boolean {
    const trimmed = expr.trim();
    // Pattern matches operators surrounded by whitespace or at string boundaries
    // This prevents false positives like "<script>" or "5==5" in search text
    const operatorPattern = /(?:^|\s)(==|!=|~=|>=?|<=?)(?:\s|$)/;
    return !operatorPattern.test(trimmed);
  }

  /**
   * Convert simple text search to appropriate filter expression based on row type
   */
  private textToFilterExpr(text: string, rowType: string): string {
    const trimmed = text.trim();
    // Escape backslashes first, then quotes (order matters!)
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    switch (rowType) {
      case 'a2a-message':
        return `message.content ~= "${escaped}"`;
      case 'rpc':
        // For now, search in method name (could be expanded later)
        return `rpc.method ~= "${escaped}"`;
      case 'session':
        return `session.id ~= "${escaped}"`;
      default:
        // Default to searching in common text fields
        return `message.content ~= "${escaped}"`;
    }
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

    // Handle: ls | grep <text> (text search with auto-conversion)
    if (rightCommand === 'grep') {
      await this.handlePipeToGrep(leftCmd, rawArgs);
      return;
    }

    // Handle: ls | where <filter-expr>
    if (rightCommand === 'where') {
      await this.handlePipeToWhere(leftCmd, rawArgs);
      return;
    }

    // Handle: ls | less or find rpc | more
    if (rightCommand === 'less' || rightCommand === 'more') {
      await this.handlePipeToPager(leftCmd, rightCommand as 'less' | 'more');
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
    printInfo('  ls | grep <text>');
    printInfo('  find rpc | where <filter-expr>');
    printInfo('  ls | less');
    printInfo('  find rpc | more');
  }

  /**
   * Handle: ls | where <filter-expr> or ls | grep <filter-expr>
   * Also supports: find <kind> | where <filter-expr>
   */
  private async handlePipeToWhere(leftCmd: string, expr: string): Promise<void> {
    const leftTokens = leftCmd.trim().split(/\s+/);
    const leftCommand = leftTokens[0];

    // Get pipeline input based on left command
    let input: PipelineValue;
    let statsLabel: string;

    if (leftCommand === 'ls') {
      // Get ls rows
      const { getLsRows } = await import('./router-commands.js');
      input = getLsRows(this.context, this.configPath);

      // Connector level is not supported for ls
      if (input.kind === 'rows' && input.rowType === 'connector') {
        printError('where/grep is not supported for connectors');
        printInfo('Navigate to a connector first: cd <connector-id>');
        return;
      }
      statsLabel = 'rows';
    } else if (leftCommand === 'find') {
      // Parse find args
      const findArgs = leftTokens.slice(1);
      const parseResult = parseFindArgs(findArgs);

      if (!parseResult.ok) {
        printError(parseResult.error);
        return;
      }

      const findResult = executeFind(this.context, this.configPath, parseResult.options);

      if (!findResult.ok) {
        printError(findResult.error);
        return;
      }

      input = findResult.result;
      statsLabel = `rows (across ${findResult.stats.sessions} sessions)`;
    } else if (leftCommand === 'history') {
      // Get history rows
      const { getHistoryRows } = await import('./router-commands.js');
      input = getHistoryRows(this.context, this.configPath);
      statsLabel = 'messages';
    } else {
      printError('where/grep only supports "ls", "find", or "history" as input');
      printInfo('Examples:');
      printInfo('  ls | where rpc.method == "tools/call"');
      printInfo('  find rpc | where tools.name ~= "read"');
      printInfo('  history | where role == "user"');
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
    printInfo(`${statsLabel}: ${result.stats.matched} / ${result.stats.total}`);
  }

  /**
   * Handle: ls | grep <text> or history | grep <text>
   * Auto-converts simple text to appropriate filter expression based on row type
   */
  private async handlePipeToGrep(leftCmd: string, expr: string): Promise<void> {
    const leftTokens = leftCmd.trim().split(/\s+/);
    const leftCommand = leftTokens[0];

    // Get pipeline input based on left command
    let input: PipelineValue;
    let statsLabel: string;

    if (leftCommand === 'ls') {
      // Get ls rows
      const { getLsRows } = await import('./router-commands.js');
      input = getLsRows(this.context, this.configPath);

      // Connector level is not supported for ls
      if (input.kind === 'rows' && input.rowType === 'connector') {
        printError('grep is not supported for connectors');
        printInfo('Navigate to a connector first: cd <connector-id>');
        return;
      }
      statsLabel = 'rows';
    } else if (leftCommand === 'find') {
      // Parse find args
      const findArgs = leftTokens.slice(1);
      const parseResult = parseFindArgs(findArgs);

      if (!parseResult.ok) {
        printError(parseResult.error);
        return;
      }

      const findResult = executeFind(this.context, this.configPath, parseResult.options);

      if (!findResult.ok) {
        printError(findResult.error);
        return;
      }

      input = findResult.result;
      statsLabel = `rows (across ${findResult.stats.sessions} sessions)`;
    } else if (leftCommand === 'history') {
      // Get history rows
      const { getHistoryRows } = await import('./router-commands.js');
      input = getHistoryRows(this.context, this.configPath);
      statsLabel = 'messages';
    } else {
      printError('grep only supports "ls", "find", or "history" as input');
      printInfo('Examples:');
      printInfo('  ls | grep "tools/call"');
      printInfo('  find rpc | grep "read"');
      printInfo('  history | grep "d20"');
      return;
    }

    // Convert simple text to filter expression if needed
    let filterExpr = expr;
    if (this.isSimpleTextSearch(expr)) {
      if (input.kind === 'rows') {
        filterExpr = this.textToFilterExpr(expr, input.rowType);
      }
    }

    // Apply where filter
    const { applyWhere } = await import('./where-command.js');
    const result = applyWhere(input, filterExpr);

    if (!result.ok) {
      printError(`Filter error: ${result.error}`);
      if (result.position !== undefined) {
        printError(`  at position ${result.position + 1}`);
      }
      return;
    }

    // Render output
    this.renderPipelineOutput(result.result);
    printInfo(`${statsLabel}: ${result.stats.matched} / ${result.stats.total}`);
  }

  /**
   * Handle: ls | less or find rpc | more
   */
  private async handlePipeToPager(leftCmd: string, pagerCmd: 'less' | 'more'): Promise<void> {
    const leftTokens = leftCmd.trim().split(/\s+/);
    const leftCommand = leftTokens[0];

    // Get pipeline input based on left command
    let input: PipelineValue;

    if (leftCommand === 'ls') {
      const { getLsRows } = await import('./router-commands.js');
      input = getLsRows(this.context, this.configPath);
    } else if (leftCommand === 'find') {
      const findArgs = leftTokens.slice(1);
      const parseResult = parseFindArgs(findArgs);

      if (!parseResult.ok) {
        // Help text is not an error
        if ('help' in parseResult && parseResult.help) {
          console.log(parseResult.error);
        } else {
          printError(parseResult.error);
        }
        return;
      }

      const findResult = executeFind(this.context, this.configPath, parseResult.options);

      if (!findResult.ok) {
        printError(findResult.error);
        return;
      }

      input = findResult.result;
    } else if (leftCommand === 'history') {
      const { getHistoryRows } = await import('./router-commands.js');
      input = getHistoryRows(this.context, this.configPath);
    } else {
      printError(`${pagerCmd} only supports "ls", "find", or "history" as input`);
      printInfo('Examples:');
      printInfo('  ls | less');
      printInfo('  find rpc | less');
      printInfo('  history | less');
      return;
    }

    // Text input is an error
    if (input.kind === 'text') {
      printError(`${pagerCmd} expects structured rows; got text`);
      return;
    }

    // Empty rows - print message and return without pager
    if (input.rows.length === 0) {
      printInfo('No results');
      return;
    }

    // Pause readline instead of closing it to avoid listener conflicts
    // This prevents the race condition between old and new readline listeners
    if (this.rl) {
      this.rl.pause();
    }

    // Run pager
    const { LessPager, MorePager } = await import('./pager/index.js');
    const pager = pagerCmd === 'less' ? new LessPager() : new MorePager();
    await pager.run(input);

    // Resume readline after pager completes
    if (this.rl) {
      this.rl.resume();
      this.rl.prompt();
    }
  }

  /**
   * Reset readline interface (recreate after pager or other stdin-consuming operations)
   */
  private resetReadline(): void {
    // Close existing readline interface to prevent duplicate input
    if (this.rl) {
      // Remove close listener to prevent "Goodbye!" message when closing for reset
      this.rl.removeAllListeners('close');
      this.rl.removeAllListeners();
      this.rl.close();
    }

    // Ensure stdin is in correct state before creating new readline
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }
    // Ensure stdin is not in raw mode
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors if already not in raw mode
      }
    }

    // Choose completer based on mode
    const completer = this.configureMode?.isActive()
      ? createConfigureCompleter(this.configureMode, this.getConfigureDataProvider())
      : createCompleter(this.context, this.getDataProvider());

    // Create new readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      history: this.history,
      historySize: 1000,
    });

    // Set prompt
    this.rl.setPrompt(this.getCurrentPrompt());

    // Re-attach line handler (same logic as start())
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();

      if (trimmed) {
        const tokens = trimmed.split(/\s+/).filter(t => t !== '');
        const resolution = resolveCommand(tokens, this.context);

        if (!resolution.success) {
          printError(resolution.error!);
          if (resolution.candidates) {
            printInfo(`Did you mean: ${resolution.candidates.join(', ')}?`);
          }
        } else {
          const normalizedLine = resolution.resolved.join(' ') || trimmed;
          this.history = addToHistory(this.history, normalizedLine);
          await this.processLine(normalizedLine);
        }
      }

      if (this.running && this.rl) {
        this.rl.setPrompt(this.getCurrentPrompt());
        this.rl.prompt();
      }
    });

    // Re-attach close handler
    this.rl.on('close', () => {
      if (this.running) {
        // Unexpected close while running - this shouldn't happen after pager
        // Don't auto-recreate to avoid infinite loops
        this.running = false;
        saveHistory(this.history);
        console.log();
        printInfo('Goodbye!');
      }
    });

    // Re-attach SIGINT handler
    this.rl.on('SIGINT', () => {
      console.log();
      this.rl!.prompt();
    });

    // Show prompt
    this.rl.prompt();
  }

  /**
   * Render pipeline output (rows or text)
   */
  private renderPipelineOutput(output: PipelineValue): void {
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
      this.renderRpcTable(output.rows as RpcRow[], isTTY);
    } else if (output.rowType === 'session') {
      this.renderSessionTable(output.rows as SessionRow[], isTTY);
    } else if (output.rowType === 'a2a-message') {
      this.renderA2AMessageTable(output.rows as A2AMessageRow[], isTTY);
    }
  }

  /**
   * Render A2A message rows as table
   */
  private renderA2AMessageTable(rows: A2AMessageRow[], isTTY: boolean): void {
    const dimText = (text: string) => isTTY ? `\x1b[2m${text}\x1b[0m` : text;
    const roleColor = (role: string) => {
      if (!isTTY) return role;
      return role === 'assistant' ? `\x1b[36m${role}\x1b[0m` : role;
    };

    // Check if rows have session_id (connector level)
    const hasSession = rows.some(r => r.session_id);

    console.log();
    if (hasSession) {
      console.log(
        dimText('#'.padEnd(4)) + '  ' +
        dimText('Session'.padEnd(10)) + '  ' +
        dimText('Time'.padEnd(10)) + '  ' +
        dimText('Role'.padEnd(12)) + '  ' +
        dimText('Content')
      );
      console.log(dimText('-'.repeat(80)));
      rows.forEach(row => {
        const sessionPrefix = row.session_id ? row.session_id.slice(0, 8) : '';
        const timeStr = row.timestamp ? row.timestamp.slice(11, 19) : '--:--:--';
        console.log(
          String(row.id).padEnd(4) + '  ' +
          sessionPrefix.padEnd(10) + '  ' +
          timeStr.padEnd(10) + '  ' +
          roleColor(row.role).padEnd(isTTY ? 21 : 12) + '  ' +
          row.content
        );
      });
    } else {
      console.log(
        dimText('#'.padEnd(4)) + '  ' +
        dimText('Time'.padEnd(10)) + '  ' +
        dimText('Role'.padEnd(12)) + '  ' +
        dimText('Content')
      );
      console.log(dimText('-'.repeat(70)));
      rows.forEach(row => {
        const timeStr = row.timestamp ? row.timestamp.slice(11, 19) : '--:--:--';
        console.log(
          String(row.id).padEnd(4) + '  ' +
          timeStr.padEnd(10) + '  ' +
          roleColor(row.role).padEnd(isTTY ? 21 : 12) + '  ' +
          row.content
        );
      });
    }
    console.log();
  }

  /**
   * Render RPC rows as table
   */
  private renderRpcTable(rows: RpcRow[], isTTY: boolean): void {
    const dimText = (text: string) => isTTY ? `\x1b[2m${text}\x1b[0m` : text;
    const statusColor = (status: string) => {
      if (!isTTY) return status;
      switch (status) {
        case 'OK': return '\x1b[32mOK\x1b[0m';
        case 'ERR': return '\x1b[31mERR\x1b[0m';
        default: return '\x1b[33mpending\x1b[0m';
      }
    };

    // Check if rows have connector_id (find results have it, ls does not)
    const hasConnector = rows.some(r => r.target_id);

    console.log();
    if (hasConnector) {
      // Extended format for find results: Connector, Session, Method, Status, Latency, Time
      console.log(
        dimText('Connector'.padEnd(10)) + '  ' +
        dimText('Session'.padEnd(10)) + '  ' +
        dimText('Method'.padEnd(16)) + '  ' +
        dimText('Status'.padEnd(isTTY ? 16 : 8)) + '  ' +
        dimText('Latency'.padEnd(8)) + '  ' +
        dimText('Time')
      );
      console.log(dimText('-'.repeat(90)));

      rows.forEach((row) => {
        const connector = (row.target_id ?? '').slice(0, 10).padEnd(10);
        const sessionShort = shortenSessionId(row.session_id);
        const method = row.method.slice(0, 16).padEnd(16);
        const status = statusColor(row.status).padEnd(isTTY ? 16 : 8);
        const latency = (row.latency_ms !== null ? `${row.latency_ms}ms` : '-').padEnd(8);
        // MM-DD HH:MM:SS format
        const time = row.request_ts ? row.request_ts.slice(5, 19).replace('T', ' ') : '-';

        console.log(`${connector}  ${sessionShort}  ${method}  ${status}  ${latency}  ${time}`);
      });
    } else {
      // Simple format for ls results (within a session)
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
    }
    console.log();
  }

  /**
   * Render Session rows as table
   */
  private renderSessionTable(rows: SessionRow[], isTTY: boolean): void {
    const dimText = (text: string) => isTTY ? `\x1b[2m${text}\x1b[0m` : text;

    // Check if rows span multiple connectors (find at root level)
    const connectorIds = new Set(rows.map(r => r.target_id));
    const multiConnector = connectorIds.size > 1;

    console.log();
    if (multiConnector) {
      // Extended format with connector column
      console.log(
        dimText('Connector'.padEnd(12)) + '  ' +
        dimText('Session'.padEnd(10)) + '  ' +
        dimText('RPCs'.padEnd(6)) + '  ' +
        dimText('Started')
      );
      console.log(dimText('-'.repeat(55)));

      rows.forEach((row) => {
        const connector = (row.target_id ?? '').slice(0, 12).padEnd(12);
        const sessionShort = shortenSessionId(row.session_id);
        const rpcs = String(row.rpc_count).padEnd(6);
        const started = row.started_at ? row.started_at.slice(0, 19).replace('T', ' ') : '-';

        console.log(`${connector}  ${sessionShort}  ${rpcs}  ${started}`);
      });
    } else {
      // Simple format (within a connector)
      console.log(
        dimText('Session'.padEnd(10)) + '  ' +
        dimText('RPCs'.padEnd(6)) + '  ' +
        dimText('Events'.padEnd(8)) + '  ' +
        dimText('Started')
      );
      console.log(dimText('-'.repeat(50)));

      rows.forEach((row) => {
        const sessionShort = shortenSessionId(row.session_id);
        const rpcs = String(row.rpc_count).padEnd(6);
        const events = String(row.event_count).padEnd(8);
        const started = row.started_at ? row.started_at.slice(0, 19).replace('T', ' ') : '-';

        console.log(`${sessionShort}  ${rpcs}  ${events}  ${started}`);
      });
    }
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

  /**
   * Handle configure command
   */
  private async handleConfigure(args: string[]): Promise<void> {
    const subcommand = args[0]?.toLowerCase();

    // Accept 't' or 'terminal' as subcommand (IOS-style: conf t)
    if (subcommand !== 'terminal' && subcommand !== 't') {
      printError('Usage: configure terminal (or: conf t)');
      printInfo('Enter configure mode for editing connector configurations.');
      return;
    }

    // Initialize configure mode
    const manager = new ConfigManager(this.configPath);
    this.configureMode = new ConfigureMode(manager);
    this.configureMode.enter();

    printSuccess('Entered configure mode.');
    printInfo('Type "help" for available commands, "exit" to leave configure mode.');

    // Update prompt for configure mode (completer switches dynamically)
    if (this.rl) {
      this.rl.setPrompt(this.configureMode.getPrompt());
    }
  }

  /**
   * Handle proxy command (shell-native)
   */
  private async handleProxy(args: string[]): Promise<void> {
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
      console.log(`
proxy - MCP proxy server operations

Usage:
  proxy start [options]   Start MCP proxy server (use CLI: pfscan proxy start)
  proxy status            Show proxy runtime status
  proxy reload            Reload proxy configuration
  proxy stop              Stop the running proxy

Note: "proxy start" requires stdio and should be run outside the shell.
      Run: pfscan proxy start --all
`);
      return;
    }

    if (subcommand === 'start') {
      printError('proxy start cannot be run from within the shell (requires stdio).');
      printInfo('Exit shell and run: pfscan proxy start --all');
      return;
    }

    // For status, reload, stop - use IPC client
    const { IpcClient } = await import('../proxy/ipc-client.js');
    const { getSocketPath } = await import('../proxy/ipc-types.js');

    const manager = new ConfigManager(this.configPath);
    const configDir = manager.getConfigDir();
    const socketPath = getSocketPath(configDir);
    const client = new IpcClient(socketPath);

    if (subcommand === 'status') {
      const isRunning = await client.isRunning();
      if (!isRunning) {
        printInfo('Proxy is not running.');
        printInfo('Start the proxy with: pfscan proxy start --all');
        return;
      }

      const result = await client.status();
      if (!result.success) {
        printError(`Failed to get proxy status: ${result.error}`);
        return;
      }

      // Simple status display
      const state = result.data!;
      console.log();
      console.log('Proxy Status: RUNNING');
      console.log(`  Mode: ${state.proxy.mode}`);
      console.log(`  PID: ${state.proxy.pid}`);
      console.log(`  Connectors: ${state.connectors.length}`);
      for (const conn of state.connectors) {
        const status = conn.healthy ? 'healthy' : 'unhealthy';
        const tools = conn.toolCount > 0 ? `${conn.toolCount} tools` : 'pending';
        console.log(`    - ${conn.id}: ${status} (${tools})`);
      }
      console.log();
      return;
    }

    if (subcommand === 'reload') {
      const isRunning = await client.isRunning();
      if (!isRunning) {
        printError('Proxy is not running.');
        printInfo('Start the proxy with: pfscan proxy start --all');
        return;
      }

      const result = await client.reload();
      if (result.success) {
        printSuccess('Proxy reloaded.');
        if (result.data) {
          if (result.data.reloadedConnectors.length > 0) {
            printInfo(`Reloaded connectors: ${result.data.reloadedConnectors.join(', ')}`);
          }
          if (result.data.failedConnectors.length > 0) {
            printError(`Failed connectors: ${result.data.failedConnectors.join(', ')}`);
          }
        }
      } else {
        printError(`Reload failed: ${result.error}`);
      }
      return;
    }

    if (subcommand === 'stop') {
      const isRunning = await client.isRunning();
      if (!isRunning) {
        printInfo('Proxy is not running.');
        return;
      }

      const result = await client.stop();
      if (result.success) {
        printSuccess('Proxy stopped.');
      } else {
        printError(`Failed to stop proxy: ${result.error}`);
      }
      return;
    }

    printError(`Unknown proxy subcommand: ${subcommand}`);
    printInfo('Available: status, reload, stop');
  }

  /**
   * Process a line in configure mode
   */
  private async processConfigureLine(line: string): Promise<void> {
    if (!this.configureMode) return;

    const result = await processConfigureCommand(this.configureMode, line);

    // Handle output
    if (result.output) {
      for (const outputLine of result.output) {
        console.log(outputLine);
      }
    }

    if (result.message) {
      if (result.success) {
        printSuccess(result.message);
      } else {
        printInfo(result.message);
      }
    }

    if (result.error) {
      printError(result.error);
    }

    // Handle mode transitions
    if (result.exitMode) {
      this.configureMode = null;
      // Update prompt back to normal shell (completer switches dynamically)
      if (this.rl) {
        this.rl.setPrompt(this.getCurrentPrompt());
      }
    }

    // Update prompt if still in configure mode
    if (this.configureMode?.isActive() && this.rl) {
      this.rl.setPrompt(this.configureMode.getPrompt());
    }
  }

  /**
   * Get the current prompt string
   */
  private getCurrentPrompt(): string {
    if (this.configureMode?.isActive()) {
      return this.configureMode.getPrompt();
    }
    return generatePrompt(this.context);
  }
}
