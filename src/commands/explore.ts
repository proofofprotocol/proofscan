/**
 * Explore command - interactive navigation through data
 *
 * Simple stdin/stdout TUI for exploring connector → session → rpc → detail
 */

import { Command } from 'commander';
import { createInterface, Interface } from 'readline';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { formatTimestamp, formatDuration, shortenId } from '../eventline/types.js';
import { getOutputOptions } from '../utils/output.js';
import type { SessionWithStats, RpcCall } from '../db/types.js';

type ExploreState =
  | { level: 'connectors' }
  | { level: 'sessions'; connectorId: string }
  | { level: 'rpcs'; connectorId: string; sessionId: string }
  | { level: 'detail'; connectorId: string; sessionId: string; rpcId: string };

interface ExploreContext {
  store: EventLineStore;
  state: ExploreState;
  rl: Interface;
  connectors: Array<{ id: string; session_count: number }>;
  sessions: SessionWithStats[];
  rpcs: RpcCall[];
}

function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function printHeader(ctx: ExploreContext): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  proofscan explore');
  console.log('═══════════════════════════════════════════════════════════════');

  // Breadcrumb
  const parts: string[] = ['connectors'];
  if (ctx.state.level !== 'connectors') {
    parts.push((ctx.state as { connectorId: string }).connectorId);
  }
  if (ctx.state.level === 'rpcs' || ctx.state.level === 'detail') {
    parts.push(shortenId((ctx.state as { sessionId: string }).sessionId, 8));
  }
  if (ctx.state.level === 'detail') {
    parts.push(`rpc:${(ctx.state as { rpcId: string }).rpcId}`);
  }

  console.log('  Path: ' + parts.join(' > '));
  console.log('───────────────────────────────────────────────────────────────');
}

function printHelp(): void {
  console.log();
  console.log('  Commands:');
  console.log('    <number>  Select item');
  console.log('    b         Back to previous level');
  console.log('    t         Show tree view');
  console.log('    /         Filter (not yet implemented)');
  console.log('    ?         Show this help');
  console.log('    q         Quit');
  console.log();
}

function printConnectors(ctx: ExploreContext): void {
  console.log();
  console.log('  Connectors:');
  console.log();

  if (ctx.connectors.length === 0) {
    console.log('    (no connectors found)');
    return;
  }

  for (let i = 0; i < ctx.connectors.length; i++) {
    const c = ctx.connectors[i];
    console.log(`    [${i + 1}] ${c.id} (${c.session_count} sessions)`);
  }
  console.log();
}

function printSessions(ctx: ExploreContext): void {
  console.log();
  console.log(`  Sessions for connector: ${(ctx.state as { connectorId: string }).connectorId}`);
  console.log();

  if (ctx.sessions.length === 0) {
    console.log('    (no sessions found)');
    return;
  }

  for (let i = 0; i < ctx.sessions.length; i++) {
    const s = ctx.sessions[i];
    const dur = s.ended_at
      ? formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())
      : 'running';
    const status = s.exit_reason === 'normal' ? '✓' : s.exit_reason === 'error' ? '✗' : '?';

    console.log(`    [${i + 1}] ${status} ${shortenId(s.session_id, 12)} | ${formatTimestamp(new Date(s.started_at).getTime())} | ${dur} | ${s.rpc_count || 0} rpcs`);
  }
  console.log();
}

function printRpcs(ctx: ExploreContext): void {
  console.log();
  console.log(`  RPC calls for session: ${shortenId((ctx.state as { sessionId: string }).sessionId, 12)}`);
  console.log();

  if (ctx.rpcs.length === 0) {
    console.log('    (no RPC calls found)');
    return;
  }

  for (let i = 0; i < ctx.rpcs.length; i++) {
    const r = ctx.rpcs[i];
    const status = r.success === 1 ? '✓' : r.success === 0 ? '✗' : '?';
    let latency = '';
    if (r.response_ts) {
      const lat = new Date(r.response_ts).getTime() - new Date(r.request_ts).getTime();
      latency = ` ${lat}ms`;
    }

    console.log(`    [${i + 1}] ${status} ${r.method} (id=${r.rpc_id})${latency}`);
  }
  console.log();
  console.log('    [p] View request/response pair');
  console.log();
}

function printDetail(ctx: ExploreContext): void {
  const state = ctx.state as { sessionId: string; rpcId: string };
  const rawData = ctx.store.getRawEvent(state.sessionId, state.rpcId);

  console.log();
  console.log(`  RPC Detail: ${state.rpcId}`);
  console.log();

  if (!rawData) {
    console.log('    (no raw data available)');
    return;
  }

  if (rawData.request?.raw_json) {
    console.log('  ══ Request ══');
    try {
      const parsed = JSON.parse(rawData.request.raw_json);
      console.log(JSON.stringify(parsed, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    } catch {
      console.log('    ' + rawData.request.raw_json);
    }
    console.log();
  }

  if (rawData.response?.raw_json) {
    console.log('  ══ Response ══');
    try {
      const parsed = JSON.parse(rawData.response.raw_json);
      console.log(JSON.stringify(parsed, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    } catch {
      console.log('    ' + rawData.response.raw_json);
    }
    console.log();
  }
}

function render(ctx: ExploreContext): void {
  clearScreen();
  printHeader(ctx);

  switch (ctx.state.level) {
    case 'connectors':
      printConnectors(ctx);
      break;
    case 'sessions':
      printSessions(ctx);
      break;
    case 'rpcs':
      printRpcs(ctx);
      break;
    case 'detail':
      printDetail(ctx);
      break;
  }
}

function loadData(ctx: ExploreContext): void {
  switch (ctx.state.level) {
    case 'connectors':
      ctx.connectors = ctx.store.getConnectors();
      break;
    case 'sessions':
      ctx.sessions = ctx.store.getSessions((ctx.state as { connectorId: string }).connectorId, 20);
      break;
    case 'rpcs':
      ctx.rpcs = ctx.store.getRpcCalls((ctx.state as { sessionId: string }).sessionId);
      break;
  }
}

function handleInput(ctx: ExploreContext, input: string): boolean {
  const cmd = input.trim().toLowerCase();

  // Quit
  if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
    return false;
  }

  // Help
  if (cmd === '?' || cmd === 'help') {
    printHelp();
    ctx.rl.question('Press Enter to continue...', () => {
      render(ctx);
      prompt(ctx);
    });
    return true;
  }

  // Back
  if (cmd === 'b' || cmd === 'back') {
    switch (ctx.state.level) {
      case 'connectors':
        // Already at top
        break;
      case 'sessions':
        ctx.state = { level: 'connectors' };
        break;
      case 'rpcs':
        ctx.state = { level: 'sessions', connectorId: (ctx.state as { connectorId: string }).connectorId };
        break;
      case 'detail':
        ctx.state = {
          level: 'rpcs',
          connectorId: (ctx.state as { connectorId: string }).connectorId,
          sessionId: (ctx.state as { sessionId: string }).sessionId,
        };
        break;
    }
    loadData(ctx);
    render(ctx);
    prompt(ctx);
    return true;
  }

  // Tree view
  if (cmd === 't' || cmd === 'tree') {
    console.log();
    console.log('  (tree view not implemented in explore mode, use: pfscan tree)');
    ctx.rl.question('Press Enter to continue...', () => {
      render(ctx);
      prompt(ctx);
    });
    return true;
  }

  // Number selection
  const num = parseInt(cmd, 10);
  if (!isNaN(num) && num > 0) {
    switch (ctx.state.level) {
      case 'connectors':
        if (num <= ctx.connectors.length) {
          const connector = ctx.connectors[num - 1];
          ctx.state = { level: 'sessions', connectorId: connector.id };
          loadData(ctx);
        }
        break;
      case 'sessions':
        if (num <= ctx.sessions.length) {
          const session = ctx.sessions[num - 1];
          ctx.state = {
            level: 'rpcs',
            connectorId: (ctx.state as { connectorId: string }).connectorId,
            sessionId: session.session_id,
          };
          loadData(ctx);
        }
        break;
      case 'rpcs':
        if (num <= ctx.rpcs.length) {
          const rpc = ctx.rpcs[num - 1];
          ctx.state = {
            level: 'detail',
            connectorId: (ctx.state as { connectorId: string }).connectorId,
            sessionId: (ctx.state as { sessionId: string }).sessionId,
            rpcId: rpc.rpc_id,
          };
        }
        break;
    }
    render(ctx);
    prompt(ctx);
    return true;
  }

  // Pair view in RPC list
  if (cmd === 'p' && ctx.state.level === 'rpcs') {
    const currentState = ctx.state as { connectorId: string; sessionId: string };
    console.log('  Enter RPC number to view: ');
    ctx.rl.question('  > ', (answer) => {
      const n = parseInt(answer, 10);
      if (!isNaN(n) && n > 0 && n <= ctx.rpcs.length) {
        const rpc = ctx.rpcs[n - 1];
        ctx.state = {
          level: 'detail',
          connectorId: currentState.connectorId,
          sessionId: currentState.sessionId,
          rpcId: rpc.rpc_id,
        };
      }
      render(ctx);
      prompt(ctx);
    });
    return true;
  }

  // Unknown command
  render(ctx);
  prompt(ctx);
  return true;
}

function prompt(ctx: ExploreContext): void {
  const promptStr = ctx.state.level === 'detail' ? '  (b=back, q=quit) > ' : '  > ';
  ctx.rl.question(promptStr, (answer) => {
    if (handleInput(ctx, answer)) {
      // Continue - handleInput will call prompt again
    } else {
      // Quit
      ctx.rl.close();
      console.log();
      console.log('Goodbye!');
    }
  });
}

async function runExplore(store: EventLineStore, options: { session?: string }): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ctx: ExploreContext = {
    store,
    state: { level: 'connectors' },
    rl,
    connectors: [],
    sessions: [],
    rpcs: [],
  };

  // If session is specified, jump to that session
  if (options.session) {
    const session = store.findSession(options.session);
    if (session) {
      ctx.state = {
        level: 'rpcs',
        connectorId: session.connector_id,
        sessionId: session.session_id,
      };
    }
  }

  loadData(ctx);
  render(ctx);
  prompt(ctx);
}

export function createExploreCommand(getConfigPath: () => string): Command {
  const cmd = new Command('explore')
    .description('Interactive exploration of connector → session → rpc')
    .option('--session <id>', 'Start at specific session (partial match)')
    .action(async (options) => {
      // JSON mode not supported for interactive
      if (getOutputOptions().json) {
        console.error('Error: --json not supported for interactive explore');
        console.error('Use: pfscan tree --json or pfscan view --json');
        process.exit(1);
      }

      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        await runExplore(store, options);

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
    });

  return cmd;
}

// Aliases
export { createExploreCommand as createECommand };
