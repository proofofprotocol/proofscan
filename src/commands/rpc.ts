/**
 * RPC command - View RPC call details
 *
 * pfscan rpc list --session <sid>  # List RPC calls for a session
 * pfscan rpc show --session <sid> --id <rpc_id>  # Show RPC details with request/response
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import { getEventsDb } from '../db/connection.js';
import {
  formatTimestamp,
  formatBytes,
  shortenId,
} from '../eventline/types.js';
import { output, getOutputOptions } from '../utils/output.js';
import type { RpcCall, Event } from '../db/types.js';

interface RpcListItem {
  rpc_id: string;
  method: string;
  status: 'OK' | 'ERR' | 'pending';
  latency_ms: number | null;
  request_ts: string;
  response_ts: string | null;
  error_code: number | null;
}

interface RpcDetail {
  rpc_id: string;
  session_id: string;
  connector_id: string;
  method: string;
  status: 'OK' | 'ERR' | 'pending';
  latency_ms: number | null;
  request_size: number | null;
  response_size: number | null;
  error_code: number | null;
  request_ts: string;
  response_ts: string | null;
  request_json: unknown | null;
  response_json: unknown | null;
}

/**
 * Get RPC calls for a session with computed fields
 */
function getRpcList(configDir: string, sessionId: string): RpcListItem[] {
  const db = getEventsDb(configDir);

  const rpcs = db.prepare(`
    SELECT * FROM rpc_calls
    WHERE session_id LIKE ?
    ORDER BY request_ts DESC
  `).all(sessionId + '%') as RpcCall[];

  return rpcs.map(rpc => {
    let latency_ms: number | null = null;
    if (rpc.response_ts) {
      latency_ms = new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime();
    }

    let status: 'OK' | 'ERR' | 'pending';
    if (rpc.success === 1) {
      status = 'OK';
    } else if (rpc.success === 0) {
      status = 'ERR';
    } else {
      status = 'pending';
    }

    return {
      rpc_id: rpc.rpc_id,
      method: rpc.method,
      status,
      latency_ms,
      request_ts: rpc.request_ts,
      response_ts: rpc.response_ts,
      error_code: rpc.error_code,
    };
  });
}

/**
 * Get detailed RPC information including request/response JSON
 */
function getRpcDetail(configDir: string, sessionId: string, rpcId: string): RpcDetail | null {
  const db = getEventsDb(configDir);

  // Find the session (support partial match)
  const session = db.prepare(`
    SELECT session_id, connector_id FROM sessions
    WHERE session_id LIKE ?
    LIMIT 1
  `).get(sessionId + '%') as { session_id: string; connector_id: string } | undefined;

  if (!session) {
    return null;
  }

  // Get the RPC call
  const rpc = db.prepare(`
    SELECT * FROM rpc_calls
    WHERE session_id = ? AND rpc_id = ?
  `).get(session.session_id, rpcId) as RpcCall | undefined;

  if (!rpc) {
    return null;
  }

  // Get request and response events
  const requestEvent = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'request'
  `).get(session.session_id, rpcId) as Event | undefined;

  const responseEvent = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
  `).get(session.session_id, rpcId) as Event | undefined;

  // Parse JSON
  let requestJson: unknown = null;
  let responseJson: unknown = null;

  if (requestEvent?.raw_json) {
    try {
      requestJson = JSON.parse(requestEvent.raw_json);
    } catch {
      requestJson = requestEvent.raw_json;
    }
  }

  if (responseEvent?.raw_json) {
    try {
      responseJson = JSON.parse(responseEvent.raw_json);
    } catch {
      responseJson = responseEvent.raw_json;
    }
  }

  // Calculate sizes
  const requestSize = requestEvent?.raw_json ? Buffer.byteLength(requestEvent.raw_json, 'utf8') : null;
  const responseSize = responseEvent?.raw_json ? Buffer.byteLength(responseEvent.raw_json, 'utf8') : null;

  // Calculate latency
  let latency_ms: number | null = null;
  if (rpc.response_ts) {
    latency_ms = new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime();
  }

  // Determine status
  let status: 'OK' | 'ERR' | 'pending';
  if (rpc.success === 1) {
    status = 'OK';
  } else if (rpc.success === 0) {
    status = 'ERR';
  } else {
    status = 'pending';
  }

  return {
    rpc_id: rpc.rpc_id,
    session_id: session.session_id,
    connector_id: session.connector_id,
    method: rpc.method,
    status,
    latency_ms,
    request_size: requestSize,
    response_size: responseSize,
    error_code: rpc.error_code,
    request_ts: rpc.request_ts,
    response_ts: rpc.response_ts,
    request_json: requestJson,
    response_json: responseJson,
  };
}

/**
 * Render RPC list item for terminal
 */
function renderRpcListItem(item: RpcListItem, options: { fulltime?: boolean }): string {
  const ts = formatTimestamp(new Date(item.request_ts).getTime(), options.fulltime);
  const statusSymbol = item.status === 'OK' ? '✓' : item.status === 'ERR' ? '✗' : '?';

  const parts: string[] = [
    ts,
    statusSymbol,
    item.rpc_id.slice(0, 8).padEnd(8),
    item.method.slice(0, 30).padEnd(30),
  ];

  if (item.latency_ms !== null) {
    parts.push(`${item.latency_ms}ms`);
  } else {
    parts.push('(pending)');
  }

  if (item.error_code !== null) {
    parts.push(`err=${item.error_code}`);
  }

  return parts.join(' ');
}

/**
 * Render RPC detail for terminal
 */
function renderRpcDetail(detail: RpcDetail): void {
  console.log('═'.repeat(60));
  console.log(`RPC: ${detail.method}`);
  console.log('═'.repeat(60));
  console.log();

  // Basic info
  console.log('Info:');
  console.log(`  RPC ID:      ${detail.rpc_id}`);
  console.log(`  Session:     ${shortenId(detail.session_id, 12)}...`);
  console.log(`  Connector:   ${detail.connector_id}`);
  console.log(`  Status:      ${detail.status}${detail.error_code !== null ? ` (code: ${detail.error_code})` : ''}`);
  console.log();

  // Timing
  console.log('Timing:');
  console.log(`  Request:     ${detail.request_ts}`);
  if (detail.response_ts) {
    console.log(`  Response:    ${detail.response_ts}`);
  }
  if (detail.latency_ms !== null) {
    console.log(`  Latency:     ${detail.latency_ms}ms`);
  }
  console.log();

  // Size
  console.log('Size:');
  if (detail.request_size !== null) {
    console.log(`  Request:     ${formatBytes(detail.request_size)}`);
  }
  if (detail.response_size !== null) {
    console.log(`  Response:    ${formatBytes(detail.response_size)}`);
  }
  console.log();

  // Request JSON
  console.log('─'.repeat(60));
  console.log('Request:');
  console.log('─'.repeat(60));
  if (detail.request_json) {
    console.log(JSON.stringify(detail.request_json, null, 2));
  } else {
    console.log('  (no request data)');
  }
  console.log();

  // Response JSON
  console.log('─'.repeat(60));
  console.log('Response:');
  console.log('─'.repeat(60));
  if (detail.response_json) {
    console.log(JSON.stringify(detail.response_json, null, 2));
  } else {
    console.log('  (no response data)');
  }
}

export function createRpcCommand(getConfigPath: () => string): Command {
  const cmd = new Command('rpc')
    .description('View RPC call details');

  // rpc list --session <sid>
  cmd
    .command('list')
    .description('List RPC calls for a session')
    .requiredOption('--session <id>', 'Session ID (partial match supported)')
    .option('--fulltime', 'Show full timestamp')
    .option('--limit <n>', 'Number of RPCs to show', '20')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        const rpcs = getRpcList(configDir, options.session);

        if (rpcs.length === 0) {
          console.log('No RPC calls found for this session.');
          console.log('hint: Use a valid session ID from `pfscan view --pairs`');
          return;
        }

        // Limit results
        const limitedRpcs = rpcs.slice(0, parseInt(options.limit, 10));

        if (getOutputOptions().json) {
          output(limitedRpcs);
          return;
        }

        // Print header
        const header = options.fulltime
          ? 'Time                    St RPC      Method                         Latency'
          : 'Time         St RPC      Method                         Latency';
        console.log(header);
        console.log('-'.repeat(header.length));

        // Print items
        for (const item of limitedRpcs) {
          console.log(renderRpcListItem(item, { fulltime: options.fulltime }));
        }

        // Summary
        console.log();
        const okCount = limitedRpcs.filter(r => r.status === 'OK').length;
        const errCount = limitedRpcs.filter(r => r.status === 'ERR').length;
        const pendingCount = limitedRpcs.filter(r => r.status === 'pending').length;
        console.log(`${limitedRpcs.length} RPCs: ${okCount} OK, ${errCount} ERR, ${pendingCount} pending`);
        console.log();
        console.log('hint: Use `pfscan rpc show --session <ses> --id <rpc>` for details');

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
    });

  // rpc show --session <sid> --id <rpc_id>
  cmd
    .command('show')
    .description('Show RPC call details with request/response JSON')
    .requiredOption('--session <id>', 'Session ID (partial match supported)')
    .requiredOption('--id <rpc_id>', 'RPC ID')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        const detail = getRpcDetail(configDir, options.session, options.id);

        if (!detail) {
          console.log('RPC call not found.');
          console.log('hint: Use `pfscan rpc list --session <ses>` to see available RPCs');
          return;
        }

        if (getOutputOptions().json) {
          output(detail);
          return;
        }

        renderRpcDetail(detail);

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
