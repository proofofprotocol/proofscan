/**
 * ProofScan Web Monitor - Home page template
 */

import type { MonitorHomeData } from '../types.js';
import { renderLayout } from './layout.js';
import {
  renderPoplPanel,
  getPoplPanelStyles,
  renderConnectorCard,
  getConnectorCardStyles,
} from './components.js';
import { renderHeatmap, renderMethodDistribution } from '../../html/index.js';

/**
 * Render home page HTML
 */
export function renderHomePage(data: MonitorHomeData): string {
  const poplPanel = renderPoplPanel(data.popl);

  // Render aggregated analytics charts
  const heatmapHtml = renderHeatmap(data.aggregated_analytics.heatmap);
  const methodsHtml = renderMethodDistribution(data.aggregated_analytics.method_distribution);

  const connectorCards = data.connectors.length > 0
    ? data.connectors.map(renderConnectorCard).join('')
    : '<div class="empty-state">No connectors configured</div>';

  const content = `
    <section class="section">
      <div class="overview-row">
        <div class="overview-panel popl-summary">
          <div class="section-title">Ledger Summary</div>
          ${poplPanel}
        </div>
        <div class="overview-panel activity-overview">
          <div class="section-title">Activity Overview</div>
          <div class="analytics-row">
            <div class="analytics-card heatmap-container">
              ${heatmapHtml}
            </div>
            <div class="analytics-card method-distribution">
              ${methodsHtml}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div class="section-title">Connectors</div>
        <div class="filter-bar">
          <input type="text" class="filter-search" placeholder="Search connectors..." id="searchInput">
          <div class="filter-badges">
            <button class="filter-badge" data-filter="tools">tools</button>
            <button class="filter-badge" data-filter="resources">resources</button>
            <button class="filter-badge" data-filter="prompts">prompts</button>
            <button class="filter-badge" data-filter="subscriptions">subscriptions</button>
          </div>
        </div>
      </div>
      <div class="connector-cards" id="connectorCards">
        ${connectorCards}
      </div>
    </section>
  `;

  // Add modal HTML to content
  const contentWithModal = content + getLedgerModalHtml();

  return renderLayout({
    title: 'ProofScan Monitor',
    generatedAt: data.generated_at,
    content: contentWithModal,
    extraStyles: getHomeStyles(),
    scripts: getFilterScript() + getLedgerModalScript(),
    dataApp: 'monitor', // Phase 12.1: Enable auto-check script
  });
}

/**
 * Get home page styles
 */
function getHomeStyles(): string {
  return `
${getPoplPanelStyles()}
${getConnectorCardStyles()}
${getAnalyticsStyles()}
${getOverviewRowStyles()}
${getPoplDetailStyles()}

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .section-header .section-title {
      margin-bottom: 0;
    }

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .filter-search {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 12px;
      color: var(--text-primary);
      font-size: 13px;
      width: 200px;
    }

    .filter-search:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .filter-search::placeholder {
      color: var(--text-secondary);
    }

    .filter-badges {
      display: flex;
      gap: 6px;
    }

    .filter-badge {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 4px 10px;
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .filter-badge:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .filter-badge.active {
      background: rgba(0, 212, 255, 0.1);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }

    .connector-card.hidden {
      display: none;
    }
  `;
}

/**
 * Get analytics chart styles (matching existing HTML export)
 */
function getAnalyticsStyles(): string {
  return `
    .analytics-row {
      display: flex;
      gap: 16px;
    }

    .analytics-card {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
    }

    .analytics-card .chart-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 12px;
    }

    /* Heatmap styles */
    .heatmap-container { flex: 0.8; overflow-x: auto; }
    .heatmap-svg { display: block; }
    .heatmap-level-0 { fill: var(--bg-tertiary); }
    .heatmap-level-1 { fill: #0a3d4d; }
    .heatmap-level-2 { fill: #0d5c73; }
    .heatmap-level-3 { fill: #0097b2; }
    .heatmap-level-4 { fill: #00d4ff; }

    /* Method distribution styles */
    .method-distribution { flex: 1; }
    .method-distribution .chart-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .donut-container {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .donut-container svg { flex-shrink: 0; }
    .donut-legend { flex: 1; }
    .donut-legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .donut-legend-color { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
    .donut-legend-label { color: var(--text-primary); flex: 1; }
    .donut-legend-pct { color: var(--text-secondary); font-family: 'SF Mono', Consolas, monospace; }
    .no-data-message { color: var(--text-secondary); font-size: 12px; text-align: center; padding: 20px; }
  `;
}

/**
 * Get overview row styles (POPL + Activity side by side)
 */
function getOverviewRowStyles(): string {
  return `
    .overview-row {
      display: flex;
      gap: 16px;
      align-items: stretch;
    }

    .overview-panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
    }

    .overview-panel .section-title {
      margin-bottom: 12px;
    }

    .overview-panel.popl-summary {
      flex: 0 0 auto;
      min-width: 200px;
    }

    .overview-panel.popl-summary .popl-panel {
      background: transparent;
      border: none;
      padding: 0;
    }

    .overview-panel.activity-overview {
      flex: 1;
    }

    .overview-panel.activity-overview .analytics-row {
      margin: 0;
    }

    .overview-panel.activity-overview .analytics-card {
      background: var(--bg-tertiary);
    }

    @media (max-width: 900px) {
      .overview-row {
        flex-direction: column;
      }
      .overview-panel.popl-summary {
        min-width: auto;
      }
    }
  `;
}

/**
 * Get filter script
 */
function getFilterScript(): string {
  return `
(function() {
  const searchInput = document.getElementById('searchInput');
  const cards = document.querySelectorAll('.connector-card');
  const filterBadges = document.querySelectorAll('.filter-badge');
  let activeFilters = new Set();

  function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase();

    cards.forEach(card => {
      const id = card.dataset.id.toLowerCase();
      const capabilities = (card.dataset.capabilities || '').split(',');

      // Search filter
      const matchesSearch = !searchTerm || id.includes(searchTerm);

      // Capability filter (AND logic - must have all selected)
      const matchesCapabilities = activeFilters.size === 0 ||
        [...activeFilters].every(f => capabilities.includes(f));

      if (matchesSearch && matchesCapabilities) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  }

  searchInput.addEventListener('input', applyFilters);

  filterBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      const filter = badge.dataset.filter;
      if (activeFilters.has(filter)) {
        activeFilters.delete(filter);
        badge.classList.remove('active');
      } else {
        activeFilters.add(filter);
        badge.classList.add('active');
      }
      applyFilters();
    });
  });
})();
  `;
}

/**
 * Get POPL detail styles for modal content
 */
function getPoplDetailStyles(): string {
  return `
    /* Trust Badge */
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

    /* Artifacts Table */
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
    }
    .artifact-link {
      color: var(--accent-blue);
      text-decoration: none;
    }
    .artifact-link:hover {
      text-decoration: underline;
    }
    .no-artifacts {
      color: var(--text-secondary);
      font-style: italic;
    }

    /* POPL Detail Sections */
    .popl-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }
    .popl-header-main h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 4px 0;
    }
    .popl-entry-id {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }
    .popl-meta {
      font-size: 12px;
      color: var(--text-secondary);
      margin: 0;
    }
    .detail-section {
      margin-bottom: 24px;
    }
    .detail-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
  `;
}

/**
 * Get Ledger modal HTML structure
 */
function getLedgerModalHtml(): string {
  return `
<div class="modal-overlay" id="ledgerModal">
  <div class="modal-container">
    <div class="modal-header">
      <div class="modal-title">
        <span>Ledger Entry:</span>
        <span class="modal-entry-id" id="modalEntryId"></span>
      </div>
      <div class="modal-actions">
        <div style="position: relative;">
          <button class="modal-menu-btn" id="modalMenuBtn">⋮</button>
          <div class="modal-dropdown" id="modalDropdown">
            <a class="modal-dropdown-item" id="modalOpenNew" target="_blank">
              <span>↗</span> Open in new window
            </a>
            <div class="modal-dropdown-divider"></div>
            <button class="modal-dropdown-item" id="modalDownloadJson">
              <span>↓</span> Download JSON
            </button>
            <button class="modal-dropdown-item" id="modalDownloadYaml">
              <span>↓</span> Download YAML
            </button>
            <div class="modal-dropdown-divider"></div>
            <button class="modal-dropdown-item" id="modalCopyLink">
              <span>🔗</span> Copy link
            </button>
          </div>
        </div>
        <button class="modal-close-btn" id="modalCloseBtn">×</button>
      </div>
    </div>
    <div class="modal-content" id="modalContent">
      <!-- Loaded dynamically -->
    </div>
  </div>
</div>`;
}

/**
 * Get Ledger modal JavaScript
 */
function getLedgerModalScript(): string {
  return `
(function() {
  var currentLedgerId = null;
  var modal = document.getElementById('ledgerModal');
  var modalContent = document.getElementById('modalContent');
  var modalEntryId = document.getElementById('modalEntryId');
  var modalOpenNew = document.getElementById('modalOpenNew');
  var modalMenuBtn = document.getElementById('modalMenuBtn');
  var modalDropdown = document.getElementById('modalDropdown');
  var modalCloseBtn = document.getElementById('modalCloseBtn');
  var modalCopyLink = document.getElementById('modalCopyLink');
  var modalDownloadJson = document.getElementById('modalDownloadJson');
  var modalDownloadYaml = document.getElementById('modalDownloadYaml');

  if (!modal) return;

  // Open modal
  function openLedgerModal(ledgerId, options) {
    options = options || {};

    // Prevent duplicate opens
    if (currentLedgerId === ledgerId) return;

    currentLedgerId = ledgerId;

    // Update URL (skip if from popstate to avoid loop)
    if (!options.fromPopstate) {
      var url = new URL(window.location.href);
      url.searchParams.set('ledger', ledgerId);
      history.pushState({ ledger: ledgerId }, '', url);
    }

    // Load content via fetch
    fetch('/popl/' + encodeURIComponent(ledgerId))
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        // Try data-page="popl" first, then fallback to main
        var main = doc.querySelector('main[data-page="popl"]') || doc.querySelector('main');
        if (main) {
          modalContent.innerHTML = main.innerHTML;
          // Remove back link from modal content
          var backLink = modalContent.querySelector('.back-link');
          if (backLink) backLink.remove();
        } else {
          modalContent.innerHTML = '<div class="modal-error">Failed to load content</div>';
        }
      })
      .catch(function() {
        modalContent.innerHTML = '<div class="modal-error">Failed to load content</div>';
      });

    // Update modal UI
    modalEntryId.textContent = ledgerId.slice(0, 12) + '...';
    modalOpenNew.href = '/popl/' + encodeURIComponent(ledgerId);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Close modal
  function closeLedgerModal() {
    if (!currentLedgerId) return;
    currentLedgerId = null;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    modalDropdown.classList.remove('active');
  }

  // Close and update URL
  function closeAndUpdateUrl() {
    closeLedgerModal();
    var url = new URL(window.location.href);
    url.searchParams.delete('ledger');
    history.pushState({}, '', url);
  }

  // Intercept clicks on ledger/POPL links (only entry pages, not artifacts)
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href^="/popl/"]');
    if (link) {
      // Don't intercept target="_blank" links (Open in new window)
      if (link.target === '_blank') return;

      // Ctrl/Cmd+Click opens in new tab (don't intercept)
      if (e.ctrlKey || e.metaKey) return;

      // Check if this is a POPL entry link (not artifacts or other sub-paths)
      // Format: /popl/{ULID} where ULID is 26 chars
      var href = link.getAttribute('href');
      var match = href.match(new RegExp('^/popl/([^/]+)$'));
      if (!match) return; // Not a direct POPL entry link, let it navigate normally

      var ledgerId = match[1].split('?')[0];
      if (ledgerId) {
        e.preventDefault();
        openLedgerModal(decodeURIComponent(ledgerId), { fromPopstate: false });
      }
    }
  });

  // Close button
  modalCloseBtn.addEventListener('click', closeAndUpdateUrl);

  // Click outside modal (on overlay)
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeAndUpdateUrl();
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeAndUpdateUrl();
    }
  });

  // Menu toggle
  modalMenuBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    modalDropdown.classList.toggle('active');
  });

  // Close dropdown on outside click
  document.addEventListener('click', function() {
    modalDropdown.classList.remove('active');
  });

  // Copy link
  modalCopyLink.addEventListener('click', function() {
    navigator.clipboard.writeText(window.location.href).then(function() {
      modalCopyLink.querySelector('span').textContent = '✓';
      setTimeout(function() {
        modalCopyLink.querySelector('span').textContent = '🔗';
      }, 1500);
    }).catch(function(err) {
      console.error('Copy failed:', err);
    });
  });

  // Download handlers
  modalDownloadJson.addEventListener('click', function() {
    if (currentLedgerId) {
      window.location.href = '/api/popl/' + encodeURIComponent(currentLedgerId) + '/download?format=json';
    }
  });

  modalDownloadYaml.addEventListener('click', function() {
    if (currentLedgerId) {
      window.location.href = '/api/popl/' + encodeURIComponent(currentLedgerId) + '/download?format=yaml';
    }
  });

  // Handle browser back/forward
  window.addEventListener('popstate', function() {
    var params = new URLSearchParams(window.location.search);
    var ledgerId = params.get('ledger');
    if (ledgerId) {
      openLedgerModal(ledgerId, { fromPopstate: true });
    } else {
      closeLedgerModal();
    }
  });

  // Check URL on load for modal state
  var params = new URLSearchParams(window.location.search);
  var initialLedgerId = params.get('ledger');
  if (initialLedgerId) {
    openLedgerModal(initialLedgerId, { fromPopstate: true });
  }
})();
  `;
}
