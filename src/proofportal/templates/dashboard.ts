/**
 * ProofPortal - Dashboard template
 * Phase 4: ProofPortal MVP
 */

import { renderLayout, escapeHtml } from './layout.js';
import { getSseClientScript } from '../sse-client.js';

/**
 * Dashboard options
 */
export interface DashboardOptions {
  generatedAt: string;
}

/**
 * Render the main dashboard page
 */
export function renderDashboard(options: DashboardOptions): string {
  const content = `
  <main class="main">
    <!-- Left Panel: Agents -->
    <div class="panel">
      <div class="panel-header">
        Agents <span class="panel-count">0</span>
      </div>
      <div class="panel-content" id="agentList">
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          Waiting for events...
        </div>
      </div>
    </div>

    <!-- Center Panel: Threads -->
    <div class="panel">
      <div class="panel-header">
        Threads <span class="panel-count">0</span>
      </div>
      <div class="panel-content" id="threadList">
        <div class="empty-state">
          <div class="empty-state-icon">🧵</div>
          Waiting for events...
        </div>
      </div>
    </div>

    <!-- Right Panel: Spaces -->
    <div class="panel">
      <div class="panel-header">
        Spaces <span class="panel-count">0</span>
      </div>
      <div class="panel-content" id="spaceList">
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          Waiting for events...
        </div>
      </div>
    </div>
  </main>

  <footer class="stats-bar">
    <div class="stat">
      <span>Generated:</span>
      <span class="stat-value">${escapeHtml(options.generatedAt)}</span>
    </div>
    <div class="stat">
      <span>Mode:</span>
      <span class="stat-value">Real-time SSE</span>
    </div>
  </footer>
  `;

  return renderLayout({
    title: 'ProofPortal - Agent Communication',
    content,
    scripts: getSseClientScript(),
  });
}
