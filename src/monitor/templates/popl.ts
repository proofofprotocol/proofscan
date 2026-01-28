/**
 * ProofScan Web Monitor - POPL detail page template
 */

import type { MonitorPoplEntry } from '../types.js';
import { renderLayout, escapeHtml, formatTimestamp } from './layout.js';

/**
 * Render POPL entry detail page
 */
export function renderPoplDetailPage(entry: MonitorPoplEntry): string {
  const content = `
    <section class="section">
      ${renderBreadcrumb(entry)}
      ${renderEntryHeader(entry)}
    </section>

    <section class="section">
      <div class="section-title">Source</div>
      ${renderSourceLinks(entry)}
    </section>

    <section class="section">
      <div class="section-title">Capture Summary</div>
      ${renderCaptureSummary(entry)}
    </section>

    <section class="section">
      <div class="section-title">Artifacts</div>
      ${renderArtifacts(entry)}
    </section>
  `;

  return renderLayout({
    title: `Ledger: ${entry.id} - ProofScan Monitor`,
    generatedAt: new Date().toISOString(),
    content,
    extraStyles: getPoplDetailStyles(),
    dataPage: 'popl',
    dataApp: 'monitor', // Phase 12.1: Enable auto-check script
  });
}

/**
 * Render 404 page for POPL entry not found
 */
export function renderPopl404Page(proofId: string): string {
  const content = `
    <section class="section">
      ${renderBackNavigation()}
      <div class="error-container">
        <h1 class="error-title">Ledger Entry Not Found</h1>
        <p class="error-message">
          No Ledger entry found with ID: <code>${escapeHtml(proofId)}</code>
        </p>
        <p class="error-hint">
          The entry may have been removed or the ID is incorrect.
        </p>
      </div>
    </section>
  `;

  return renderLayout({
    title: 'Ledger Entry Not Found - ProofScan Monitor',
    generatedAt: new Date().toISOString(),
    content,
    extraStyles: getPoplDetailStyles(),
    dataApp: 'monitor', // Phase 12.1: Enable auto-check script
  });
}

/**
 * Render breadcrumb navigation for Ledger Entry page
 */
function renderBreadcrumb(entry: MonitorPoplEntry): string {
  const shortId = entry.id.slice(0, 10);
  return `
    <nav class="breadcrumb">
      <a href="/" class="breadcrumb-item">Home</a>
      <span class="breadcrumb-sep">/</span>
      <a href="/connectors/${encodeURIComponent(entry.target_id)}" class="breadcrumb-item">${escapeHtml(entry.target_id)}</a>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">Ledger:${escapeHtml(shortId)}</span>
    </nav>
  `;
}

/**
 * Render back navigation link (for 404 pages without entry context)
 */
function renderBackNavigation(): string {
  return `
    <a href="/" class="back-link">← Back to Monitor</a>
  `;
}

/**
 * Render entry header with ID and trust badge
 */
function renderEntryHeader(entry: MonitorPoplEntry): string {
  const trustClass = `trust-level-${entry.trust_level}`;
  const createdFormatted = formatTimestamp(entry.created_at);

  return `
    <div class="popl-header">
      <div class="popl-header-left">
        <h1 class="popl-title">
          Ledger Entry: <span class="popl-id">${escapeHtml(entry.id)}</span>
        </h1>
        <p class="popl-subtitle">${escapeHtml(entry.title)}</p>
        <p class="popl-meta">
          Created: ${createdFormatted} by ${escapeHtml(entry.author_name)}
        </p>
      </div>
      <div class="popl-header-right">
        <span class="trust-badge ${trustClass}">
          ${escapeHtml(entry.trust_label)}
        </span>
      </div>
    </div>
  `;
}

/**
 * Render source links (Connector and Session) as a table
 */
function renderSourceLinks(entry: MonitorPoplEntry): string {
  const connectorLink = `/connectors/${encodeURIComponent(entry.target_id)}`;
  const sessionShort = entry.session_id ? entry.session_id.slice(0, 8) : null;
  const sessionLink = entry.session_id
    ? `/connectors/${encodeURIComponent(entry.target_id)}?session=${encodeURIComponent(entry.session_id)}`
    : null;

  return `
    <table class="source-table">
      <tbody>
        <tr>
          <th>Connector</th>
          <td>
            <a href="${connectorLink}" class="source-link">
              ${escapeHtml(entry.target_id)}
            </a>
          </td>
        </tr>
        <tr>
          <th>Session</th>
          <td>
            ${
              sessionLink
                ? `<a href="${sessionLink}" class="source-link">
                    <code>${escapeHtml(sessionShort ?? '')}...</code>
                    <span class="session-full">${escapeHtml(entry.session_id ?? '')}</span>
                  </a>`
                : `<span class="no-session">(none)</span>`
            }
          </td>
        </tr>
        <tr>
          <th>Target Kind</th>
          <td><span class="badge badge-kind">${escapeHtml(entry.target_kind)}</span></td>
        </tr>
      </tbody>
    </table>
  `;
}

/**
 * Render capture summary as a table
 */
function renderCaptureSummary(entry: MonitorPoplEntry): string {
  const { capture } = entry;
  const startFormatted = formatTimestamp(capture.started_at);
  const endFormatted = formatTimestamp(capture.ended_at);
  const p50Display = capture.latency_ms_p50 !== null ? `${capture.latency_ms_p50}ms` : '-';
  const p95Display = capture.latency_ms_p95 !== null ? `${capture.latency_ms_p95}ms` : '-';

  return `
    <table class="capture-table">
      <tbody>
        <tr>
          <th>Window</th>
          <td colspan="3">${startFormatted} → ${endFormatted}</td>
        </tr>
        <tr>
          <th>RPCs</th>
          <td><span class="capture-stat">${capture.rpc_total}</span></td>
          <th>Errors</th>
          <td><span class="capture-stat ${capture.errors > 0 ? 'stat-error' : ''}">${capture.errors}</span></td>
        </tr>
        <tr>
          <th>P50 Latency</th>
          <td><span class="capture-stat">${p50Display}</span></td>
          <th>P95 Latency</th>
          <td><span class="capture-stat">${p95Display}</span></td>
        </tr>
        ${
          capture.mcp_servers.length > 0
            ? `
        <tr>
          <th>MCP Servers</th>
          <td colspan="3">
            ${capture.mcp_servers.map((s) => `<span class="badge">${escapeHtml(s)}</span>`).join(' ')}
          </td>
        </tr>
        `
            : ''
        }
      </tbody>
    </table>
  `;
}

/**
 * Render artifacts table with links
 */
function renderArtifacts(entry: MonitorPoplEntry): string {
  if (entry.artifacts.length === 0) {
    return '<p class="no-artifacts">No artifacts</p>';
  }

  const rows = entry.artifacts
    .map(
      (artifact) => `
      <tr>
        <td class="artifact-name">
          <a href="/popl/${encodeURIComponent(entry.id)}/artifacts/${encodeURIComponent(artifact.name)}" class="artifact-link">
            ${escapeHtml(artifact.name)}
          </a>
        </td>
        <td class="artifact-path">${escapeHtml(artifact.path)}</td>
        <td class="artifact-sha256" title="${escapeHtml(artifact.sha256)}">
          ${escapeHtml(artifact.sha256.slice(0, 16))}...
        </td>
      </tr>
    `
    )
    .join('');

  return `
    <table class="artifacts-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Path</th>
          <th>SHA256</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

/**
 * Get POPL detail page styles
 */
function getPoplDetailStyles(): string {
  return `
    /* Breadcrumb navigation */
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 13px;
    }

    .breadcrumb-item {
      color: var(--accent-blue);
      text-decoration: none;
    }

    .breadcrumb-item:hover {
      text-decoration: underline;
    }

    .breadcrumb-sep {
      color: var(--text-secondary);
    }

    .breadcrumb-current {
      color: var(--text-primary);
      font-weight: 500;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 16px;
      padding: 6px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--accent-blue);
      text-decoration: none;
      font-size: 13px;
    }

    .back-link:hover {
      border-color: var(--accent-blue);
      background: var(--bg-tertiary);
    }

    .popl-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-top: 8px;
    }

    .popl-header-left {
      flex: 1;
    }

    .popl-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--text-primary);
    }

    .popl-id {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }

    .popl-subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0 0 8px 0;
    }

    .popl-meta {
      font-size: 12px;
      color: var(--text-secondary);
      margin: 0;
    }

    .trust-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
    }

    .trust-level-0 {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .trust-level-1 {
      background: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--accent-green);
    }

    .trust-level-2 {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: var(--accent-blue);
    }

    .trust-level-3 {
      background: rgba(255, 215, 0, 0.15);
      border: 1px solid rgba(255, 215, 0, 0.3);
      color: #ffd700;
    }

    /* Source Table */
    .source-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .source-table th,
    .source-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    .source-table tr:last-child th,
    .source-table tr:last-child td {
      border-bottom: none;
    }

    .source-table th {
      width: 120px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 12px;
    }

    .source-link {
      color: var(--accent-blue);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .source-link:hover {
      text-decoration: underline;
    }

    .source-link code {
      font-family: 'SF Mono', Consolas, monospace;
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .session-full {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--text-secondary);
      margin-left: 4px;
    }

    .no-session {
      color: var(--text-secondary);
      font-style: italic;
    }

    .badge-kind {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }

    /* Capture Table */
    .capture-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .capture-table th,
    .capture-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    .capture-table tr:last-child th,
    .capture-table tr:last-child td {
      border-bottom: none;
    }

    .capture-table th {
      width: 120px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 12px;
    }

    .capture-stat {
      font-family: 'SF Mono', Consolas, monospace;
      font-weight: 600;
      color: var(--accent-blue);
    }

    .capture-stat.stat-error {
      color: var(--accent-red);
    }

    .badge-error {
      background: rgba(248, 81, 73, 0.15);
      border-color: rgba(248, 81, 73, 0.3);
      color: var(--accent-red);
    }

    .artifacts-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .artifacts-table th,
    .artifacts-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    .artifacts-table th {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
    }

    .artifacts-table tbody tr:last-child td {
      border-bottom: none;
    }

    .artifact-name {
      font-weight: 500;
      color: var(--text-primary);
    }

    .artifact-path {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .artifact-sha256 {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: help;
    }

    .no-artifacts {
      color: var(--text-secondary);
      font-style: italic;
    }

    .error-container {
      text-align: center;
      padding: 48px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }

    .error-title {
      font-size: 24px;
      color: var(--accent-red);
      margin: 0 0 16px 0;
    }

    .error-message {
      font-size: 14px;
      color: var(--text-primary);
      margin: 0 0 8px 0;
    }

    .error-message code {
      font-family: 'SF Mono', Consolas, monospace;
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .error-hint {
      font-size: 13px;
      color: var(--text-secondary);
      margin: 0;
    }

    .artifact-link {
      color: var(--accent-blue);
      text-decoration: none;
    }
    .artifact-link:hover {
      text-decoration: underline;
    }
  `;
}

/**
 * Artifact page options
 */
interface ArtifactPageOptions {
  proofId: string;
  artifactName: string;
  connectorId?: string;
  artifact?: {
    name: string;
    path: string;
    sha256: string;
  };
  content?: string;
  isJson?: boolean;
  error?: string;
}

/**
 * Render breadcrumb navigation for Artifact page
 */
function renderArtifactBreadcrumb(
  connectorId: string | undefined,
  proofId: string,
  artifactName: string
): string {
  const shortId = proofId.slice(0, 10);

  if (!connectorId) {
    // Fallback: simpler breadcrumb without connector
    return `
      <nav class="breadcrumb">
        <a href="/" class="breadcrumb-item">Home</a>
        <span class="breadcrumb-sep">/</span>
        <a href="/popl/${encodeURIComponent(proofId)}" class="breadcrumb-item">Ledger:${escapeHtml(shortId)}</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current">${escapeHtml(artifactName)}</span>
      </nav>
    `;
  }

  return `
    <nav class="breadcrumb">
      <a href="/" class="breadcrumb-item">Home</a>
      <span class="breadcrumb-sep">/</span>
      <a href="/connectors/${encodeURIComponent(connectorId)}" class="breadcrumb-item">${escapeHtml(connectorId)}</a>
      <span class="breadcrumb-sep">/</span>
      <a href="/popl/${encodeURIComponent(proofId)}" class="breadcrumb-item">Ledger:${escapeHtml(shortId)}</a>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">${escapeHtml(artifactName)}</span>
    </nav>
  `;
}

/**
 * Render artifact content page
 */
export function renderArtifactPage(options: ArtifactPageOptions): string {
  const { proofId, artifactName, connectorId, artifact, content, isJson, error } = options;

  let contentHtml: string;

  if (error) {
    contentHtml = `
      <div class="artifact-error">
        <p class="error-message">${escapeHtml(error)}</p>
      </div>
    `;
  } else if (content !== undefined) {
    const formattedContent = isJson ? formatJsonContent(content) : escapeHtml(content);
    contentHtml = `
      <div class="artifact-content-wrapper">
        <div class="artifact-meta">
          <span class="artifact-meta-item">
            <strong>Path:</strong> ${escapeHtml(artifact?.path ?? '')}
          </span>
          <span class="artifact-meta-item">
            <strong>SHA256:</strong> <code>${escapeHtml(artifact?.sha256 ?? '')}</code>
          </span>
        </div>
        <pre class="artifact-content ${isJson ? 'json-content' : ''}">${formattedContent}</pre>
      </div>
    `;
  } else {
    contentHtml = '<p class="no-content">No content available</p>';
  }

  const pageContent = `
    <section class="section">
      ${renderArtifactBreadcrumb(connectorId, proofId, artifactName)}
      <div class="artifact-header">
        <h1 class="artifact-title">Artifact: ${escapeHtml(artifactName)}</h1>
      </div>
    </section>

    <section class="section">
      ${contentHtml}
    </section>
  `;

  return renderLayout({
    title: `Artifact: ${artifactName} - ProofScan Monitor`,
    generatedAt: new Date().toISOString(),
    content: pageContent,
    extraStyles: getArtifactPageStyles(),
    dataApp: 'monitor', // Phase 12.1: Enable auto-check script
  });
}

/**
 * Format JSON content with syntax highlighting
 */
function formatJsonContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const formatted = JSON.stringify(parsed, null, 2);
    return escapeHtml(formatted);
  } catch {
    return escapeHtml(content);
  }
}

/**
 * Get artifact page styles
 */
function getArtifactPageStyles(): string {
  return `
    ${getPoplDetailStyles()}

    .artifact-header {
      margin-top: 8px;
    }

    .artifact-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--text-primary);
    }

    .artifact-entry {
      font-size: 13px;
      color: var(--text-secondary);
      margin: 0;
    }

    .artifact-entry code {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }

    .artifact-content-wrapper {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .artifact-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .artifact-meta code {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }

    .artifact-content {
      margin: 0;
      padding: 16px;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--text-primary);
      max-height: 70vh;
      overflow-y: auto;
    }

    .artifact-content.json-content {
      white-space: pre;
    }

    .artifact-error {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 8px;
      padding: 16px;
    }

    .artifact-error .error-message {
      color: var(--accent-red);
      margin: 0;
    }

    .no-content {
      color: var(--text-secondary);
      font-style: italic;
    }
  `;
}
