/**
 * ProofPortal - Dashboard template
 * Phase 5: ProofGuild
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
  <main class="main-guild">
    <!-- Left Column: Guild Map + Agents -->
    <div class="panel-column left-column">
      <!-- Guild Map Panel -->
      <div class="panel guild-map-panel">
        <div class="panel-header">
          Guild Map <span class="panel-count">0</span>
        </div>
        <div class="panel-content guild-map-content" id="guildMap">
          <div class="guild-map-empty">
            <div class="guild-map-empty-icon">🗺️</div>
            <div class="guild-map-empty-text">No rooms yet</div>
            <div class="guild-map-empty-hint">Rooms appear when spaces are created</div>
          </div>
        </div>
      </div>

      <!-- Agents Panel (legacy) -->
      <div class="panel agents-panel">
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
    </div>

    <!-- Center Column: Threads -->
    <div class="panel-column center-column">
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
    </div>

    <!-- Right Column: Spaces -->
    <div class="panel-column right-column">
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
    </div>
  </main>

  <!-- Guild Panel (bottom bar) -->
  <section class="guild-panel-bar">
    <div class="guild-panel-header">
      <span class="guild-panel-title">⚔️ Guild Members</span>
      <span class="guild-panel-hint">Session XP only</span>
    </div>
    <div class="guild-panel-content" id="guildPanel">
      <div class="guild-empty">No guild members yet</div>
    </div>
  </section>

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
    title: 'ProofPortal - Guild Communication',
    content,
    scripts: getSseClientScript(),
  });
}
