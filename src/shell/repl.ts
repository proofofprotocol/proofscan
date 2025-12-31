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
    const tokens = line.trim().split(/\s+/).filter(t => t !== '');
    if (tokens.length === 0) return;

    const command = tokens[0];
    const args = tokens.slice(1);

    // Handle router-style commands first
    if (ROUTER_COMMANDS.includes(command)) {
      await this.handleRouterCommand(command, args);
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
        handlePwd(this.context, this.configPath);
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
    cd ..                 Go up one level
    cd ../..              Go up two levels
    cd -                  Go to previous location
  ls [-l] [--json]        List items at current level
  show [target] [--json]  Show details
  pwd                     Show current context path

Shell Commands:
  help [command]          Show help
  clear                   Clear screen
  exit, quit              Exit shell

ProofScan Commands:
  ${getAllowedCommands().join(', ')}

Tips:
  - Press TAB for auto-completion
  - Prompt shows: proofscan:/connector/session (proto)
  - Commands auto-apply current context
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
