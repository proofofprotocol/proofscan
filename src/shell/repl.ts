/**
 * Shell REPL implementation
 */

import * as readline from 'readline';
import { spawn } from 'child_process';
import type { ShellContext } from './types.js';
import { SHELL_BUILTINS, TOP_LEVEL_COMMANDS } from './types.js';
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
      getSessionPrefixes: (connectorId?: string, limit: number = 10) => {
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
        this.showContext();
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
    if (topic) {
      printInfo(`Help for "${topic}" - run "pfscan ${topic} --help" for details`);
      return;
    }

    console.log(`
Shell Commands:
  use <connector>         Set current connector context
  use session <prefix>    Set current session context
  reset                   Clear context (connector and session)
  pwd                     Show current context
  help [command]          Show help
  clear                   Clear screen
  exit, quit              Exit shell

Available Commands:
  ${TOP_LEVEL_COMMANDS.join(', ')}

Tips:
  - Press TAB for auto-completion
  - Current context is shown in the prompt
  - Commands run with current context applied
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
        return;
      }

      // Find session by prefix
      const prefix = args[1];
      const manager = new ConfigManager(this.configPath);
      const store = new EventLineStore(manager.getConfigDir());
      const sessions = store.getSessions(this.context.connector, 100);
      const matches = sessions.filter(s => s.session_id.startsWith(prefix));

      if (matches.length === 0) {
        printError(`Session not found: ${prefix}`);
        return;
      }

      if (matches.length > 1) {
        // Ambiguous prefix - show all matches
        printError(`Ambiguous session prefix: ${prefix}`);
        printInfo('Matching sessions:');
        matches.slice(0, 10).forEach(s => {
          console.log(`  ${shortenSessionId(s.session_id)} (${s.connector_id})`);
        });
        if (matches.length > 10) {
          printInfo(`  ... and ${matches.length - 10} more`);
        }
        printInfo('Provide a longer prefix to disambiguate.');
        return;
      }

      const match = matches[0];
      this.context.session = match.session_id;
      this.context.connector = match.connector_id;
      setCurrentSession(match.session_id, match.connector_id);
      printSuccess(`Session set to: ${shortenSessionId(match.session_id)} (${match.connector_id})`);
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
    // Build command line with context
    const cmdArgs = this.buildCommandArgs(tokens);
    const command = tokens[0];

    // Spawn pfscan process
    return new Promise((resolve) => {
      const proc = spawn('pfscan', cmdArgs, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

      proc.on('error', (err) => {
        printError(`Failed to run command: ${err.message}`);
        resolve();
      });

      proc.on('close', () => {
        // Invalidate cache after data-modifying commands
        if (['scan', 's', 'archive', 'a'].includes(command)) {
          this.invalidateCache();
        }
        resolve();
      });
    });
  }

  /**
   * Build command arguments with context applied
   */
  private buildCommandArgs(tokens: string[]): string[] {
    const args = [...tokens];
    const command = tokens[0];

    // Add --connector if context has connector and command supports it
    const connectorCommands = ['view', 'v', 'tree', 't'];
    if (this.context.connector && connectorCommands.includes(command)) {
      if (!args.includes('--connector') && !this.hasPositionalConnector(args)) {
        args.push('--connector', this.context.connector);
      }
    }

    // Add --session if context has session and command supports it
    const sessionCommands = ['rpc', 'summary', 'permissions', 'view', 'v'];
    if (this.context.session && sessionCommands.includes(command)) {
      if (!args.includes('--session')) {
        args.push('--session', this.context.session);
      }
    }

    // Add --id for scan start if context has connector
    if (command === 'scan' || command === 's') {
      if (args.includes('start') && !args.includes('--id') && this.context.connector) {
        const hasPositional = args.length > 2 && !args[2].startsWith('-');
        if (!hasPositional) {
          args.push('--id', this.context.connector);
        }
      }
    }

    return args;
  }

  /**
   * Check if command has a positional connector argument
   */
  private hasPositionalConnector(args: string[]): boolean {
    // For tree command, check if there's a positional argument
    if (args[0] === 'tree' || args[0] === 't') {
      return args.length > 1 && !args[1].startsWith('-');
    }
    return false;
  }
}
