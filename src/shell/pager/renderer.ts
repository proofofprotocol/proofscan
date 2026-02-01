/**
 * Pager Renderer
 *
 * Converts PipelineValue rows to string lines for pager display.
 * Extracts and reuses table rendering logic from repl.ts.
 */

import type { PipelineValue, RpcRow, SessionRow, A2AMessageRow } from '../pipeline-types.js';
import { shortenSessionId } from '../prompt.js';

/** Render options */
export interface RenderOptions {
  /** Use ANSI colors (default: auto-detect from TTY) */
  useColor?: boolean;
}

/**
 * Convert pipeline value to array of lines for pager display
 */
export function renderRowsToLines(
  input: PipelineValue,
  options?: RenderOptions
): string[] {
  if (input.kind === 'text') {
    return input.text.split('\n');
  }

  if (input.rows.length === 0) {
    return ['No results'];
  }

  const useColor = options?.useColor ?? process.stdout.isTTY ?? false;

  if (input.rowType === 'rpc') {
    return renderRpcLines(input.rows as RpcRow[], useColor);
  } else if (input.rowType === 'session') {
    return renderSessionLines(input.rows as SessionRow[], useColor);
  } else if (input.rowType === 'a2a-message') {
    return renderA2AMessageLines(input.rows as A2AMessageRow[], useColor);
  } else if (input.rowType === 'connector') {
    return ['Connector rows not supported in pager'];
  }

  return ['Unknown row type'];
}

/**
 * Render RPC rows to lines
 */
function renderRpcLines(rows: RpcRow[], useColor: boolean): string[] {
  const lines: string[] = [];
  const dimText = (text: string) => useColor ? `\x1b[2m${text}\x1b[0m` : text;
  const statusColor = (status: string) => {
    if (!useColor) return status;
    switch (status) {
      case 'OK': return '\x1b[32mOK\x1b[0m';
      case 'ERR': return '\x1b[31mERR\x1b[0m';
      default: return '\x1b[33mpending\x1b[0m';
    }
  };

  // Check if rows have target_id (find results have it, ls does not)
  const hasTarget = rows.some(r => r.target_id);

  if (hasTarget) {
    // Extended format for find results: Target, Session, Method, Status, Latency, Time
    lines.push(
      dimText('Target'.padEnd(10)) + '  ' +
      dimText('Session'.padEnd(10)) + '  ' +
      dimText('Method'.padEnd(16)) + '  ' +
      dimText('Status'.padEnd(useColor ? 16 : 8)) + '  ' +
      dimText('Latency'.padEnd(8)) + '  ' +
      dimText('Time')
    );
    lines.push(dimText('-'.repeat(90)));

    rows.forEach((row) => {
      const target = (row.target_id ?? '').slice(0, 10).padEnd(10);
      const sessionShort = shortenSessionId(row.session_id);
      const method = row.method.slice(0, 16).padEnd(16);
      const status = statusColor(row.status).padEnd(useColor ? 16 : 8);
      const latency = (row.latency_ms !== null ? `${row.latency_ms}ms` : '-').padEnd(8);
      // MM-DD HH:MM:SS format
      const time = row.request_ts ? row.request_ts.slice(5, 19).replace('T', ' ') : '-';

      lines.push(`${target}  ${sessionShort}  ${method}  ${status}  ${latency}  ${time}`);
    });
  } else {
    // Simple format for ls results (within a session)
    lines.push(
      dimText('#'.padEnd(4)) + '  ' +
      dimText('Method'.padEnd(20)) + '  ' +
      dimText('Status'.padEnd(useColor ? 16 : 8)) + '  ' +
      dimText('Latency')
    );
    lines.push(dimText('-'.repeat(55)));

    rows.forEach((row, idx) => {
      const num = String(idx + 1).padEnd(4);
      const method = row.method.slice(0, 20).padEnd(20);
      const status = statusColor(row.status).padEnd(useColor ? 16 : 8);
      const latency = row.latency_ms !== null ? `${row.latency_ms}ms` : '-';

      lines.push(`${num}  ${method}  ${status}  ${latency}`);
    });
  }

  return lines;
}

/**
 * Render Session rows to lines
 */
function renderSessionLines(rows: SessionRow[], useColor: boolean): string[] {
  const lines: string[] = [];
  const dimText = (text: string) => useColor ? `\x1b[2m${text}\x1b[0m` : text;

  // Check if rows span multiple targets (find at root level)
  const targetIds = new Set(rows.map(r => r.target_id));
  const multiTarget = targetIds.size > 1;

  if (multiTarget) {
    // Extended format with target column
    lines.push(
      dimText('Target'.padEnd(12)) + '  ' +
      dimText('Session'.padEnd(10)) + '  ' +
      dimText('RPCs'.padEnd(6)) + '  ' +
      dimText('Started')
    );
    lines.push(dimText('-'.repeat(55)));

    rows.forEach((row) => {
      const target = (row.target_id ?? '').slice(0, 12).padEnd(12);
      const sessionShort = shortenSessionId(row.session_id);
      const rpcs = String(row.rpc_count).padEnd(6);
      const started = row.started_at ? row.started_at.slice(0, 19).replace('T', ' ') : '-';

      lines.push(`${target}  ${sessionShort}  ${rpcs}  ${started}`);
    });
  } else {
    // Simple format (within a connector)
    lines.push(
      dimText('Session'.padEnd(10)) + '  ' +
      dimText('RPCs'.padEnd(6)) + '  ' +
      dimText('Events'.padEnd(8)) + '  ' +
      dimText('Started')
    );
    lines.push(dimText('-'.repeat(50)));

    rows.forEach((row) => {
      const sessionShort = shortenSessionId(row.session_id);
      const rpcs = String(row.rpc_count).padEnd(6);
      const events = String(row.event_count).padEnd(8);
      const started = row.started_at ? row.started_at.slice(0, 19).replace('T', ' ') : '-';

      lines.push(`${sessionShort}  ${rpcs}  ${events}  ${started}`);
    });
  }

  return lines;
}

/**
 * Render A2A message rows to lines
 */
function renderA2AMessageLines(rows: A2AMessageRow[], useColor: boolean): string[] {
  const lines: string[] = [];
  const dimText = (text: string) => useColor ? `\x1b[2m${text}\x1b[0m` : text;
  const roleColor = (role: string) => {
    if (!useColor) return role;
    return role === 'assistant' ? `\x1b[36m${role}\x1b[0m` : role;
  };

  // Check if rows have session_id (connector level)
  const hasSession = rows.some(r => r.session_id);

  if (hasSession) {
    // Extended format with session column
    lines.push(
      dimText('#'.padEnd(4)) + '  ' +
      dimText('Session'.padEnd(10)) + '  ' +
      dimText('Time'.padEnd(10)) + '  ' +
      dimText('Role'.padEnd(useColor ? 21 : 12)) + '  ' +
      dimText('Content')
    );
    lines.push(dimText('-'.repeat(80)));

    rows.forEach(row => {
      const sessionPrefix = row.session_id ? shortenSessionId(row.session_id) : '';
      const timeStr = row.timestamp ? row.timestamp.slice(11, 19) : '--:--:--';
      lines.push(
        String(row.id).padEnd(4) + '  ' +
        sessionPrefix.padEnd(10) + '  ' +
        timeStr.padEnd(10) + '  ' +
        roleColor(row.role).padEnd(useColor ? 21 : 12) + '  ' +
        row.content
      );
    });
  } else {
    // Simple format (session level)
    lines.push(
      dimText('#'.padEnd(4)) + '  ' +
      dimText('Time'.padEnd(10)) + '  ' +
      dimText('Role'.padEnd(useColor ? 21 : 12)) + '  ' +
      dimText('Content')
    );
    lines.push(dimText('-'.repeat(70)));

    rows.forEach(row => {
      const timeStr = row.timestamp ? row.timestamp.slice(11, 19) : '--:--:--';
      lines.push(
        String(row.id).padEnd(4) + '  ' +
        timeStr.padEnd(10) + '  ' +
        roleColor(row.role).padEnd(useColor ? 21 : 12) + '  ' +
        row.content
      );
    });
  }

  return lines;
}
