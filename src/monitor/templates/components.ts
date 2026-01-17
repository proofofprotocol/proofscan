/**
 * ProofScan Web Monitor - UI Components
 */

import type {
  MonitorConnectorCard,
  MonitorPoplKpis,
  ConnectorStatus,
  ProtocolTag,
  MonitorConnectorCapabilities,
  TransportType,
} from '../types.js';
import { escapeHtml } from './layout.js';

// =============================================================================
// Shared Badge Row Renderer
// =============================================================================

/**
 * Common view model for badge row rendering
 * Used by both Home connector cards and Connector detail page
 */
export interface ConnectorBadgeRowVm {
  protocol: ProtocolTag;
  protocol_version?: string;
  enabled: boolean;
  transport: TransportType;
  capabilities: MonitorConnectorCapabilities;
  /** Server name (e.g. "mcp-server-yfinance") */
  server_name?: string;
  /** Server version (e.g. "1.25.0") */
  server_version?: string;
}

/**
 * Render connector badge row (shared between Home cards and Connector detail)
 * Layout matches `show --html` style with grouped labels:
 *   Capabilities: [tools] [resources] [prompts] [subscriptions]
 *   Server: name@version  Protocol: MCP 2024-11-05
 *   Transport: [stdio] [sse] [http]  State: [ENABLED]
 */
export function renderConnectorBadgeRow(vm: ConnectorBadgeRowVm): string {
  const rows: string[] = [];

  // Row 1: Capabilities (show ALL options with active/inactive states)
  const capsRow = renderCapabilitiesRow(vm.capabilities);
  rows.push(capsRow);

  // Row 2: Server + Protocol
  const serverProtocolRow = renderServerProtocolRow(vm);
  rows.push(serverProtocolRow);

  // Row 3: Transport (show ALL options) + Enabled/Disabled
  const transportStateRow = renderTransportStateRow(vm.transport, vm.enabled);
  rows.push(transportStateRow);

  return `<div class="badge-row-container">${rows.join('')}</div>`;
}

/**
 * Render Capabilities row with ALL options shown (active=blue, inactive=gray)
 */
function renderCapabilitiesRow(capabilities: MonitorConnectorCapabilities): string {
  const allCaps: Array<{ key: keyof MonitorConnectorCapabilities; label: string }> = [
    { key: 'tools', label: 'tools' },
    { key: 'resources', label: 'resources' },
    { key: 'prompts', label: 'prompts' },
    { key: 'subscriptions', label: 'subscriptions' },
  ];

  const badges = allCaps.map(({ key, label }) => {
    const isActive = capabilities[key];
    const cls = isActive ? 'badge cap-enabled' : 'badge cap-disabled';
    return `<span class="${cls}">${label}</span>`;
  }).join('');

  return `<div class="badge-row-line">
    <span class="badge-label">Capabilities:</span>
    <span class="badge-values">${badges}</span>
  </div>`;
}

/**
 * Render Server + Protocol row
 */
function renderServerProtocolRow(vm: ConnectorBadgeRowVm): string {
  // Server: name@version or name vX.Y.Z
  const serverName = vm.server_name || '(unknown)';
  const serverVersion = vm.server_version && vm.server_version !== 'unknown'
    ? `@${vm.server_version}`
    : '';
  const serverDisplay = `${escapeHtml(serverName)}${escapeHtml(serverVersion)}`;

  // Protocol: MCP 2024-11-05 or JSON-RPC etc.
  let protocolDisplay: string = vm.protocol;
  if (vm.protocol === 'MCP' && vm.protocol_version) {
    protocolDisplay = `MCP ${vm.protocol_version}`;
  }

  return `<div class="badge-row-line">
    <span class="badge-label">Server:</span>
    <span class="badge-value-text">${serverDisplay}</span>
    <span class="badge-label badge-label-spacer">Protocol:</span>
    <span class="badge-value-text badge-protocol-${vm.protocol.toLowerCase().replace('-', '')}">${escapeHtml(protocolDisplay)}</span>
  </div>`;
}

/**
 * Render Transport options (all shown, active highlighted) + State
 */
function renderTransportStateRow(transport: TransportType, enabled: boolean): string {
  const allTransports: TransportType[] = ['stdio', 'sse', 'http'];

  const transportBadges = allTransports.map((t) => {
    const isActive = transport === t;
    const cls = isActive ? 'badge transport-enabled' : 'badge transport-disabled';
    return `<span class="${cls}">${t}</span>`;
  }).join('');

  const stateBadge = enabled
    ? '<span class="badge state-enabled">ENABLED</span>'
    : '<span class="badge state-disabled">DISABLED</span>';

  return `<div class="badge-row-line">
    <span class="badge-label">Transport:</span>
    <span class="badge-values">${transportBadges}</span>
    <span class="badge-label badge-label-spacer">State:</span>
    ${stateBadge}
  </div>`;
}

/**
 * Get badge row styles (matches `show --html` style)
 */
export function getBadgeRowStyles(): string {
  return `
    .badge-row-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .badge-row-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .badge-label {
      color: var(--text-secondary);
      font-size: 11px;
    }

    .badge-label-spacer {
      margin-left: 12px;
    }

    .badge-values {
      display: flex;
      gap: 4px;
    }

    .badge-value-text {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--text-primary);
    }

    /* Capability badges - active (blue neon) / inactive (gray) */
    .badge.cap-enabled {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
      background: rgba(0, 212, 255, 0.1);
    }

    .badge.cap-disabled {
      border-color: var(--border-color);
      color: var(--text-secondary);
      background: transparent;
      opacity: 0.5;
    }

    /* Transport badges - active (highlighted) / inactive (gray) */
    .badge.transport-enabled {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
      background: rgba(0, 212, 255, 0.1);
    }

    .badge.transport-disabled {
      border-color: var(--border-color);
      color: var(--text-secondary);
      background: transparent;
      opacity: 0.5;
    }

    /* State badges - enabled (green) / disabled (gray) */
    .badge.state-enabled {
      border-color: var(--accent-green);
      color: var(--accent-green);
      background: rgba(63, 185, 80, 0.1);
    }

    .badge.state-disabled {
      border-color: var(--accent-red);
      color: var(--accent-red);
      background: rgba(248, 81, 73, 0.1);
    }

    /* Protocol text colors */
    .badge-value-text.badge-protocol-mcp {
      color: var(--accent-blue);
    }

    .badge-value-text.badge-protocol-a2a {
      color: #a78bfa;
    }

    .badge-value-text.badge-protocol-jsonrpc {
      color: var(--accent-yellow);
    }

    .badge-value-text.badge-protocol-unknown {
      color: var(--text-secondary);
    }
  `;
}

/**
 * Render POPL KPI panel with latest entries list
 */
export function renderPoplPanel(popl: MonitorPoplKpis | null): string {
  if (!popl) {
    return `
      <div class="popl-panel popl-empty">
        <div class="popl-title">Ledger</div>
        <div class="popl-message">Not initialized</div>
      </div>
    `;
  }

  // Render latest entries list
  const latestEntriesHtml =
    popl.latest_entries.length > 0
      ? `
        <div class="popl-latest-list">
          <div class="popl-latest-title">Recent Ledger Entries</div>
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
  const disabledClass = card.enabled ? '' : 'card-disabled';

  // Use shared badge row renderer
  const badgeRow = renderConnectorBadgeRow({
    protocol: card.protocol,
    protocol_version: card.protocol_version,
    enabled: card.enabled,
    transport: card.transport,
    capabilities: card.capabilities,
    server_name: card.package_name,
    server_version: card.package_version,
  });

  return `
    <a href="/connectors/${escapeHtml(card.connector_id)}" class="connector-card ${disabledClass}" data-id="${escapeHtml(card.connector_id)}" data-capabilities="${getCapabilitiesData(card.capabilities)}" data-transport="${card.transport}" data-protocol="${card.protocol}">
      <div class="card-header">
        <div class="card-title">${escapeHtml(card.connector_id)}</div>
        <div class="card-badges">
          ${statusBadge}
        </div>
      </div>
      <div class="card-package">${escapeHtml(card.package_name)}@${escapeHtml(card.package_version)}</div>
      <div class="card-capabilities">
        ${badgeRow}
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
${getBadgeRowStyles()}

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
