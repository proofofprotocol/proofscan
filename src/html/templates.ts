/**
 * HTML Templates (Phase 5.0)
 *
 * Generates standalone HTML files for RPC and Session reports.
 * Dark theme with green accent badges.
 */

import { formatBytes } from '../eventline/types.js';
import type {
  HtmlRpcReportV1,
  HtmlSessionReportV1,
  PayloadData,
  RpcStatus,
  SessionRpcDetail,
} from './types.js';
import { getStatusSymbol } from './types.js';

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape JSON for embedding in <script type="application/json">
 * Must escape </script> sequences to prevent premature tag closing
 */
export function escapeJsonForScript(json: string): string {
  return json.replace(/<\/script/gi, '<\\/script');
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  } catch {
    return ts;
  }
}

/**
 * Shorten ID for display
 */
function shortenId(id: string, length: number = 8): string {
  return id.slice(0, length);
}

/**
 * Get CSS styles for HTML reports (single column for RPC)
 */
function getRpcReportStyles(): string {
  return `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-blue: #58a6ff;
      --status-ok: #3fb950;
      --status-err: #f85149;
      --status-pending: #d29922;
      --border-color: #30363d;
      --link-color: #58a6ff;
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 20px;
      line-height: 1.5;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 1.5em;
      font-weight: 600;
    }
    h2 {
      margin: 0 0 12px 0;
      font-size: 1.1em;
      font-weight: 600;
      color: var(--text-primary);
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
    }
    h3 {
      margin: 16px 0 8px 0;
      font-size: 0.95em;
      font-weight: 600;
      color: var(--text-secondary);
    }
    h3:first-child { margin-top: 0; }
    a { color: var(--link-color); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--text-secondary); margin: 0 0 20px 0; font-size: 0.85em; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid var(--accent-blue);
      border-radius: 4px;
      color: var(--accent-blue);
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.85em;
      background: transparent;
    }
    .badge.status-OK { border-color: var(--status-ok); color: var(--status-ok); }
    .badge.status-ERR { border-color: var(--status-err); color: var(--status-err); }
    .badge.status-PENDING { border-color: var(--status-pending); color: var(--status-pending); }
    .section {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 16px;
      margin: 0;
    }
    dt { color: var(--text-secondary); }
    dd { margin: 0; }
    pre {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 0.85em;
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      color: var(--text-primary);
    }
    .copy-btn {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8em;
      margin-left: 8px;
    }
    .copy-btn:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }
    .truncated-note {
      color: var(--status-pending);
      font-size: 0.85em;
      margin: 4px 0;
    }
    .spill-link {
      color: var(--link-color);
      font-size: 0.85em;
    }
  `;
}

/**
 * Get CSS styles for Session HTML (2-pane Wireshark layout)
 */
function getSessionReportStyles(): string {
  return `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-blue: #58a6ff;
      --status-ok: #3fb950;
      --status-err: #f85149;
      --status-pending: #d29922;
      --border-color: #30363d;
      --link-color: #58a6ff;
      --left-pane-width: 420px;
    }
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }
    h1 {
      margin: 0 0 4px 0;
      font-size: 1.3em;
      font-weight: 600;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 1em;
      font-weight: 600;
      color: var(--text-primary);
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 6px;
    }
    h3 {
      margin: 12px 0 6px 0;
      font-size: 0.9em;
      font-weight: 600;
      color: var(--text-secondary);
    }
    h3:first-child { margin-top: 0; }
    a { color: var(--link-color); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--text-secondary); margin: 0; font-size: 0.8em; }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      border: 1px solid var(--accent-blue);
      border-radius: 4px;
      color: var(--accent-blue);
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.8em;
      background: transparent;
    }
    .badge.status-OK { border-color: var(--status-ok); color: var(--status-ok); }
    .badge.status-ERR { border-color: var(--status-err); color: var(--status-err); }
    .badge.status-PENDING { border-color: var(--status-pending); color: var(--status-pending); }
    /* Two-pane layout */
    .container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .left-pane {
      width: var(--left-pane-width);
      min-width: 300px;
      max-width: 600px;
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .right-pane {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .session-info {
      background: var(--bg-secondary);
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }
    .session-info dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      margin: 0;
      font-size: 0.85em;
    }
    .session-info dt { color: var(--text-secondary); }
    .session-info dd { margin: 0; }
    .rpc-list {
      flex: 1;
      overflow-y: auto;
    }
    .rpc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85em;
    }
    .rpc-table th {
      text-align: left;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 6px 8px;
      font-weight: 500;
      position: sticky;
      top: 0;
      background: var(--bg-primary);
      z-index: 1;
    }
    .rpc-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }
    .rpc-row {
      cursor: pointer;
    }
    .rpc-row:hover {
      background: rgba(63, 185, 80, 0.1);
    }
    .rpc-row.selected {
      background: rgba(63, 185, 80, 0.2);
    }
    /* Right pane detail */
    .detail-placeholder {
      color: var(--text-secondary);
      text-align: center;
      padding: 40px;
    }
    .detail-section {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    pre {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 0.85em;
      max-height: 400px;
      overflow-y: auto;
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      color: var(--text-primary);
    }
    .copy-btn {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75em;
      margin-left: 8px;
    }
    .copy-btn:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }
    .truncated-note {
      color: var(--status-pending);
      font-size: 0.8em;
      margin: 4px 0;
    }
    .spill-link {
      color: var(--link-color);
      font-size: 0.8em;
    }
    /* Resize handle */
    .resize-handle {
      width: 4px;
      background: var(--border-color);
      cursor: col-resize;
      transition: background 0.2s;
    }
    .resize-handle:hover {
      background: var(--accent-blue);
    }
  `;
}

/**
 * Get JavaScript for RPC report (copy button only)
 */
function getRpcReportScript(): string {
  return `
    // Copy button functionality
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-target');
        const target = document.getElementById(targetId);
        if (target) {
          try {
            await navigator.clipboard.writeText(target.textContent || '');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = originalText; }, 1500);
          } catch (err) {
            console.error('Copy failed:', err);
          }
        }
      });
    });
  `;
}

/**
 * Get JavaScript for Session report (2-pane with selection)
 */
function getSessionReportScript(): string {
  return `
    // Report data
    const reportData = JSON.parse(document.getElementById('report-data').textContent);
    const rpcs = reportData.rpcs;
    let selectedIdx = null;

    // Format JSON for display
    function formatJson(data) {
      if (data === null || data === undefined) return '(no data)';
      try {
        return JSON.stringify(data, null, 2);
      } catch {
        return String(data);
      }
    }

    // Escape HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Format bytes
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Render payload section
    function renderPayload(title, payload, elementId) {
      let content, notes = '';

      if (payload.truncated) {
        notes = '<p class="truncated-note">Payload truncated (' + formatBytes(payload.size) + ', showing first 4096 chars)</p>';
        if (payload.spillFile) {
          notes += '<p class="spill-link">Full payload: <a href="' + escapeHtml(payload.spillFile) + '">' + escapeHtml(payload.spillFile) + '</a></p>';
        }
        content = payload.preview ? escapeHtml(payload.preview) + '\\n... (truncated)' : '(no data)';
      } else if (payload.json !== null) {
        content = escapeHtml(formatJson(payload.json));
      } else {
        content = '(no data)';
      }

      return '<h3>' + title + ' <button class="copy-btn" onclick="copyToClipboard(\\'' + elementId + '\\', this)">Copy</button></h3>' +
             notes +
             '<pre id="' + elementId + '"><code>' + content + '</code></pre>';
    }

    // Show RPC detail in right pane
    function showRpcDetail(idx) {
      if (idx < 0 || idx >= rpcs.length) return;

      const rpc = rpcs[idx];
      const rightPane = document.getElementById('right-pane');

      // Update selection state
      document.querySelectorAll('.rpc-row').forEach((r, i) => {
        r.classList.toggle('selected', i === idx);
      });
      selectedIdx = idx;

      const statusClass = 'status-' + rpc.status;
      const statusSymbol = rpc.status === 'OK' ? '✓' : rpc.status === 'ERR' ? '✗' : '?';
      const latency = rpc.latency_ms !== null ? rpc.latency_ms + 'ms' : '(pending)';

      rightPane.innerHTML =
        '<div class="detail-section">' +
        '  <h2>RPC Info</h2>' +
        '  <dl>' +
        '    <dt>RPC ID</dt><dd><span class="badge">' + escapeHtml(rpc.rpc_id) + '</span></dd>' +
        '    <dt>Method</dt><dd><span class="badge">' + escapeHtml(rpc.method) + '</span></dd>' +
        '    <dt>Status</dt><dd><span class="badge ' + statusClass + '">' + statusSymbol + ' ' + rpc.status + (rpc.error_code !== null ? ' (code: ' + rpc.error_code + ')' : '') + '</span></dd>' +
        '    <dt>Latency</dt><dd><span class="badge">' + latency + '</span></dd>' +
        '    <dt>Request Size</dt><dd>' + formatBytes(rpc.request.size) + '</dd>' +
        '    <dt>Response Size</dt><dd>' + formatBytes(rpc.response.size) + '</dd>' +
        '  </dl>' +
        '</div>' +
        '<div class="detail-section">' +
        '  <h2>Request</h2>' +
        '  ' + renderPayload('', rpc.request, 'req-' + idx).replace('<h3> ', '').replace('</h3>', '') +
        '</div>' +
        '<div class="detail-section">' +
        '  <h2>Response</h2>' +
        '  ' + renderPayload('', rpc.response, 'res-' + idx).replace('<h3> ', '').replace('</h3>', '') +
        '</div>';
    }

    // Copy to clipboard
    async function copyToClipboard(elementId, btn) {
      const target = document.getElementById(elementId);
      if (target) {
        try {
          await navigator.clipboard.writeText(target.textContent || '');
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = originalText; }, 1500);
        } catch (err) {
          console.error('Copy failed:', err);
        }
      }
    }

    // RPC row click handlers
    document.querySelectorAll('.rpc-row').forEach((row, idx) => {
      row.addEventListener('click', () => showRpcDetail(idx));
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (selectedIdx === null) return;
      if (e.key === 'ArrowDown' && selectedIdx < rpcs.length - 1) {
        e.preventDefault();
        showRpcDetail(selectedIdx + 1);
        // Scroll selected row into view
        const row = document.querySelector('.rpc-row.selected');
        if (row) row.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp' && selectedIdx > 0) {
        e.preventDefault();
        showRpcDetail(selectedIdx - 1);
        const row = document.querySelector('.rpc-row.selected');
        if (row) row.scrollIntoView({ block: 'nearest' });
      }
    });

    // Resize handle drag
    const resizeHandle = document.querySelector('.resize-handle');
    const leftPane = document.querySelector('.left-pane');
    if (resizeHandle && leftPane) {
      let startX, startWidth;

      resizeHandle.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startWidth = leftPane.offsetWidth;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      });

      function onMouseMove(e) {
        const diff = e.clientX - startX;
        const newWidth = Math.max(300, Math.min(600, startWidth + diff));
        leftPane.style.width = newWidth + 'px';
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    }

    // Select first RPC by default if any exist
    if (rpcs.length > 0) {
      showRpcDetail(0);
    }
  `;
}

/**
 * Render payload section (request or response)
 */
function renderPayloadSection(
  title: string,
  payload: PayloadData,
  elementId: string
): string {
  const copyBtn = `<button class="copy-btn" data-target="${elementId}">Copy</button>`;

  let content: string;
  let notes = '';

  if (payload.truncated) {
    notes = `<p class="truncated-note">Payload truncated (${formatBytes(payload.size)}, showing first 4096 chars)</p>`;
    if (payload.spillFile) {
      notes += `<p class="spill-link">Full payload: <a href="${escapeHtml(payload.spillFile)}">${escapeHtml(payload.spillFile)}</a></p>`;
    }
    content = payload.preview ? escapeHtml(payload.preview) + '\n... (truncated)' : '(no data)';
  } else if (payload.json !== null) {
    try {
      content = escapeHtml(JSON.stringify(payload.json, null, 2));
    } catch {
      content = '(invalid JSON)';
    }
  } else {
    content = '(no data)';
  }

  return `
    <h3>${title} ${copyBtn}</h3>
    ${notes}
    <pre id="${elementId}"><code>${content}</code></pre>
  `;
}

/**
 * Generate RPC HTML report
 */
export function generateRpcHtml(report: HtmlRpcReportV1): string {
  const { meta, rpc } = report;
  const sessionShort = shortenId(rpc.session_id, 12);
  const statusClass = `status-${rpc.status}`;

  const embeddedJson = escapeJsonForScript(JSON.stringify(report));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RPC: ${escapeHtml(rpc.method)} - proofscan</title>
  <style>${getRpcReportStyles()}</style>
</head>
<body>
  <header>
    <h1>RPC: <span class="badge">${escapeHtml(rpc.method)}</span></h1>
    <p class="meta">Generated by ${escapeHtml(meta.generatedBy)} at ${formatTimestamp(meta.generatedAt)}${meta.redacted ? ' (redacted)' : ''}</p>
  </header>

  <main>
    <section class="section">
      <h2>Info</h2>
      <dl>
        <dt>RPC ID</dt>
        <dd><span class="badge">${escapeHtml(rpc.rpc_id)}</span></dd>
        <dt>Session</dt>
        <dd><span class="badge">${escapeHtml(sessionShort)}...</span></dd>
        <dt>Connector</dt>
        <dd><span class="badge">${escapeHtml(rpc.connector_id)}</span></dd>
        <dt>Status</dt>
        <dd><span class="badge ${statusClass}">${rpc.status}${rpc.error_code !== null ? ` (code: ${rpc.error_code})` : ''}</span></dd>
      </dl>
    </section>

    <section class="section">
      <h2>Timing</h2>
      <dl>
        <dt>Request</dt>
        <dd>${formatTimestamp(rpc.request_ts)}</dd>
        <dt>Response</dt>
        <dd>${rpc.response_ts ? formatTimestamp(rpc.response_ts) : '(pending)'}</dd>
        <dt>Latency</dt>
        <dd>${rpc.latency_ms !== null ? `<span class="badge">${rpc.latency_ms}ms</span>` : '(pending)'}</dd>
      </dl>
    </section>

    <section class="section">
      <h2>Size</h2>
      <dl>
        <dt>Request</dt>
        <dd>${formatBytes(rpc.request.size)}</dd>
        <dt>Response</dt>
        <dd>${formatBytes(rpc.response.size)}</dd>
      </dl>
    </section>

    <section class="section">
      <h2>Request</h2>
      ${renderPayloadSection('', rpc.request, 'request-json').replace('<h3>', '').replace('</h3>', '')}
    </section>

    <section class="section">
      <h2>Response</h2>
      ${renderPayloadSection('', rpc.response, 'response-json').replace('<h3>', '').replace('</h3>', '')}
    </section>
  </main>

  <script type="application/json" id="report-data">${embeddedJson}</script>
  <script>${getRpcReportScript()}</script>
</body>
</html>`;
}

/**
 * Render a single RPC row for Session HTML (left pane table)
 */
function renderRpcRow(rpc: SessionRpcDetail, idx: number): string {
  const statusClass = `status-${rpc.status}`;
  const statusSymbol = getStatusSymbol(rpc.status);
  const rpcIdShort = shortenId(rpc.rpc_id);
  // Shorter time format for left pane (HH:MM:SS.mmm)
  const timeShort = formatTimestamp(rpc.request_ts).split(' ')[1]?.slice(0, 12) || '-';
  const latency = rpc.latency_ms !== null ? `${rpc.latency_ms}ms` : '-';

  return `
      <tr class="rpc-row">
        <td>${timeShort}</td>
        <td><span class="badge ${statusClass}">${statusSymbol}</span></td>
        <td><span class="badge">${escapeHtml(rpcIdShort)}</span></td>
        <td>${escapeHtml(rpc.method)}</td>
        <td>${latency}</td>
      </tr>`;
}

/**
 * Generate Session HTML report (2-pane Wireshark-style layout)
 */
export function generateSessionHtml(report: HtmlSessionReportV1): string {
  const { meta, session, rpcs } = report;
  const sessionShort = shortenId(session.session_id, 12);

  const rpcRows = rpcs.map((rpc, idx) => renderRpcRow(rpc, idx)).join('\n');
  const embeddedJson = escapeJsonForScript(JSON.stringify(report));

  // Format total latency
  const totalLatencyDisplay = session.total_latency_ms !== null
    ? `${session.total_latency_ms}ms`
    : '-';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session: ${escapeHtml(sessionShort)}... - proofscan</title>
  <style>${getSessionReportStyles()}</style>
</head>
<body>
  <header>
    <h1>Session: <span class="badge">${escapeHtml(sessionShort)}...</span></h1>
    <p class="meta">Generated by ${escapeHtml(meta.generatedBy)} at ${formatTimestamp(meta.generatedAt)}${meta.redacted ? ' (redacted)' : ''}</p>
  </header>

  <div class="container">
    <div class="left-pane">
      <div class="session-info">
        <h2>Session Info</h2>
        <dl>
          <dt>Session ID</dt>
          <dd><span class="badge">${escapeHtml(session.session_id)}</span></dd>
          <dt>Connector</dt>
          <dd><span class="badge">${escapeHtml(session.connector_id)}</span></dd>
          <dt>Started</dt>
          <dd>${formatTimestamp(session.started_at)}</dd>
          <dt>Ended</dt>
          <dd>${session.ended_at ? formatTimestamp(session.ended_at) : '(active)'}</dd>
          <dt>RPC Count</dt>
          <dd><span class="badge">${session.rpc_count}</span></dd>
          <dt>Event Count</dt>
          <dd><span class="badge">${session.event_count}</span></dd>
          <dt>Total Latency</dt>
          <dd><span class="badge">${totalLatencyDisplay}</span></dd>
        </dl>
      </div>
      <div class="rpc-list">
        <table class="rpc-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>St</th>
              <th>ID</th>
              <th>Method</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
${rpcRows}
          </tbody>
        </table>
      </div>
    </div>
    <div class="resize-handle"></div>
    <div class="right-pane" id="right-pane">
      <div class="detail-placeholder">
        ${rpcs.length > 0 ? 'Select an RPC call from the list to view details' : 'No RPC calls in this session'}
      </div>
    </div>
  </div>

  <script type="application/json" id="report-data">${embeddedJson}</script>
  <script>${getSessionReportScript()}</script>
</body>
</html>`;
}
