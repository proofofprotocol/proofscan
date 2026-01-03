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
  getAllowedCommands,
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
        this.history = addToHistory(this.history, trimmed);
        await this.processLine(trimmed);
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
   * Handle router-style commands (cc, cd, ls, show, ..)
   */
  private async handleRouterCommand(command: string, args: string[]): Promise<void> {
    switch (command) {
      case 'cc':
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

      case 'use':
        await this.handleUse(args);
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
Navigation:
  cd, cc                  Change context (alias for each other)
    cd /                  Go to root
    cd <connector>        Enter connector context
    cd <session>          Enter session (in connector context)
    cd <conn>/<sess>      Enter session directly
    cd @last              Jump to latest session/RPC
    cd @ref:<name>        Jump to saved reference
    cd ..                 Go up one level
    cd -                  Go to previous location
  ls [-l] [--json]        List items at current level
  pwd [--json]            Show current path (--json for RefStruct)

Resource Details (show):
  show [target] [--json]  Show resource details (request/response data)
  show @rpc:abc           Show specific RPC details
  show @ref:<name>        Show referenced resource details

Reference Resolution (ref):
  ref @this               Resolve current context to RefStruct
  ref @last               Resolve latest session/RPC
  ref @rpc:abc            Resolve specific RPC
  ref @ref:<name>         Resolve saved reference
  ref add <name> @...     Save a reference
  ref ls                  List all user-defined references
  ref rm <name>           Remove a reference

Tool Commands:
  tool ls                 List tools on current connector
  tool show <name>        Show tool details (description, schema)
  send <name>             Call a tool interactively
  send @last              Replay last RPC call
  send @ref:<name>        Replay from saved reference

Inscribe Commands:
  inscribe @rpc:<id>      Inscribe RPC to blockchain
  inscribe @ref:<name>    Inscribe from saved reference
  inscribe @last          Inscribe latest RPC
  show @rpc:<id> --json | inscribe   Inscribe via pipe

Shell Commands:
  help [command]          Show help
  clear                   Clear screen
  exit, quit              Exit shell

ProofScan Commands:
  ${getAllowedCommands().join(', ')}

Tips:
  - @ is the dereference operator (e.g., @this, @last, @ref:<name>)
  - show = resource details (data), ref = address resolution (RefStruct)
  - Press TAB for auto-completion
  - Use pipes: pwd --json | ref add myname
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
   * Handle 'use' command
   */
  private async handleUse(args: string[]): Promise<void> {
    if (args.length === 0) {
      // Show interactive connector selection
      if (!canInteract()) {
        printError('Usage: use <connector> or use session <prefix>');
        return;
      }

      const dataProvider = this.getDataProvider();
      const connectors = dataProvider.getConnectorIds();

      if (connectors.length === 0) {
        printError('No connectors found. Run a scan first.');
        return;
      }

      const selected = await selectConnector(connectors);
      if (selected) {
        this.context.connector = selected;
        this.context.session = undefined;
        setCurrentSession('', selected); // Save connector only
        printSuccess(`Connector set to: ${selected}`);
      }
      return;
    }

    if (args[0] === 'session') {
      if (args.length < 2) {
        // Show interactive session selection
        if (!canInteract()) {
          printError('Usage: use session <prefix>');
          return;
        }

        try {
          const manager = new ConfigManager(this.configPath);
          const store = new EventLineStore(manager.getConfigDir());
          const sessions = store.getSessions(this.context.connector, 10);

          if (sessions.length === 0) {
            printError('No sessions found. Run a scan first.');
            return;
          }

          const selected = await selectSession(
            sessions.map(s => ({ id: s.session_id, connector_id: s.connector_id }))
          );

          if (selected) {
            this.context.session = selected;
            // Also set connector from session
            const session = sessions.find(s => s.session_id === selected);
            if (session) {
              this.context.connector = session.connector_id;
            }
            setCurrentSession(selected, this.context.connector);
            printSuccess(`Session set to: ${shortenSessionId(selected)}`);
          }
        } catch (err) {
          printError(`Failed to load sessions: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // Find session by prefix
      const prefix = args[1];
      try {
        const manager = new ConfigManager(this.configPath);
        const store = new EventLineStore(manager.getConfigDir());
        const sessions = store.getSessions(this.context.connector, SESSION_SEARCH_LIMIT);
        const matches = sessions.filter(s => s.session_id.startsWith(prefix));

        if (matches.length === 0) {
          printError(`Session not found: ${prefix}`);
          return;
        }

        if (matches.length > 1) {
          // Ambiguous prefix - offer interactive selection if possible
          if (canInteract()) {
            printInfo(`Multiple sessions match "${prefix}". Select one:`);
            const selected = await selectSession(
              matches.slice(0, 20).map(s => ({ id: s.session_id, connector_id: s.connector_id }))
            );
            if (selected) {
              this.context.session = selected;
              const session = matches.find(s => s.session_id === selected);
              if (session) {
                this.context.connector = session.connector_id;
              }
              setCurrentSession(selected, this.context.connector);
              printSuccess(`Session set to: ${shortenSessionId(selected)} (${this.context.connector})`);
            }
          } else {
            printError(`Ambiguous session prefix: ${prefix}`);
            printInfo('Matching sessions:');
            matches.slice(0, 10).forEach(s => {
              console.log(`  ${shortenSessionId(s.session_id)} (${s.connector_id})`);
            });
            if (matches.length > 10) {
              printInfo(`  ... and ${matches.length - 10} more`);
            }
            printInfo('Provide a longer prefix to disambiguate.');
          }
          return;
        }

        const match = matches[0];
        this.context.session = match.session_id;
        this.context.connector = match.connector_id;
        setCurrentSession(match.session_id, match.connector_id);
        printSuccess(`Session set to: ${shortenSessionId(match.session_id)} (${match.connector_id})`);
      } catch (err) {
        printError(`Failed to load sessions: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Set connector
    const connectorId = args[0];
    const dataProvider = this.getDataProvider();
    const connectors = dataProvider.getConnectorIds();

    if (!connectors.includes(connectorId)) {
      // Try partial match
      const match = connectors.find(c => c.startsWith(connectorId));
      if (match) {
        this.context.connector = match;
        this.context.session = undefined;
        printSuccess(`Connector set to: ${match}`);
        return;
      }

      printError(`Connector not found: ${connectorId}`);
      printInfo(`Available: ${connectors.join(', ')}`);
      return;
    }

    this.context.connector = connectorId;
    this.context.session = undefined;
    printSuccess(`Connector set to: ${connectorId}`);
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
   * Handle piped commands
   * Supports:
   *   pwd --json | ref add <name>
   *   show @rpc:<id> --json | inscribe
   */
  private async handlePipe(leftCmd: string, rightCmd: string): Promise<void> {
    const leftTokens = leftCmd.split(/\s+/).filter(t => t !== '');
    const rightTokens = rightCmd.split(/\s+/).filter(t => t !== '');

    if (leftTokens.length === 0 || rightTokens.length === 0) {
      printError('Invalid pipe syntax');
      return;
    }

    const leftCommand = leftTokens[0];
    const rightCommand = rightTokens[0];

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
   */
  private async handlePipeToRefAdd(leftTokens: string[], rightTokens: string[]): Promise<void> {
    const leftCommand = leftTokens[0];

    if (leftCommand !== 'pwd' || !leftTokens.includes('--json')) {
      printError('Pipe source must be: pwd --json');
      printInfo('Example: pwd --json | ref add myref');
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
