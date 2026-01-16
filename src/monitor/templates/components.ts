/**
 * ProofScan Web Monitor - UI Components
 */

import type {
  MonitorConnectorCard,
  MonitorPoplKpis,
  ConnectorStatus,
} from '../types.js';
import { escapeHtml } from './layout.js';

/**
 * Render POPL KPI panel with latest entries list
 */
export function renderPoplPanel(popl: MonitorPoplKpis | null): string {
  if (!popl) {
    return `
      <div class="popl-panel popl-empty">
        <div class="popl-title">POPL</div>
        <div class="popl-message">Not initialized</div>
      </div>
    `;
  }

  // Render latest entries list
  const latestEntriesHtml =
    popl.latest_entries.length > 0
      ? `
        <div class="popl-latest-list">
          <div class="popl-latest-title">Recent Entries</div>
          ${popl.latest_entries
            .map((entry) => {
              const trustClass = `popl-trust-${entry.trust_level}`;
              const shortId = entry.id.slice(0, 12);
              return `
              <a href="/popl/${encodeURIComponent(entry.id)}" class="popl-latest-item">
                <span class="popl-latest-id">${escapeHtml(shortId)}...</span>
                <span class="popl-latest-badge ${trustClass}">${escapeHtml(entry.trust_label)}</span>
              </a>
            `;
            })
            .join('')}
        </div>
      `
      : '<div class="popl-no-entries">No entries yet</div>';

  return `
    <div class="popl-panel">
      <div class="popl-kpis">
        <div class="popl-kpi">
          <span class="popl-value">${popl.entries}</span>
          <span class="popl-label">Entries</span>
        </div>
        <div class="popl-kpi">
          <span class="popl-value popl-inscribed">${popl.inscribed}</span>
          <span class="popl-label">Inscribed</span>
        </div>
        <div class="popl-kpi">
          <span class="popl-value popl-ipfs">${popl.ipfs_only}</span>
          <span class="popl-label">IPFS Only</span>
        </div>
        <div class="popl-kpi">
          <span class="popl-value popl-failed">${popl.failed}</span>
          <span class="popl-label">Failed</span>
        </div>
      </div>
      ${latestEntriesHtml}
    </div>
  `;
}

/**
 * Get POPL panel styles
 */
export function getPoplPanelStyles(): string {
  return `
    .popl-panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
    }

    .popl-panel.popl-empty {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .popl-title {
      font-weight: 600;
      color: var(--text-secondary);
    }

    .popl-message {
      color: var(--text-secondary);
      font-size: 12px;
    }

    .popl-kpis {
      display: flex;
      gap: 24px;
      margin-bottom: 8px;
    }

    .popl-kpi {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .popl-value {
      font-size: 20px;
      font-weight: 600;
      color: var(--accent-blue);
      font-family: 'SF Mono', Consolas, monospace;
    }

    .popl-value.popl-inscribed { color: var(--accent-green); }
    .popl-value.popl-ipfs { color: var(--accent-yellow); }
    .popl-value.popl-failed { color: var(--accent-red); }

    .popl-label {
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .popl-latest {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .popl-latest-list {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .popl-latest-title {
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .popl-latest-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      margin-bottom: 4px;
      background: var(--bg-tertiary);
      border: 1px solid transparent;
      border-radius: 4px;
      text-decoration: none;
      transition: border-color 0.15s;
    }

    .popl-latest-item:hover {
      border-color: var(--accent-blue);
    }

    .popl-latest-id {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--accent-blue);
    }

    .popl-latest-badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 500;
    }

    .popl-trust-0 {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .popl-trust-1 {
      background: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--accent-green);
    }

    .popl-trust-2 {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: var(--accent-blue);
    }

    .popl-trust-3 {
      background: rgba(255, 215, 0, 0.15);
      border: 1px solid rgba(255, 215, 0, 0.3);
      color: #ffd700;
    }

    .popl-no-entries {
      font-size: 12px;
      color: var(--text-secondary);
      font-style: italic;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }
  `;
}

/**
 * Render connector card
 */
export function renderConnectorCard(card: MonitorConnectorCard): string {
  const statusBadge = getStatusBadge(card.status);
  const enabledBadge = card.enabled
    ? '<span class="badge badge-enabled">Enabled</span>'
    : '<span class="badge badge-disabled">Disabled</span>';

  const capabilities = renderCapabilities(card.capabilities);
  const transportBadge = `<span class="badge badge-transport">${card.transport}</span>`;

  const disabledClass = card.enabled ? '' : 'card-disabled';

  return `
    <a href="/connectors/${escapeHtml(card.connector_id)}" class="connector-card ${disabledClass}" data-id="${escapeHtml(card.connector_id)}" data-capabilities="${getCapabilitiesData(card.capabilities)}" data-transport="${card.transport}">
      <div class="card-header">
        <div class="card-title">${escapeHtml(card.connector_id)}</div>
        <div class="card-badges">
          ${statusBadge}
          ${enabledBadge}
        </div>
      </div>
      <div class="card-package">${escapeHtml(card.package_name)}@${escapeHtml(card.package_version)}</div>
      <div class="card-capabilities">
        ${capabilities}
        ${transportBadge}
      </div>
      <div class="card-kpis">
        <div class="card-kpi">
          <span class="kpi-value">${formatNumber(card.kpis.sessions)}</span>
          <span class="kpi-label">Sessions</span>
        </div>
        <div class="card-kpi">
          <span class="kpi-value">${formatNumber(card.kpis.rpcs)}</span>
          <span class="kpi-label">RPCs</span>
        </div>
        <div class="card-kpi">
          <span class="kpi-value">${formatNumber(card.kpis.errors)}</span>
          <span class="kpi-label">Errors</span>
        </div>
        <div class="card-kpi">
          <span class="kpi-value">${card.kpis.avg_latency_ms !== null ? card.kpis.avg_latency_ms + 'ms' : '-'}</span>
          <span class="kpi-label">Avg</span>
        </div>
      </div>
      <div class="card-footer">
        <span class="card-activity">Last: ${escapeHtml(card.last_activity_relative)}</span>
      </div>
    </a>
  `;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status: ConnectorStatus): string {
  const classes: Record<ConnectorStatus, string> = {
    OK: 'badge-ok',
    WARN: 'badge-warn',
    ERR: 'badge-err',
    OFFLINE: 'badge-offline',
  };
  return `<span class="badge ${classes[status]}">${status}</span>`;
}

/**
 * Render capability badges
 */
function renderCapabilities(
  capabilities: MonitorConnectorCard['capabilities']
): string {
  const badges: string[] = [];
  if (capabilities.tools) badges.push('<span class="badge badge-capability">tools</span>');
  if (capabilities.resources) badges.push('<span class="badge badge-capability">resources</span>');
  if (capabilities.prompts) badges.push('<span class="badge badge-capability">prompts</span>');
  if (capabilities.subscriptions) badges.push('<span class="badge badge-capability">subscriptions</span>');
  return badges.join('');
}

/**
 * Get capabilities as data attribute value
 */
function getCapabilitiesData(
  capabilities: MonitorConnectorCard['capabilities']
): string {
  const caps: string[] = [];
  if (capabilities.tools) caps.push('tools');
  if (capabilities.resources) caps.push('resources');
  if (capabilities.prompts) caps.push('prompts');
  if (capabilities.subscriptions) caps.push('subscriptions');
  return caps.join(',');
}

/**
 * Format number with K/M suffix
 */
function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Get connector card styles
 */
export function getConnectorCardStyles(): string {
  return `
    .connector-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .connector-card {
      display: block;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      text-decoration: none;
      transition: border-color 0.15s, transform 0.15s;
    }

    .connector-card:hover {
      border-color: var(--accent-blue);
      transform: translateY(-2px);
      text-decoration: none;
    }

    .connector-card.card-disabled {
      opacity: 0.6;
    }

    .connector-card.card-disabled:hover {
      opacity: 0.8;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .card-badges {
      display: flex;
      gap: 6px;
    }

    .card-package {
      font-size: 12px;
      color: var(--text-secondary);
      font-family: 'SF Mono', Consolas, monospace;
      margin-bottom: 12px;
    }

    .card-capabilities {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }

    .card-kpis {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px 0;
      border-top: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
    }

    .card-kpi {
      text-align: center;
    }

    .card-kpi .kpi-value {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-blue);
      font-family: 'SF Mono', Consolas, monospace;
    }

    .card-kpi .kpi-label {
      font-size: 10px;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .card-footer {
      padding-top: 8px;
    }

    .card-activity {
      font-size: 12px;
      color: var(--text-secondary);
    }
  `;
}
