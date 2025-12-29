/**
 * Tree command - hierarchical view of connector → session → rpc
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { formatDuration, shortenId, type TreeNode } from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';

/**
 * Render tree to ASCII format
 */
function renderTree(nodes: TreeNode[], prefix: string = '', isLast: boolean = true): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLastNode = i === nodes.length - 1;

    // Determine prefix for this node
    const nodePrefix = prefix + (isLast ? '' : '│   ');
    const branch = isLastNode ? '└── ' : '├── ';

    // Add type icon
    let icon = '';
    switch (node.type) {
      case 'connector': icon = '📦'; break;
      case 'session': icon = '📋'; break;
      case 'rpc': icon = '↔️'; break;
      case 'proof': icon = '🔒'; break;
      case 'event': icon = '•'; break;
    }

    lines.push(nodePrefix + branch + icon + ' ' + node.label);

    // Recurse into children
    if (node.children && node.children.length > 0) {
      const childPrefix = nodePrefix + (isLastNode ? '    ' : '│   ');
      const childLines = renderTreeChildren(node.children, childPrefix);
      lines.push(...childLines);
    }
  }

  return lines;
}

function renderTreeChildren(nodes: TreeNode[], prefix: string): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLastNode = i === nodes.length - 1;
    const branch = isLastNode ? '└── ' : '├── ';

    // Add type icon
    let icon = '';
    switch (node.type) {
      case 'connector': icon = '📦'; break;
      case 'session': icon = '📋'; break;
      case 'rpc': icon = '↔️'; break;
      case 'proof': icon = '🔒'; break;
      case 'event': icon = '•'; break;
    }

    lines.push(prefix + branch + icon + ' ' + node.label);

    // Recurse into children
    if (node.children && node.children.length > 0) {
      const childPrefix = prefix + (isLastNode ? '    ' : '│   ');
      const childLines = renderTreeChildren(node.children, childPrefix);
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Compact tree rendering (no icons, minimal spacing)
 */
function renderTreeCompact(nodes: TreeNode[], prefix: string = ''): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLastNode = i === nodes.length - 1;
    const branch = isLastNode ? '`-- ' : '|-- ';

    // Compact label based on type
    let label = node.label;
    if (node.type === 'session' && node.meta) {
      const sid = shortenId(node.id, 8);
      const rpcs = node.meta.rpc_count || 0;
      const dur = node.meta.duration_ms ? formatDuration(node.meta.duration_ms as number) : 'running';
      label = `${sid} (${rpcs} rpcs, ${dur})`;
    } else if (node.type === 'rpc' && node.meta) {
      const status = node.meta.success === 1 ? '+' : node.meta.success === 0 ? 'x' : '?';
      label = `[${status}] ${node.meta.method} (${node.id})`;
    }

    lines.push(prefix + branch + label);

    // Recurse into children
    if (node.children && node.children.length > 0) {
      const childPrefix = prefix + (isLastNode ? '    ' : '|   ');
      const childLines = renderTreeCompact(node.children, childPrefix);
      lines.push(...childLines);
    }
  }

  return lines;
}

export function createTreeCommand(getConfigPath: () => string): Command {
  const cmd = new Command('tree')
    .description('Show hierarchical view of connector → session → rpc')
    .argument('[connector]', 'Filter by connector ID')
    .option('--sessions <n>', 'Number of sessions per connector', '5')
    .option('--rpc <n>', 'Number of RPC calls per session', '10')
    .option('--session <id>', 'Show specific session (partial match)')
    .option('--rpc-all', 'Show all RPC calls')
    .option('--method <pattern>', 'Filter by method name')
    .option('--status <status>', 'Filter by status (ok, err, all)', 'all')
    .option('--compact', 'Compact output')
    .option('--ids-only', 'Show only IDs without details')
    .option('--since <time>', 'Show sessions since (24h, 7d, YYYY-MM-DD)')
    .action(async (connector, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const store = new EventLineStore(manager.getConfigDir());

        let tree = store.buildTree({
          sessions: parseInt(options.sessions, 10),
          rpc: parseInt(options.rpc, 10),
          session: options.session,
          rpcAll: options.rpcAll,
          method: options.method,
          status: options.status as 'ok' | 'err' | 'all',
          compact: options.compact,
          idsOnly: options.idsOnly,
          since: options.since,
        });

        // Filter by connector if specified
        if (connector) {
          tree = tree.filter(n => n.id === connector || n.id.includes(connector));
        }

        if (tree.length === 0) {
          console.log('No data found.');
          console.log();
          console.log('hint: Run a scan first: pfscan scan start --id <connector>');
          return;
        }

        if (getOutputOptions().json) {
          output(tree);
          return;
        }

        // Render tree
        const lines = options.compact
          ? renderTreeCompact(tree)
          : renderTree(tree);

        for (const line of lines) {
          console.log(line);
        }

        // Summary
        console.log();
        const totalConnectors = tree.length;
        const totalSessions = tree.reduce((sum, c) => sum + (c.children?.length || 0), 0);
        const totalRpcs = tree.reduce((sum, c) =>
          sum + (c.children?.reduce((s, sess) =>
            s + (sess.children?.filter(r => r.type === 'rpc').length || 0), 0) || 0), 0);
        console.log(`${totalConnectors} connector(s), ${totalSessions} session(s), ${totalRpcs} rpc(s)`);

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
export { createTreeCommand as createTCommand };
