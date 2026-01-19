/**
 * HTML Templates (Phase 5.0)
 *
 * Generates standalone HTML files for RPC and Session reports.
 * Dark theme with neon blue accent badges.
 */

import { formatBytes } from '../eventline/types.js';
import type {
  HtmlConnectorAnalyticsV1,
  HtmlConnectorKpis,
  HtmlConnectorReportV1,
  HtmlConnectorSessionRow,
  HtmlHeatmapData,
  HtmlLatencyHistogram,
  HtmlMethodDistribution,
  HtmlMethodLatencyData,
  HtmlRpcReportV1,
  HtmlSessionReportV1,
  HtmlTopToolsData,
  PayloadData,
  RpcStatus,
  SessionRpcDetail,
} from './types.js';
import { getStatusSymbol, SHORT_ID_LENGTH } from './types.js';
import {
  getRpcInspectorStyles,
  getRpcInspectorScript,
  renderJsonWithPaths,
  renderRequestSummary,
  renderResponseSummary,
  renderSummaryRowsHtml,
  detectSensitiveKeys,
} from './rpc-inspector.js';

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
 * Also escape U+2028/U+2029 which are valid in JSON but break JS string literals
 */
export function escapeJsonForScript(json: string): string {
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\u2028/g, '\\u2028')  // Line Separator - valid JSON but breaks JS
    .replace(/\u2029/g, '\\u2029'); // Paragraph Separator - valid JSON but breaks JS
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
      --accent-blue: #00d4ff;
      --status-ok: #00d4ff;
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
    /* Sensitive content warning badge (Phase 12.x-c) */
    .sensitive-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin-left: 8px;
      background: rgba(210, 153, 34, 0.15);
      border: 1px solid rgba(210, 153, 34, 0.3);
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      color: #d29922;
      vertical-align: middle;
    }
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
      --accent-blue: #00d4ff;
      --status-ok: #00d4ff;
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
    /* Sensitive content warning badge (Phase 12.x-c) */
    .sensitive-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin-left: 8px;
      background: rgba(210, 153, 34, 0.15);
      border: 1px solid rgba(210, 153, 34, 0.3);
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      color: #d29922;
      vertical-align: middle;
    }
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
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 16px;
      min-height: 0;
    }
    .right-pane > .rpc-inspector {
      flex: 1;
      min-height: 0;
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
      background: rgba(0, 212, 255, 0.1);
    }
    .rpc-row.selected {
      background: rgba(0, 212, 255, 0.2);
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
    /* RPC Inspector styles */
    ${getRpcInspectorStyles()}
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

    // Show RPC detail in right pane (2-column Wireshark-style layout)
    // Summary and Raw JSON now both toggle with Req/Res buttons
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

      // Get pre-rendered summary and raw JSON (separate request/response)
      const requestSummaryHtml = rpc._requestSummaryHtml || '<div class="summary-row summary-header">No summary available</div>';
      const responseSummaryHtml = rpc._responseSummaryHtml || '<div class="summary-row summary-header">No summary available</div>';
      const requestRawHtml = rpc._requestRawHtml || '<span class="json-null">(no data)</span>';
      const responseRawHtml = rpc._responseRawHtml || '<span class="json-null">(no data)</span>';

      // Sensitive content warning badge (Phase 12.x-c)
      // Escape keys to prevent XSS via malicious key names
      const sensitiveKeys = (rpc._sensitiveKeys || []).map(function(k) { return escapeHtml(k); });
      const sensitiveTooltip = sensitiveKeys.length > 5
        ? 'Contains ' + sensitiveKeys.length + ' sensitive keys: ' + sensitiveKeys.slice(0, 5).join(', ') + '...'
        : 'Contains sensitive keys: ' + sensitiveKeys.join(', ');
      const sensitiveBadge = rpc._hasSensitive
        ? '<span class="sensitive-badge" title="' + escapeHtml(sensitiveTooltip) + '">⚠ Sensitive</span>'
        : '';

      // Determine default target based on method (response-focused methods default to response)
      const defaultTarget = (rpc.method === 'tools/list' || rpc.method === 'initialize' || rpc.method.startsWith('resources/') || rpc.method.startsWith('prompts/')) ? 'response' : 'request';

      rightPane.innerHTML =
        '<div class="detail-section">' +
        '  <h2>RPC Info' + sensitiveBadge + '</h2>' +
        '  <div class="rpc-info-grid">' +
        '    <div class="rpc-info-item"><dt>RPC ID</dt><dd><span class="badge">' + escapeHtml(rpc.rpc_id) + '</span></dd></div>' +
        '    <div class="rpc-info-item"><dt>Method</dt><dd><span class="badge">' + escapeHtml(rpc.method) + '</span></dd></div>' +
        '    <div class="rpc-info-item"><dt>Status</dt><dd><span class="badge ' + statusClass + '">' + statusSymbol + ' ' + rpc.status + (rpc.error_code !== null ? ' (code: ' + rpc.error_code + ')' : '') + '</span></dd></div>' +
        '    <div class="rpc-info-item"><dt>Latency</dt><dd><span class="badge">' + latency + '</span></dd></div>' +
        '    <div class="rpc-info-item"><dt>Request</dt><dd>' + escapeHtml(rpc.request_ts) + '</dd></div>' +
        '    <div class="rpc-info-item"><dt>Response</dt><dd>' + escapeHtml(rpc.response_ts || '-') + '</dd></div>' +
        '  </div>' +
        '</div>' +
        '<div class="detail-section">' +
        '  <div class="rpc-toggle-bar">' +
        '    <button id="toggle-req" class="rpc-toggle-btn' + (defaultTarget === 'request' ? ' active' : '') + '">[Req]</button>' +
        '    <button id="toggle-res" class="rpc-toggle-btn' + (defaultTarget === 'response' ? ' active' : '') + '">[Res]</button>' +
        '  </div>' +
        '  <div class="rpc-inspector">' +
        '    <div class="rpc-inspector-summary">' +
        '      <h3>Summary</h3>' +
        '      <div id="summary-request" style="display:' + (defaultTarget === 'request' ? 'block' : 'none') + '">' + requestSummaryHtml + '</div>' +
        '      <div id="summary-response" style="display:' + (defaultTarget === 'response' ? 'block' : 'none') + '">' + responseSummaryHtml + '</div>' +
        '    </div>' +
        '    <div class="rpc-inspector-raw">' +
        '      <div class="rpc-raw-json">' +
        '        <div id="raw-json-request" style="display:' + (defaultTarget === 'request' ? 'block' : 'none') + '">' + requestRawHtml + '</div>' +
        '        <div id="raw-json-response" style="display:' + (defaultTarget === 'response' ? 'block' : 'none') + '">' + responseRawHtml + '</div>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>';

      // Re-initialize RPC Inspector handlers
      if (window.initRpcInspector) {
        window.initRpcInspector();
      }
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

    // RPC Inspector script
    ${getRpcInspectorScript()}
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

  // Pre-render summary and raw JSON HTML for each RPC (for RPC Inspector)
  // Now generates separate request/response summaries for Req/Res toggle
  // Also detect sensitive content for warning badge (Phase 12.x-c)
  const rpcsWithInspectorHtml = rpcs.map((rpc) => {
    const requestSummaryRows = renderRequestSummary(rpc.method, rpc.request.json);
    const responseSummaryRows = renderResponseSummary(rpc.method, rpc.response.json);
    // Detect sensitive keys in request/response
    const reqSensitiveKeys = detectSensitiveKeys(rpc.request.json);
    const resSensitiveKeys = detectSensitiveKeys(rpc.response.json);
    const hasSensitive = reqSensitiveKeys.length > 0 || resSensitiveKeys.length > 0;
    return {
      ...rpc,
      _requestSummaryHtml: renderSummaryRowsHtml(requestSummaryRows),
      _responseSummaryHtml: renderSummaryRowsHtml(responseSummaryRows),
      _requestRawHtml: renderJsonWithPaths(rpc.request.json, '#'),
      _responseRawHtml: renderJsonWithPaths(rpc.response.json, '#'),
      _hasSensitive: hasSensitive,
      _sensitiveKeys: [...reqSensitiveKeys, ...resSensitiveKeys],
    };
  });

  const reportWithInspectorHtml = {
    ...report,
    rpcs: rpcsWithInspectorHtml,
  };
  const embeddedJson = escapeJsonForScript(JSON.stringify(reportWithInspectorHtml));

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

// ============================================================================
// Connector HTML Report (Phase 5.1)
// ============================================================================

/**
 * Get CSS styles for Connector HTML (3-hierarchy: Connector -> Sessions -> RPCs)
 */
function getConnectorReportStyles(): string {
  return `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-blue: #00d4ff;
      --status-ok: #3fb950;
      --status-err: #f85149;
      --status-pending: #d29922;
      --border-color: #30363d;
      --link-color: #58a6ff;
      --sessions-pane-width: 360px;
      --left-pane-width: 480px;
      --raw-pane-max-width: 480px;
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
    /* Unified header (matches Home/Ledger/Artifact pages) */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .header-back {
      color: var(--accent-blue);
      font-size: 13px;
      text-decoration: none;
    }
    .header-back:hover {
      text-decoration: underline;
    }
    .header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .offline-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .offline-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #6e7681;
      border-radius: 50%;
    }
    /* Auto-check toggle (Phase 12.1) */
    .auto-check-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 2px 4px;
    }
    .auto-check-toggle .auto-check-label {
      font-size: 10px;
      color: var(--text-secondary);
      padding-left: 4px;
    }
    .auto-check-toggle button {
      background: transparent;
      border: none;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }
    .auto-check-toggle button:hover {
      color: var(--text-primary);
    }
    .auto-check-toggle button.active {
      background: rgba(0, 212, 255, 0.15);
      color: var(--accent-blue);
    }
    /* New data banner */
    .new-data-banner {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid var(--accent-blue);
      border-radius: 12px;
      font-size: 11px;
      color: var(--accent-blue);
    }
    .new-data-banner.active { display: inline-flex; }
    .new-data-banner button {
      background: var(--accent-blue);
      border: none;
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 10px;
      color: var(--bg-primary);
      cursor: pointer;
    }
    /* Page header (Connector name + KPI row) */
    .page-header {
      padding: 8px 20px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 {
      margin: 0;
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
    .badge.cap-enabled { border-color: var(--accent-blue); color: var(--accent-blue); background: rgba(0, 212, 255, 0.1); }
    .badge.cap-disabled { border-color: var(--border-color); color: var(--text-secondary); background: transparent; opacity: 0.5; }
    /* Sensitive content warning badge (Phase 12.x-c) */
    .sensitive-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin-left: 8px;
      background: rgba(210, 153, 34, 0.15);
      border: 1px solid rgba(210, 153, 34, 0.3);
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      color: #d29922;
      vertical-align: middle;
    }

    /* Connector info cards container (side by side) */
    .connector-info-cards {
      display: flex;
      gap: 0;
    }
    .connector-info-cards > .connector-info {
      flex: 1;
      border-right: 1px solid var(--border-color);
    }
    .connector-info-cards > .connector-info:last-child {
      border-right: none;
      padding-left: 24px;
    }

    /* Connector info section (collapsible) */
    .connector-info {
      background: var(--bg-secondary);
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }
    .connector-info-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }
    .connector-info-toggle h2 {
      margin: 0;
      border: none;
      padding: 0;
    }
    .connector-info-toggle .toggle-icon {
      color: var(--text-secondary);
      font-size: 0.85em;
      transition: transform 0.2s;
    }
    .connector-info-content {
      display: none;
      margin-top: 12px;
    }
    .connector-info.expanded .connector-info-content {
      display: block;
    }
    .connector-info.expanded .toggle-icon {
      transform: rotate(180deg);
    }
    .connector-info dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 16px;
      margin: 0;
      font-size: 0.85em;
    }
    .connector-info dt { color: var(--text-secondary); }
    .connector-info dd { margin: 0; }
    .capabilities {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Main 3-pane container */
    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* Sessions pane (leftmost) */
    .sessions-pane {
      width: var(--sessions-pane-width);
      flex-shrink: 0;
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-secondary);
    }
    .sessions-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-tertiary);
      flex-shrink: 0;
    }
    .sessions-header h2 {
      margin: 0;
      border: none;
      padding: 0;
      font-size: 0.9em;
    }
    .sessions-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 8px;
    }
    .sessions-header-row {
      display: grid;
      grid-template-columns: 70px 1fr 60px 50px;
      gap: 8px;
      padding: 4px 8px;
      font-size: 10px;
      color: var(--text-secondary);
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 4px;
    }
    .session-item {
      display: grid;
      grid-template-columns: 70px 1fr auto 50px 50px;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 2px;
      border: 1px solid transparent;
      background: var(--bg-primary);
      font-size: 11px;
    }
    .session-item .session-counts {
      display: flex;
      gap: 6px;
      font-size: 10px;
      color: var(--text-secondary);
    }
    .session-item .session-counts span {
      white-space: nowrap;
    }
    .session-item .session-extra {
      justify-self: end;
    }
    .session-item:hover {
      background: rgba(0, 212, 255, 0.1);
      border-color: rgba(0, 212, 255, 0.3);
    }
    .session-item.selected {
      border-color: var(--accent-blue);
      background: rgba(0, 212, 255, 0.15);
    }
    .session-item.highlight {
      animation: highlightPulse 2s ease-out;
    }
    @keyframes highlightPulse {
      0% { box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.6); }
      100% { box-shadow: 0 0 0 0 rgba(0, 212, 255, 0); }
    }
    .session-item .session-id {
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: var(--accent-blue);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-item .session-timestamp {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-item .session-latency {
      color: var(--text-secondary);
      text-align: right;
    }

    /* Session detail pane (middle) */
    .session-detail-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
    .session-detail-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
    }

    /* Re-use session HTML styles for the detail view */
    .session-content {
      display: none;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .session-content.active {
      display: flex;
    }
    .inner-container {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
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
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 16px;
      min-height: 0;
    }
    .right-pane > .rpc-inspector {
      flex: 1;
      min-height: 0;
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
      background: rgba(0, 212, 255, 0.1);
    }
    .rpc-row.selected {
      background: rgba(0, 212, 255, 0.2);
    }
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
    .resize-handle {
      width: 4px;
      background: var(--border-color);
      cursor: col-resize;
      transition: background 0.2s;
    }
    .resize-handle:hover {
      background: var(--accent-blue);
    }

    /* Events View Toggle (Issue #59) */
    .view-toggle {
      display: flex;
      gap: 2px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }
    .view-toggle-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.15s;
    }
    .view-toggle-btn:first-child {
      border-radius: 4px 0 0 4px;
    }
    .view-toggle-btn:last-child {
      border-radius: 0 4px 4px 0;
    }
    .view-toggle-btn:hover {
      border-color: var(--accent-blue);
      color: var(--text-primary);
    }
    .view-toggle-btn.active {
      background: rgba(0, 212, 255, 0.15);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }
    .view-toggle-count {
      font-size: 10px;
      color: var(--text-secondary);
      margin-left: 4px;
    }

    /* Events List (Issue #59) */
    .events-list {
      flex: 1;
      overflow-y: auto;
      display: none;
    }
    .events-list.active {
      display: block;
    }
    .rpc-list.hidden {
      display: none;
    }
    .events-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85em;
    }
    .events-table th {
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
    .events-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }
    .event-row {
      cursor: pointer;
    }
    .event-row:hover {
      background: rgba(0, 212, 255, 0.1);
    }
    .event-row.selected {
      background: rgba(0, 212, 255, 0.2);
    }

    /* Event kind badges */
    .badge-kind-request {
      background: rgba(0, 212, 255, 0.15);
      color: var(--accent-blue);
      border: 1px solid rgba(0, 212, 255, 0.3);
    }
    .badge-kind-response {
      background: rgba(63, 185, 80, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(63, 185, 80, 0.3);
    }
    .badge-kind-notification {
      background: rgba(210, 153, 34, 0.15);
      color: var(--accent-yellow);
      border: 1px solid rgba(210, 153, 34, 0.3);
    }
    .badge-kind-transport_event {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
    }

    /* Event direction arrows */
    .direction-arrow {
      font-size: 18px;
      font-weight: bold;
      line-height: 1;
      cursor: help;
    }
    .direction-arrow.outgoing {
      color: var(--accent-blue);
    }
    .direction-arrow.incoming {
      color: var(--accent-green);
    }

    /* Events loading state */
    .events-loading {
      padding: 24px;
      text-align: center;
      color: var(--text-secondary);
    }

    /* Analytics Panel (Phase 5.2) - Revised Layout */

    /* Header with KPI stats inline */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .page-header-left {
      flex-shrink: 0;
    }
    /* Capability badges - active (blue) / inactive (gray) */
    .badge.cap-disabled {
      border-color: var(--border-color);
      color: var(--text-secondary);
      background: transparent;
      opacity: 0.5;
    }
    .kpi-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: baseline;
    }
    .kpi-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0;
      background: transparent;
      min-width: 50px;
    }
    .kpi-item .kpi-value {
      font-size: 0.95em;
      font-weight: 600;
      color: var(--accent-blue);
      font-family: 'SFMono-Regular', Consolas, monospace;
      line-height: 1.2;
    }
    .kpi-item .kpi-label {
      font-size: 0.55em;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    /* All KPI values use accent-blue for unified appearance */

    /* Connector top section: info + charts row */
    .connector-top {
      display: flex;
      gap: 16px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }
    .connector-top .connector-info {
      flex: 0 0 360px;
      max-width: 360px;
      border-bottom: none;
      padding: 0;
    }
    .analytics-panel {
      flex: 1;
      display: flex;
      gap: 12px;
      align-items: stretch;
    }

    /* Charts row - 4 items horizontal with custom flex ratios */
    .heatmap-container {
      flex: 0.8;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px;
      min-width: 0;
    }
    .latency-histogram {
      flex: 1.4;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px;
      min-width: 0;
    }
    .top-tools, .method-distribution {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px;
      min-width: 0;
    }
    .chart-title {
      font-size: 0.75em;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    /* Heatmap - using neon blue gradient for consistency with theme */
    .heatmap-title {
      font-size: 0.75em;
      color: var(--text-secondary);
      margin-bottom: 4px;
      line-height: 1.4;
    }
    .heatmap-range {
      font-size: 0.9em;
      opacity: 0.8;
    }
    .heatmap-level-0 { fill: var(--bg-tertiary); }
    .heatmap-level-1 { fill: #0a3d4d; }
    .heatmap-level-2 { fill: #0d5c73; }
    .heatmap-level-3 { fill: #0097b2; }
    .heatmap-level-4 { fill: #00d4ff; }

    /* Histogram / Method Latency Heatmap */
    .histogram-bar { fill: var(--accent-blue); }
    .histogram-label { fill: var(--text-secondary); font-size: 9px; }
    .latency-heatmap { font-size: 0.75em; }
    .latency-heatmap-header, .latency-heatmap-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 3px;
    }
    .latency-heatmap-header { color: var(--text-secondary); margin-bottom: 6px; }
    .latency-heatmap-method { width: 28px; flex-shrink: 0; text-align: right; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
    .latency-heatmap-cells { display: flex; gap: 1px; }
    .latency-heatmap-cell { width: 30px; height: 12px; border-radius: 2px; cursor: default; }
    .latency-heatmap-cell.heatmap-level-0 { background: #161b22; }
    .latency-heatmap-cell.heatmap-level-1 { background: #0e4429; }
    .latency-heatmap-cell.heatmap-level-2 { background: #006d32; }
    .latency-heatmap-cell.heatmap-level-3 { background: #0097b2; }
    .latency-heatmap-cell.heatmap-level-4 { background: #00d4ff; }
    .latency-heatmap-header-cell { width: 30px; font-size: 8px; text-align: center; color: var(--text-secondary); white-space: nowrap; }

    /* Top Tools */
    .top-tool-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
      font-size: 0.75em;
    }
    .top-tool-rank {
      color: var(--text-secondary);
      width: 14px;
      flex-shrink: 0;
    }
    .top-tool-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .top-tool-bar-container {
      width: 50px;
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .top-tool-bar {
      height: 100%;
      background: var(--accent-blue);
      border-radius: 3px;
    }
    .top-tool-pct {
      color: var(--text-secondary);
      width: 28px;
      text-align: right;
      flex-shrink: 0;
    }
    .no-data-message {
      color: var(--text-secondary);
      font-size: 0.75em;
      text-align: center;
      padding: 8px;
    }

    /* Method Distribution Donut Chart */
    .donut-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .donut-legend {
      flex: 1;
      font-size: 0.7em;
      min-width: 0;
    }
    .donut-legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
    }
    .donut-legend-color {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .donut-legend-label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .donut-legend-pct {
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    /* RPC Inspector styles */
    ${getRpcInspectorStyles()}
  `;
}

/**
 * Get JavaScript for Connector HTML (3-hierarchy navigation)
 */
function getConnectorReportScript(): string {
  return `
    // Auto-check functionality (Phase 12.1)
    (function() {
      // Only run on monitor pages (not static HTML export)
      if (!document.body.dataset.app || document.body.dataset.app !== 'monitor') {
        return;
      }

      let checkInterval = null;
      let lastDigest = null;
      let newDataDetected = false;
      const INTERVAL_MS = 10000;

      const toggle = document.getElementById('autoCheckToggle');
      const banner = document.getElementById('newDataBanner');
      const refreshBtn = document.getElementById('refreshNowBtn');
      if (!toggle) return;

      const buttons = toggle.querySelectorAll('button');
      const enabled = localStorage.getItem('proofscan-auto-check') === 'true';

      // Initial state
      buttons.forEach(function(btn) {
        btn.classList.toggle('active', (btn.dataset.enabled === 'true') === enabled);
      });
      if (enabled) startChecking();

      function startChecking() {
        checkForUpdates(); // First check
        checkInterval = setInterval(checkForUpdates, INTERVAL_MS);
      }

      function stopChecking() {
        if (checkInterval) clearInterval(checkInterval);
        checkInterval = null;
      }

      function checkForUpdates() {
        if (newDataDetected) return; // Banner already shown
        fetch('/api/monitor/summary')
          .then(function(res) { return res.ok ? res.json() : null; })
          .then(function(data) {
            if (!data) return;
            if (lastDigest === null) {
              lastDigest = data.digest; // Baseline
            } else if (data.digest !== lastDigest) {
              newDataDetected = true;
              if (banner) banner.classList.add('active');
            }
          })
          .catch(function(err) { console.debug('[Auto-check] Poll failed:', err); });
      }

      buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var on = btn.dataset.enabled === 'true';
          localStorage.setItem('proofscan-auto-check', String(on));
          buttons.forEach(function(b) {
            b.classList.toggle('active', (b.dataset.enabled === 'true') === on);
          });
          if (on) {
            startChecking();
          } else {
            stopChecking();
            if (banner) banner.classList.remove('active');
            newDataDetected = false;
          }
        });
      });

      if (refreshBtn) {
        refreshBtn.addEventListener('click', function() { location.reload(); });
      }
    })();

    // Report data
    const reportData = JSON.parse(document.getElementById('report-data').textContent);
    const sessions = reportData.sessions;
    const sessionReports = reportData.session_reports;

    let currentSessionId = null;
    let currentRpcIdx = null;
    let currentEventIdx = null;
    let currentViewMode = 'rpc'; // 'rpc' or 'events'

    // Connector info toggle
    const connectorInfo = document.querySelector('.connector-info');
    const connectorToggle = document.querySelector('.connector-info-toggle');
    if (connectorToggle) {
      connectorToggle.addEventListener('click', () => {
        connectorInfo.classList.toggle('expanded');
      });
    }

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

    // Show session detail
    function showSession(sessionId) {
      if (currentSessionId === sessionId) return;
      currentSessionId = sessionId;
      currentRpcIdx = null;
      currentEventIdx = null;
      currentViewMode = 'rpc'; // Reset to RPC view

      // Update session list selection
      document.querySelectorAll('.session-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.sessionId === sessionId);
      });

      // Hide all session contents, show selected
      document.querySelectorAll('.session-content').forEach(content => {
        content.classList.toggle('active', content.dataset.sessionId === sessionId);
      });

      // Select first RPC in the newly shown session
      const sessionContent = document.querySelector('.session-content[data-session-id="' + sessionId + '"]');
      if (sessionContent) {
        const firstRpcRow = sessionContent.querySelector('.rpc-row');
        if (firstRpcRow) {
          const idx = parseInt(firstRpcRow.dataset.rpcIdx);
          showRpcDetail(sessionId, idx);
        }
      }
    }

    // Show RPC detail in right pane using pre-rendered HTML
    // This approach avoids JavaScript string concatenation issues with special characters
    function showRpcDetail(sessionId, idx) {
      const report = sessionReports[sessionId];
      if (!report || idx < 0 || idx >= report.rpcs.length) return;

      const sessionContent = document.querySelector('.session-content[data-session-id="' + sessionId + '"]');
      if (!sessionContent) return;

      const rightPane = sessionContent.querySelector('.right-pane');
      if (!rightPane) return;

      // Update RPC row selection
      sessionContent.querySelectorAll('.rpc-row').forEach((r, i) => {
        r.classList.toggle('selected', i === idx);
      });
      currentRpcIdx = idx;

      // Hide placeholder, show details container
      const placeholder = rightPane.querySelector('.detail-placeholder');
      const detailsContainer = rightPane.querySelector('.rpc-details-container');
      if (placeholder) placeholder.style.display = 'none';
      if (detailsContainer) detailsContainer.style.display = 'block';

      // Hide all RPC detail divs, show selected one
      const allDetails = rightPane.querySelectorAll('.rpc-detail-content');
      allDetails.forEach(function(detail) {
        detail.style.display = detail.dataset.rpcIdx === String(idx) ? 'block' : 'none';
      });

      // Re-initialize RPC Inspector handlers for the visible detail
      if (window.initRpcInspector) {
        window.initRpcInspector();
      }
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

    // Session item click handlers
    document.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', () => {
        showSession(item.dataset.sessionId);
      });
    });

    // RPC row click handlers (delegated)
    document.querySelectorAll('.session-content').forEach(content => {
      content.addEventListener('click', (e) => {
        const row = e.target.closest('.rpc-row');
        if (row) {
          const idx = parseInt(row.dataset.rpcIdx);
          showRpcDetail(content.dataset.sessionId, idx);
        }
      });
    });

    // Keyboard navigation (handles both RPC and Events views)
    document.addEventListener('keydown', (e) => {
      if (!currentSessionId) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

      e.preventDefault();
      const sessionContent = document.querySelector('.session-content[data-session-id="' + currentSessionId + '"]');
      if (!sessionContent) return;

      // Check which view is active
      if (currentViewMode === 'events') {
        // Events navigation
        const eventRows = sessionContent.querySelectorAll('.event-row');
        if (eventRows.length === 0) return;

        let newIdx = currentEventIdx;
        if (currentEventIdx === null) {
          newIdx = 0;
        } else if (e.key === 'ArrowDown' && currentEventIdx < eventRows.length - 1) {
          newIdx = currentEventIdx + 1;
        } else if (e.key === 'ArrowUp' && currentEventIdx > 0) {
          newIdx = currentEventIdx - 1;
        }

        if (newIdx !== currentEventIdx) {
          currentEventIdx = newIdx;
          // Update selection visually
          eventRows.forEach((r, i) => r.classList.toggle('selected', i === newIdx));
          // Scroll into view
          eventRows[newIdx].scrollIntoView({ block: 'nearest' });
          // Trigger click to show detail (if has payload)
          eventRows[newIdx].click();
        }
      } else {
        // RPC navigation
        const report = sessionReports[currentSessionId];
        if (!report) return;
        const rpcs = report.rpcs;
        if (rpcs.length === 0) return;

        if (currentRpcIdx === null && rpcs.length > 0) {
          showRpcDetail(currentSessionId, 0);
          return;
        }
        if (e.key === 'ArrowDown' && currentRpcIdx < rpcs.length - 1) {
          showRpcDetail(currentSessionId, currentRpcIdx + 1);
        } else if (e.key === 'ArrowUp' && currentRpcIdx > 0) {
          showRpcDetail(currentSessionId, currentRpcIdx - 1);
        }
        // Scroll selected row into view
        const row = sessionContent.querySelector('.rpc-row.selected');
        if (row) row.scrollIntoView({ block: 'nearest' });
      }
    });

    // Resize handle for inner left pane
    document.querySelectorAll('.session-content').forEach(content => {
      const resizeHandle = content.querySelector('.resize-handle');
      const leftPane = content.querySelector('.left-pane');
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
    });

    // Check for session parameter in URL
    function getSessionFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get('session');
    }

    // Scroll session item into view
    function scrollSessionIntoView(sessionId) {
      const sessionItem = document.querySelector('.session-item[data-session-id="' + sessionId + '"]');
      if (sessionItem) {
        sessionItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Add highlight effect
        sessionItem.classList.add('highlight');
        setTimeout(() => sessionItem.classList.remove('highlight'), 2000);
      }
    }

    // Select session from URL or first session by default
    const urlSession = getSessionFromUrl();
    if (urlSession) {
      // Try to find matching session (full or partial match)
      const matchingSession = sessions.find(s =>
        s.session_id === urlSession || s.session_id.startsWith(urlSession)
      );
      if (matchingSession) {
        showSession(matchingSession.session_id);
        // Scroll into view after a short delay to ensure DOM is ready
        setTimeout(() => scrollSessionIntoView(matchingSession.session_id), 100);
      } else if (sessions.length > 0) {
        showSession(sessions[0].session_id);
      }
    } else if (sessions.length > 0) {
      showSession(sessions[0].session_id);
    }

    // Events View toggle and data loading (Issue #59)
    (function() {
      // Cache for loaded events
      const eventsCache = {};

      // Event kind display labels
      const kindLabels = {
        request: 'REQ',
        response: 'RES',
        notification: 'NOTIF',
        transport_event: 'TRANS'
      };

      // Format time for events table
      function formatEventTime(ts) {
        try {
          const date = new Date(ts);
          return date.toISOString().split('T')[1].slice(0, 12);
        } catch {
          return ts;
        }
      }

      // Render events table
      function renderEventsTable(events) {
        if (!events || events.length === 0) {
          return '<div class="events-loading">No events in this session</div>';
        }

        const rows = events.map(function(event, idx) {
          const dirClass = event.direction === 'client_to_server' ? 'outgoing' : 'incoming';
          // Large arrows with tooltip: ⇨ (blue) = Client→Server, ⇦ (green) = Server→Client
          const dirArrow = event.direction === 'client_to_server' ? '\\u21E8' : '\\u21E6';
          const dirTooltip = event.direction === 'client_to_server'
            ? 'Client \\u2192 Server'
            : 'Server \\u2192 Client';
          const kindClass = 'badge-kind-' + event.kind;
          const kindLabel = kindLabels[event.kind] || event.kind;
          // Method/Summary fallback: method > summary > payload_type (e.g., "connected")
          const method = event.method || event.summary || event.payload_type || '';
          const timeStr = formatEventTime(event.ts);
          const hasPayload = event.has_payload ? '\\u2713' : '';

          return '<tr class="event-row" data-event-idx="' + idx + '" data-event-id="' + escapeHtml(event.event_id) + '">' +
            '<td>' + timeStr + '</td>' +
            '<td><span class="direction-arrow ' + dirClass + '" title="' + dirTooltip + '">' + dirArrow + '</span></td>' +
            '<td><span class="badge ' + kindClass + '">' + kindLabel + '</span></td>' +
            '<td>' + escapeHtml(method) + '</td>' +
            '<td>' + hasPayload + '</td>' +
            '</tr>';
        }).join('');

        return '<table class="events-table">' +
          '<thead><tr>' +
            '<th>Time</th>' +
            '<th>Dir</th>' +
            '<th>Kind</th>' +
            '<th>Method/Summary</th>' +
            '<th>Data</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      }

      // Load events for a session
      function loadEvents(sessionId, eventsList) {
        if (eventsCache[sessionId]) {
          eventsList.innerHTML = renderEventsTable(eventsCache[sessionId]);
          // Attach click handlers even when using cached data
          attachEventRowHandlers(eventsList, sessionId, eventsCache[sessionId]);
          return;
        }

        // Check if we're in offline mode (static HTML) or live server
        // Try to fetch from API, fallback to "no data" message
        eventsList.innerHTML = '<div class="events-loading">Loading events...</div>';

        fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/events')
          .then(function(res) {
            if (!res.ok) throw new Error('API not available');
            return res.json();
          })
          .then(function(data) {
            eventsCache[sessionId] = data.events;
            eventsList.innerHTML = renderEventsTable(data.events);
            // Attach click handlers for event rows
            attachEventRowHandlers(eventsList, sessionId, data.events);
          })
          .catch(function() {
            eventsList.innerHTML = '<div class="events-loading">Events data not available (API offline)</div>';
          });
      }

      // Attach click handlers for event rows
      function attachEventRowHandlers(eventsList, sessionId, events) {
        eventsList.querySelectorAll('.event-row').forEach(function(row) {
          row.addEventListener('click', function() {
            const idx = parseInt(row.dataset.eventIdx);
            const event = events[idx];
            if (!event || !event.has_payload) return;

            // Clear previous selection
            eventsList.querySelectorAll('.event-row').forEach(function(r) {
              r.classList.remove('selected');
            });
            row.classList.add('selected');

            // Show event detail in right pane
            showEventDetail(sessionId, event);
          });
        });
      }

      // Show event detail in right pane (2-column layout like RPC Inspector)
      function showEventDetail(sessionId, event) {
        const sessionContent = document.querySelector('.session-content[data-session-id="' + sessionId + '"]');
        if (!sessionContent) return;

        const rightPane = sessionContent.querySelector('.right-pane');
        if (!rightPane) return;

        // Fetch full event detail
        fetch('/api/events/' + encodeURIComponent(event.event_id))
          .then(function(res) {
            if (!res.ok) throw new Error('Event not found');
            return res.json();
          })
          .then(function(data) {
            const evt = data.event;
            const kindClass = 'badge-kind-' + evt.kind;
            const dirClass = evt.direction === 'client_to_server' ? 'outgoing' : 'incoming';
            // Large arrows with tooltip: ⇨ (blue) = Client→Server, ⇦ (green) = Server→Client
            const dirArrow = evt.direction === 'client_to_server' ? '\\u21E8' : '\\u21E6';
            const dirTooltip = evt.direction === 'client_to_server'
              ? 'Client \\u2192 Server'
              : 'Server \\u2192 Client';
            const method = evt.method || evt.summary || '(unknown)';
            const rawJson = evt.raw_json ? JSON.parse(evt.raw_json) : null;
            const formattedJson = rawJson ? JSON.stringify(rawJson, null, 2) : '(no data)';

            // Build summary section
            var summaryHtml = '<div class="summary-row summary-header">Event Info</div>';
            summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">Kind</span><span class="summary-prop-value"><span class="badge ' + kindClass + '">' + evt.kind + '</span></span></div>';
            summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">Direction</span><span class="summary-prop-value"><span class="direction-arrow ' + dirClass + '" title="' + dirTooltip + '">' + dirArrow + '</span> ' + dirTooltip + '</span></div>';
            summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">Method</span><span class="summary-prop-value">' + escapeHtml(method) + '</span></div>';
            summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">Timestamp</span><span class="summary-prop-value">' + escapeHtml(evt.ts) + '</span></div>';
            if (evt.seq !== null) {
              summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">Sequence</span><span class="summary-prop-value">' + evt.seq + '</span></div>';
            }

            // If JSON has recognizable structure, add more summary
            if (rawJson) {
              if (rawJson.method) {
                summaryHtml += '<div class="summary-row summary-header" style="margin-top: 12px;">JSON-RPC</div>';
                summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">method</span><span class="summary-prop-value">' + escapeHtml(rawJson.method) + '</span></div>';
              }
              if (rawJson.id !== undefined) {
                summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">id</span><span class="summary-prop-value">' + escapeHtml(String(rawJson.id)) + '</span></div>';
              }
              if (rawJson.error) {
                summaryHtml += '<div class="summary-row summary-property"><span class="summary-prop-name">error</span><span class="summary-prop-value" style="color: var(--accent-red);">' + escapeHtml(JSON.stringify(rawJson.error)) + '</span></div>';
              }
            }

            // 2-column layout: Summary (left) + Raw JSON (right)
            rightPane.innerHTML =
              '<div class="rpc-inspector">' +
                '<div class="rpc-inspector-summary">' +
                  '<div class="summary-container">' + summaryHtml + '</div>' +
                '</div>' +
                '<div class="rpc-inspector-raw">' +
                  '<div class="rpc-raw-header">' +
                    '<span class="rpc-raw-title">Payload</span>' +
                  '</div>' +
                  '<div class="rpc-raw-json"><pre><code>' + escapeHtml(formattedJson) + '</code></pre></div>' +
                '</div>' +
              '</div>';
          })
          .catch(function() {
            rightPane.innerHTML = '<div class="detail-placeholder">Failed to load event detail</div>';
          });
      }

      // Handle view toggle clicks
      document.querySelectorAll('.view-toggle').forEach(function(toggle) {
        const sessionContent = toggle.closest('.session-content');
        if (!sessionContent) return;

        const sessionId = sessionContent.dataset.sessionId;
        const rpcList = sessionContent.querySelector('.rpc-list');
        const eventsList = sessionContent.querySelector('.events-list');
        const buttons = toggle.querySelectorAll('.view-toggle-btn');

        buttons.forEach(function(btn) {
          btn.addEventListener('click', function() {
            const view = btn.dataset.view;

            // Update current view mode
            currentViewMode = view;

            // Update button states
            buttons.forEach(function(b) {
              b.classList.toggle('active', b.dataset.view === view);
            });

            // Toggle lists
            if (view === 'events') {
              rpcList.classList.add('hidden');
              eventsList.classList.add('active');
              loadEvents(sessionId, eventsList);
            } else {
              rpcList.classList.remove('hidden');
              eventsList.classList.remove('active');
              // Re-show selected RPC detail when switching back to RPCs view
              if (currentRpcIdx !== null && sessionId === currentSessionId) {
                showRpcDetail(sessionId, currentRpcIdx);
              }
            }
          });
        });
      });
    })();

    // RPC Inspector script
    ${getRpcInspectorScript()}
  `;
}

// ============================================================================
// Analytics Panel Rendering (Phase 5.2)
// ============================================================================

/**
 * Render KPI stats row for header (inline compact display)
 */
function renderKpiRow(kpis: HtmlConnectorKpis): string {
  // Format large numbers with K/M suffix
  const formatNumber = (n: number): string => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  };

  // Format bytes for display
  const formatBytesCompact = (bytes: number): string => {
    if (bytes === 0) return '0';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  };

  return `
    <div class="kpi-row">
      <div class="kpi-item">
        <div class="kpi-value">${formatNumber(kpis.sessions_displayed)}</div>
        <div class="kpi-label">Sessions</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${formatNumber(kpis.rpc_total)}</div>
        <div class="kpi-label">RPCs</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${formatNumber(kpis.rpc_err)}</div>
        <div class="kpi-label">Error</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${kpis.avg_latency_ms !== null ? kpis.avg_latency_ms : '-'}</div>
        <div class="kpi-label">Avg Latency</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${kpis.p95_latency_ms !== null ? kpis.p95_latency_ms : '-'}</div>
        <div class="kpi-label">P95 Latency</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${formatBytesCompact(kpis.total_request_bytes)}</div>
        <div class="kpi-label">Req Size</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-value">${formatBytesCompact(kpis.total_response_bytes)}</div>
        <div class="kpi-label">Res Size</div>
      </div>
    </div>`;
}

/**
 * Get intensity level (0-4) for heatmap cell based on count and max
 */
function getHeatmapLevel(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Render activity heatmap (GitHub contributions style, SVG)
 */
export function renderHeatmap(heatmap: HtmlHeatmapData): string {
  const cellSize = 10;
  const cellGap = 2;
  const cellTotal = cellSize + cellGap;

  // Group cells by week (7 days per column)
  const weeks: Array<typeof heatmap.cells> = [];
  let currentWeek: typeof heatmap.cells = [];

  // Find the day of week for the start date (0 = Sunday)
  const startDow = new Date(heatmap.start_date + 'T00:00:00Z').getUTCDay();

  // Add empty cells for days before start_date
  for (let i = 0; i < startDow; i++) {
    currentWeek.push({ date: '', count: -1 }); // -1 indicates empty
  }

  for (const cell of heatmap.cells) {
    currentWeek.push(cell);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Calculate SVG dimensions
  const svgWidth = weeks.length * cellTotal;
  const svgHeight = 7 * cellTotal;

  // Generate SVG rects
  let rects = '';
  weeks.forEach((week, weekIdx) => {
    week.forEach((cell, dayIdx) => {
      if (cell.count < 0) return; // Skip empty cells
      const level = getHeatmapLevel(cell.count, heatmap.max_count);
      const x = weekIdx * cellTotal;
      const y = dayIdx * cellTotal;
      const title = cell.date ? `${cell.date}: ${cell.count} RPCs` : '';
      rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" class="heatmap-level-${level}"><title>${escapeHtml(title)}</title></rect>`;
    });
  });

  return `
    <div class="heatmap-container">
      <div class="heatmap-title">Activity<br><span class="heatmap-range">${escapeHtml(heatmap.start_date)} to ${escapeHtml(heatmap.end_date)}</span></div>
      <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
        ${rects}
      </svg>
    </div>`;
}

/**
 * Render method-based latency heatmap (Activity-style)
 * Rows: method names
 * Columns: latency buckets (log scale)
 * Cell color: intensity based on count
 */
function renderMethodLatencyChart(methodLatency: HtmlMethodLatencyData): string {
  if (methodLatency.sample_size === 0 || methodLatency.methods.length === 0) {
    return `
      <div class="latency-histogram">
        <div class="chart-title">Latency by Method</div>
        <div class="no-data-message">No latency data</div>
      </div>`;
  }

  // Latency buckets (log scale thresholds)
  const buckets = [
    { label: '<10ms', max: 10 },
    { label: '<100ms', max: 100 },
    { label: '<1s', max: 1000 },
    { label: '<5s', max: 5000 },
    { label: '5s+', max: Infinity },
  ];

  // Group latencies into buckets for each method
  const methods = methodLatency.methods;

  // Find global max count for intensity scaling
  let globalMaxCount = 0;
  const methodBucketCounts: Map<string, number[]> = new Map();

  for (const method of methods) {
    const counts = buckets.map(() => 0);
    for (const latency of method.latencies) {
      for (let i = 0; i < buckets.length; i++) {
        if (i === 0 && latency < buckets[i].max) {
          counts[i]++;
          break;
        } else if (i > 0 && latency >= buckets[i - 1].max && latency < buckets[i].max) {
          counts[i]++;
          break;
        } else if (i === buckets.length - 1 && latency >= buckets[i - 1].max) {
          counts[i]++;
          break;
        }
      }
    }
    methodBucketCounts.set(method.method, counts);
    globalMaxCount = Math.max(globalMaxCount, ...counts);
  }

  // Get heatmap level (0-4)
  const getLevel = (count: number): number => {
    if (count === 0) return 0;
    if (globalMaxCount === 0) return 0;
    const ratio = count / globalMaxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  };

  // Build HTML rows
  let rows = '';
  for (const method of methods) {
    const shortName = shortenMethodName(method.method);
    const counts = methodBucketCounts.get(method.method) || [];

    let cells = '';
    for (let i = 0; i < buckets.length; i++) {
      const count = counts[i];
      const level = getLevel(count);
      const tooltip = `${method.method}\n${buckets[i].label}: ${count} calls`;
      cells += `<div class="latency-heatmap-cell heatmap-level-${level}" title="${escapeHtml(tooltip)}"></div>`;
    }

    rows += `
      <div class="latency-heatmap-row">
        <div class="latency-heatmap-method">${escapeHtml(shortName)}</div>
        <div class="latency-heatmap-cells">${cells}</div>
      </div>`;
  }

  // Header row with bucket labels
  let headerCells = '';
  for (const bucket of buckets) {
    headerCells += `<div class="latency-heatmap-header-cell">${bucket.label}</div>`;
  }

  return `
    <div class="latency-histogram">
      <div class="chart-title">Latency by Method (${methodLatency.sample_size} samples)</div>
      <div class="latency-heatmap">
        <div class="latency-heatmap-header">
          <div class="latency-heatmap-method"></div>
          <div class="latency-heatmap-cells">${headerCells}</div>
        </div>
        ${rows}
      </div>
    </div>`;
}

/**
 * Shorten method name for display (e.g., "tools/list" -> "list", "initialize" -> "init")
 */
function shortenMethodName(method: string): string {
  // Remove prefix
  if (method.startsWith('tools/')) {
    return method.slice(6);
  }
  if (method.startsWith('resources/')) {
    return 'r/' + method.slice(10);
  }
  if (method.startsWith('prompts/')) {
    return 'p/' + method.slice(8);
  }
  if (method === 'initialize') {
    return 'init';
  }
  if (method === 'notifications/initialized') {
    return 'n/init';
  }
  // Truncate if too long
  if (method.length > 6) {
    return method.slice(0, 5) + '…';
  }
  return method;
}

/**
 * Render top 5 tools
 */
function renderTopTools(topTools: HtmlTopToolsData): string {
  if (topTools.items.length === 0) {
    return `
      <div class="top-tools">
        <div class="chart-title">Top Tools</div>
        <div class="no-data-message">No tool calls</div>
      </div>`;
  }

  const rows = topTools.items
    .map((tool, idx) => {
      return `
      <div class="top-tool-row" data-tool-name="${escapeHtml(tool.name)}">
        <span class="top-tool-rank">${idx + 1}.</span>
        <span class="top-tool-name" title="${escapeHtml(tool.name)}">${escapeHtml(tool.name)}</span>
        <div class="top-tool-bar-container">
          <div class="top-tool-bar" style="width: ${tool.pct}%"></div>
        </div>
        <span class="top-tool-pct">${tool.pct}%</span>
      </div>`;
    })
    .join('');

  return `
    <div class="top-tools">
      <div class="chart-title">Top Tools (${topTools.total_calls} calls)</div>
      ${rows}
    </div>`;
}

/**
 * Donut chart colors (blue gradient palette)
 */
const DONUT_COLORS = [
  '#00d4ff',  // Neon blue (brightest)
  '#0097b2',  // Medium bright blue
  '#0d5c73',  // Medium blue
  '#0a4d5c',  // Darker blue
  '#083d47',  // Dark blue
  '#5a6a70',  // Blue-gray (for "Others")
];

/**
 * Render method distribution donut chart (SVG)
 */
export function renderMethodDistribution(methodDist: HtmlMethodDistribution): string {
  if (methodDist.slices.length === 0) {
    return `
      <div class="method-distribution">
        <div class="chart-title">Method Distribution</div>
        <div class="no-data-message">No RPCs</div>
      </div>`;
  }

  // SVG donut chart parameters
  const size = 60;
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = 26;
  const innerRadius = 16; // Creates the donut hole

  // Generate SVG path segments
  let paths = '';
  let currentAngle = -90; // Start from top (12 o'clock)

  methodDist.slices.forEach((slice, idx) => {
    const angle = (slice.pct / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;

    // Convert angles to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    // Calculate arc points for outer radius
    const x1Outer = cx + outerRadius * Math.cos(startRad);
    const y1Outer = cy + outerRadius * Math.sin(startRad);
    const x2Outer = cx + outerRadius * Math.cos(endRad);
    const y2Outer = cy + outerRadius * Math.sin(endRad);

    // Calculate arc points for inner radius
    const x1Inner = cx + innerRadius * Math.cos(endRad);
    const y1Inner = cy + innerRadius * Math.sin(endRad);
    const x2Inner = cx + innerRadius * Math.cos(startRad);
    const y2Inner = cy + innerRadius * Math.sin(startRad);

    // Large arc flag
    const largeArc = angle > 180 ? 1 : 0;

    // Color
    const color = DONUT_COLORS[idx % DONUT_COLORS.length];

    // SVG path for donut segment
    const d = [
      `M ${x1Outer} ${y1Outer}`,                                    // Start at outer edge
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2Outer} ${y2Outer}`, // Outer arc
      `L ${x1Inner} ${y1Inner}`,                                    // Line to inner edge
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x2Inner} ${y2Inner}`, // Inner arc (reverse)
      'Z',                                                          // Close path
    ].join(' ');

    const title = `${slice.method}: ${slice.count} (${slice.pct}%)`;
    paths += `<path d="${d}" fill="${color}"><title>${escapeHtml(title)}</title></path>`;

    currentAngle = endAngle;
  });

  // Generate legend
  const legendItems = methodDist.slices
    .map((slice, idx) => {
      const color = DONUT_COLORS[idx % DONUT_COLORS.length];
      return `
      <div class="donut-legend-item">
        <div class="donut-legend-color" style="background: ${color}"></div>
        <span class="donut-legend-label" title="${escapeHtml(slice.method)}">${escapeHtml(slice.method)}</span>
        <span class="donut-legend-pct">${slice.pct}%</span>
      </div>`;
    })
    .join('');

  return `
    <div class="method-distribution">
      <div class="chart-title">Methods (${methodDist.total_rpcs} RPCs)</div>
      <div class="donut-container">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${paths}
        </svg>
        <div class="donut-legend">
          ${legendItems}
        </div>
      </div>
    </div>`;
}

/**
 * Render the analytics panel (4 charts horizontally)
 */
function renderAnalyticsPanel(analytics: HtmlConnectorAnalyticsV1): string {
  return `
    <div class="analytics-panel">
      ${renderHeatmap(analytics.heatmap)}
      ${renderMethodLatencyChart(analytics.method_latency)}
      ${renderTopTools(analytics.top_tools)}
      ${renderMethodDistribution(analytics.method_distribution)}
    </div>`;
}

/**
 * Render a session item for the sessions pane (compact grid view)
 */
function renderConnectorSessionItem(session: HtmlConnectorSessionRow): string {
  // Format timestamp compactly: MM/DD HH:MM
  const timestamp = formatCompactTimestamp(session.started_at);
  const latencyStr = session.total_latency_ms !== null
    ? `${session.total_latency_ms}ms`
    : '-';

  return `
    <div class="session-item"
         data-session-id="${escapeHtml(session.session_id)}"
         title="Session: ${session.session_id}&#10;Started: ${session.started_at}&#10;RPCs: ${session.rpc_count}&#10;Events: ${session.event_count}&#10;Errors: ${session.error_count}">
      <span class="session-id">[${escapeHtml(session.short_id)}]</span>
      <span class="session-timestamp">${timestamp}</span>
      <span class="session-counts"><span>R:${session.rpc_count}</span><span>E:${session.event_count}</span></span>
      <span class="session-latency">${latencyStr}</span>
      <span class="session-extra"></span>
    </div>`;
}

/**
 * Format timestamp compactly for grid display (UTC)
 * Returns format: HH:MM:SS.mmm (time with milliseconds)
 * @public - exported for testing
 */
export function formatCompactTimestamp(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) {
      return '-';
    }
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
  } catch {
    return '-';
  }
}

/**
 * Render session detail content (reuses session HTML layout)
 */
/**
 * Render a single RPC detail HTML (pre-rendered for direct DOM insertion)
 * This avoids JavaScript string concatenation issues with special characters
 */
function renderRpcDetailHtml(rpc: SessionRpcDetail, idx: number): string {
  const statusClass = `status-${rpc.status}`;
  const statusSymbol = getStatusSymbol(rpc.status);
  const latency = rpc.latency_ms !== null ? `${rpc.latency_ms}ms` : '(pending)';

  // Pre-render summary and raw JSON HTML
  const requestSummaryRows = renderRequestSummary(rpc.method, rpc.request.json);
  const responseSummaryRows = renderResponseSummary(rpc.method, rpc.response.json);
  const requestSummaryHtml = renderSummaryRowsHtml(requestSummaryRows);
  const responseSummaryHtml = renderSummaryRowsHtml(responseSummaryRows);
  const requestRawHtml = renderJsonWithPaths(rpc.request.json, '#');
  const responseRawHtml = renderJsonWithPaths(rpc.response.json, '#');

  // Detect sensitive keys
  const reqSensitiveKeys = detectSensitiveKeys(rpc.request.json);
  const resSensitiveKeys = detectSensitiveKeys(rpc.response.json);
  const allSensitiveKeys = [...reqSensitiveKeys, ...resSensitiveKeys];
  const hasSensitive = allSensitiveKeys.length > 0;

  // Sensitive badge
  let sensitiveBadge = '';
  if (hasSensitive) {
    const escapedKeys = allSensitiveKeys.map(k => escapeHtml(k));
    const sensitiveTooltip = escapedKeys.length > 5
      ? `Contains ${escapedKeys.length} sensitive keys: ${escapedKeys.slice(0, 5).join(', ')}...`
      : `Contains sensitive keys: ${escapedKeys.join(', ')}`;
    sensitiveBadge = `<span class="sensitive-badge" title="${escapeHtml(sensitiveTooltip)}">⚠ Sensitive</span>`;
  }

  // Determine default target based on method
  const defaultTarget = (rpc.method === 'tools/list' || rpc.method === 'initialize' || rpc.method.startsWith('resources/') || rpc.method.startsWith('prompts/')) ? 'response' : 'request';

  return `<div class="rpc-detail-content" data-rpc-idx="${idx}" style="display: none;">
  <div class="detail-section">
    <h2>RPC Info${sensitiveBadge}</h2>
    <div class="rpc-info-grid">
      <div class="rpc-info-item"><dt>RPC ID</dt><dd><span class="badge">${escapeHtml(rpc.rpc_id)}</span></dd></div>
      <div class="rpc-info-item"><dt>Method</dt><dd><span class="badge">${escapeHtml(rpc.method)}</span></dd></div>
      <div class="rpc-info-item"><dt>Status</dt><dd><span class="badge ${statusClass}">${statusSymbol} ${rpc.status}${rpc.error_code !== null ? ` (code: ${rpc.error_code})` : ''}</span></dd></div>
      <div class="rpc-info-item"><dt>Latency</dt><dd><span class="badge">${latency}</span></dd></div>
      <div class="rpc-info-item"><dt>Request</dt><dd>${escapeHtml(rpc.request_ts)}</dd></div>
      <div class="rpc-info-item"><dt>Response</dt><dd>${escapeHtml(rpc.response_ts || '-')}</dd></div>
    </div>
  </div>
  <div class="detail-section">
    <div class="rpc-toggle-bar">
      <button class="rpc-toggle-btn${defaultTarget === 'request' ? ' active' : ''}" data-target="request">[Req]</button>
      <button class="rpc-toggle-btn${defaultTarget === 'response' ? ' active' : ''}" data-target="response">[Res]</button>
    </div>
    <div class="rpc-inspector">
      <div class="rpc-inspector-summary">
        <h3>Summary</h3>
        <div class="summary-request" style="display: ${defaultTarget === 'request' ? 'block' : 'none'}">${requestSummaryHtml}</div>
        <div class="summary-response" style="display: ${defaultTarget === 'response' ? 'block' : 'none'}">${responseSummaryHtml}</div>
      </div>
      <div class="rpc-inspector-raw">
        <div class="rpc-raw-json">
          <div class="raw-json-request" style="display: ${defaultTarget === 'request' ? 'block' : 'none'}">${requestRawHtml}</div>
          <div class="raw-json-response" style="display: ${defaultTarget === 'response' ? 'block' : 'none'}">${responseRawHtml}</div>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

function renderSessionDetailContent(
  sessionId: string,
  report: HtmlSessionReportV1
): string {
  const { session, rpcs } = report;

  const totalLatencyDisplay = session.total_latency_ms !== null
    ? `${session.total_latency_ms}ms`
    : '-';

  const rpcRows = rpcs.map((rpc, idx) => {
    const statusClass = `status-${rpc.status}`;
    const statusSymbol = getStatusSymbol(rpc.status);
    const rpcIdShort = rpc.rpc_id.slice(0, SHORT_ID_LENGTH);
    const timeShort = formatTimestamp(rpc.request_ts).split(' ')[1]?.slice(0, 12) || '-';
    const latency = rpc.latency_ms !== null ? `${rpc.latency_ms}ms` : '-';

    return `
      <tr class="rpc-row" data-rpc-idx="${idx}">
        <td>${timeShort}</td>
        <td><span class="badge ${statusClass}">${statusSymbol}</span></td>
        <td><span class="badge">${escapeHtml(rpcIdShort)}</span></td>
        <td>${escapeHtml(rpc.method)}</td>
        <td>${latency}</td>
      </tr>`;
  }).join('\n');

  // Pre-render all RPC detail HTML (avoids JS string concatenation issues)
  const rpcDetailDivs = rpcs.map((rpc, idx) => renderRpcDetailHtml(rpc, idx)).join('\n');

  return `
    <div class="session-content" data-session-id="${escapeHtml(sessionId)}">
      <div class="inner-container">
        <div class="left-pane">
          <div class="session-info">
            <h2>Session Info</h2>
            <dl>
              <dt>Session ID</dt>
              <dd><span class="badge">${escapeHtml(session.session_id)}</span></dd>
              <dt>Started</dt>
              <dd>${formatTimestamp(session.started_at)}</dd>
              <dt>Ended</dt>
              <dd>${session.ended_at ? formatTimestamp(session.ended_at) : '(active)'}</dd>
              <dt>Exit Reason</dt>
              <dd>${session.exit_reason || '(none)'}</dd>
              <dt>RPC Count</dt>
              <dd><span class="badge">${session.rpc_count}</span></dd>
              <dt>Event Count</dt>
              <dd><span class="badge">${session.event_count}</span></dd>
              <dt>Total Latency</dt>
              <dd><span class="badge">${totalLatencyDisplay}</span></dd>
            </dl>
          </div>
          <div class="view-toggle">
            <button class="view-toggle-btn active" data-view="rpc">
              RPCs<span class="view-toggle-count">(${session.rpc_count})</span>
            </button>
            <button class="view-toggle-btn" data-view="events">
              Events<span class="view-toggle-count">(${session.event_count})</span>
            </button>
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
          <div class="events-list">
            <div class="events-loading">Loading events...</div>
          </div>
        </div>
        <div class="resize-handle"></div>
        <div class="right-pane">
          <div class="detail-placeholder">
            ${rpcs.length > 0 ? 'Select an RPC call from the list to view details' : 'No RPC calls in this session'}
          </div>
          <div class="rpc-details-container" style="display: none;">
${rpcDetailDivs}
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * Generate Connector HTML report (3-hierarchy: Connector -> Sessions -> RPCs)
 */
export function generateConnectorHtml(report: HtmlConnectorReportV1): string {
  const { meta, connector, sessions, session_reports, analytics } = report;

  // Pagination info
  const fromNum = connector.offset + 1;
  const toNum = connector.offset + connector.displayed_sessions;
  const paginationInfo = connector.session_count > 0
    ? `Showing ${fromNum}-${toNum} of ${connector.session_count} sessions`
    : 'No sessions';

  // Connector info section
  const transportDisplay = connector.transport.type === 'stdio'
    ? connector.transport.command || '(unknown command)'
    : connector.transport.url || '(unknown URL)';

  // Server Response Info card (if available, from initialize response)
  let serverResponseInfoCard = '';
  if (connector.server) {
    const { name, version, protocolVersion, capabilities } = connector.server;
    const serverName = name || '(unknown)';
    const serverVersion = version ? `v${version}` : '';
    const protocolDisplay = protocolVersion ? `MCP ${protocolVersion}` : 'Unknown';

    // Capabilities badges with all options (active/inactive state)
    const allCaps = ['tools', 'resources', 'prompts'] as const;
    const capBadges = allCaps.map(cap => {
      const isActive = capabilities[cap];
      const cls = isActive ? 'badge cap-enabled' : 'badge cap-disabled';
      return `<span class="${cls}">${cap}</span>`;
    }).join(' ');

    serverResponseInfoCard = `
    <div class="connector-info expanded">
      <div class="connector-info-toggle">
        <h2>Server Response Info</h2>
        <span class="toggle-icon">▼</span>
      </div>
      <div class="connector-info-content">
        <dl>
          <dt>Server</dt>
          <dd><code>${escapeHtml(serverName)} ${escapeHtml(serverVersion)}</code></dd>
          <dt>Protocol</dt>
          <dd><span class="badge">${escapeHtml(protocolDisplay)}</span></dd>
          <dt>Capabilities</dt>
          <dd>${capBadges}</dd>
        </dl>
      </div>
    </div>`;
  }

  // Session items
  const sessionItems = sessions.map(s => renderConnectorSessionItem(s)).join('\n');

  // Session contents (pre-rendered, hidden by default)
  const sessionContents = sessions.map(s => {
    const sessionReport = session_reports[s.session_id];
    if (!sessionReport) return '';
    return renderSessionDetailContent(s.session_id, sessionReport);
  }).join('\n');

  // Pre-render summary and raw JSON HTML for each RPC in each session (for RPC Inspector)
  // Now generates separate request/response summaries for Req/Res toggle
  const sessionReportsWithInspectorHtml: Record<string, HtmlSessionReportV1 & { rpcs: Array<SessionRpcDetail & { _requestSummaryHtml: string; _responseSummaryHtml: string; _requestRawHtml: string; _responseRawHtml: string }> }> = {};
  for (const [sessionId, sessionReport] of Object.entries(session_reports)) {
    sessionReportsWithInspectorHtml[sessionId] = {
      ...sessionReport,
      rpcs: sessionReport.rpcs.map((rpc) => {
        const requestSummaryRows = renderRequestSummary(rpc.method, rpc.request.json);
        const responseSummaryRows = renderResponseSummary(rpc.method, rpc.response.json);
        // Detect sensitive keys in request/response (Phase 12.x-c)
        const reqSensitiveKeys = detectSensitiveKeys(rpc.request.json);
        const resSensitiveKeys = detectSensitiveKeys(rpc.response.json);
        const hasSensitive = reqSensitiveKeys.length > 0 || resSensitiveKeys.length > 0;
        return {
          ...rpc,
          _requestSummaryHtml: renderSummaryRowsHtml(requestSummaryRows),
          _responseSummaryHtml: renderSummaryRowsHtml(responseSummaryRows),
          _requestRawHtml: renderJsonWithPaths(rpc.request.json, '#'),
          _responseRawHtml: renderJsonWithPaths(rpc.response.json, '#'),
          _hasSensitive: hasSensitive,
          _sensitiveKeys: [...reqSensitiveKeys, ...resSensitiveKeys],
        };
      }),
    };
  }

  const reportWithInspectorHtml = {
    ...report,
    session_reports: sessionReportsWithInspectorHtml,
  };
  const embeddedJson = escapeJsonForScript(JSON.stringify(reportWithInspectorHtml));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connector: ${escapeHtml(connector.connector_id)} - proofscan</title>
  <style>${getConnectorReportStyles()}</style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <div class="header-title">ProofScan Monitor</div>
      <a href="/" class="header-back">← Home</a>
    </div>
    <div class="header-meta">
      <div class="auto-check-toggle" id="autoCheckToggle">
        <span class="auto-check-label">Auto-check:</span>
        <button data-enabled="false" class="active">OFF</button>
        <button data-enabled="true">ON</button>
      </div>
      <div class="new-data-banner" id="newDataBanner">
        <span>New data available</span>
        <button id="refreshNowBtn">Refresh now</button>
      </div>
      <span class="offline-badge">Offline</span>
      <span>Generated: ${formatTimestamp(meta.generatedAt)}${meta.redacted ? ' (redacted)' : ''}</span>
    </div>
  </header>
  <div class="page-header">
    <div class="page-header-left">
      <h1>Connector: <span class="badge">${escapeHtml(connector.connector_id)}</span></h1>
    </div>
    ${renderKpiRow(analytics.kpis)}
  </div>

  <div class="connector-top">
    <div class="connector-info-cards">
      <div class="connector-info expanded">
        <div class="connector-info-toggle">
          <h2>Connector Info</h2>
          <span class="toggle-icon">▼</span>
        </div>
        <div class="connector-info-content">
          <dl>
            <dt>Transport</dt>
            <dd><span class="badge">${escapeHtml(connector.transport.type)}</span></dd>
            <dt>${connector.transport.type === 'stdio' ? 'Command' : 'URL'}</dt>
            <dd><code>${escapeHtml(transportDisplay)}</code></dd>
            <dt>Enabled</dt>
            <dd>${connector.enabled ? '<span class="badge status-OK">yes</span>' : '<span class="badge status-ERR">no</span>'}</dd>
          </dl>
        </div>
      </div>
      ${serverResponseInfoCard}
    </div>
    ${renderAnalyticsPanel(analytics)}
  </div>

  <div class="main-container">
    <div class="sessions-pane">
      <div class="sessions-header">
        <h2>Sessions</h2>
        <span class="pagination-info">${paginationInfo}</span>
      </div>
      <div class="sessions-header-row">
        <span>ID</span>
        <span>Time (UTC)</span>
        <span style="text-align:right">Latency</span>
        <span></span>
      </div>
      <div class="sessions-list">
${sessionItems}
      </div>
    </div>

    <div class="session-detail-pane">
      ${sessions.length === 0 ? '<div class="session-detail-empty">No sessions available</div>' : ''}
${sessionContents}
    </div>
  </div>

  <script type="application/json" id="report-data">${embeddedJson}</script>
  <script>${getConnectorReportScript()}</script>
</body>
</html>`;
}
