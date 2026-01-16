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
          <div class="section-title">POPL Summary</div>
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

  return renderLayout({
    title: 'ProofScan Monitor',
    generatedAt: data.generated_at,
    content,
    extraStyles: getHomeStyles(),
    scripts: getFilterScript(),
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
