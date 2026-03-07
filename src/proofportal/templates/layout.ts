/**
 * ProofPortal - Base HTML layout
 * Phase 4: ProofPortal MVP
 */

import { getAgentListStyles } from './components/AgentList.js';
import { getThreadPanelStyles } from './components/ThreadPanel.js';
import { getSpaceViewStyles } from './components/SpaceView.js';
import { getGuildPanelStyles } from './components/GuildPanel.js';
import { getGuildMapStyles } from './components/GuildMap.js';

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format timestamp for display
 */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Get portal-specific CSS styles
 */
export function getPortalStyles(): string {
  return `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-blue: #00d4ff;
      --accent-green: #3fb950;
      --accent-yellow: #d29922;
      --accent-red: #f85149;
      --accent-purple: #a371f7;
      --accent-gray: #6e7681;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      background: var(--bg-primary);
      min-height: 100vh;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-title::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--accent-purple);
      border-radius: 50%;
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Connection status indicator */
    .connection-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font-size: 11px;
    }

    .connection-status.connected {
      border-color: rgba(63, 185, 80, 0.3);
    }

    .connection-status.disconnected {
      border-color: rgba(248, 81, 73, 0.3);
    }

    .connection-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-gray);
    }

    .connected .connection-dot {
      background: var(--accent-green);
      animation: pulse 2s infinite;
    }

    .disconnected .connection-dot {
      background: var(--accent-red);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Main layout */
    .main {
      display: grid;
      grid-template-columns: 280px 1fr 320px;
      gap: 1px;
      background: var(--border-color);
      min-height: calc(100vh - 49px);
    }

    .panel {
      background: var(--bg-primary);
      overflow-y: auto;
    }

    .panel-header {
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .panel-count {
      font-weight: normal;
      color: var(--accent-blue);
    }

    .panel-content {
      padding: 8px;
    }

    /* List items */
    .list-item {
      padding: 10px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: border-color 0.15s;
    }

    .list-item:hover {
      border-color: var(--accent-blue);
    }

    .list-item-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 4px;
    }

    .list-item-meta {
      font-size: 11px;
      color: var(--text-secondary);
      display: flex;
      gap: 8px;
    }

    /* Badge styles */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 500;
    }

    .badge-space { background: rgba(163, 113, 247, 0.15); color: var(--accent-purple); }
    .badge-agent { background: rgba(0, 212, 255, 0.15); color: var(--accent-blue); }
    .badge-message { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
    .badge-skill { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }

    /* Event timeline */
    .event-item {
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-left: 3px solid var(--border-color);
      margin-bottom: 4px;
      font-size: 12px;
    }

    .event-item.space { border-left-color: var(--accent-purple); }
    .event-item.skill { border-left-color: var(--accent-yellow); }
    .event-item.document { border-left-color: var(--accent-blue); }

    .event-time {
      color: var(--text-secondary);
      font-size: 10px;
      font-family: monospace;
    }

    .event-action {
      color: var(--text-primary);
      font-weight: 500;
    }

    .event-preview {
      color: var(--text-secondary);
      font-size: 11px;
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Empty state */
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--text-secondary);
    }

    .empty-state-icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    /* Guild layout (Phase 5) */
    .main-guild {
      display: grid;
      grid-template-columns: 280px 1fr 320px;
      gap: 1px;
      background: var(--border-color);
      min-height: calc(100vh - 180px);
    }

    .panel-column {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--border-color);
    }

    .panel-column .panel {
      flex: 1;
      min-height: 0;
    }

    .left-column .guild-map-panel {
      flex: 2;
    }

    .left-column .agents-panel {
      flex: 1;
      max-height: 200px;
    }

    .center-column .panel,
    .right-column .panel {
      height: 100%;
    }

    /* Guild panel bar (bottom) */
    .guild-panel-bar {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      max-height: 120px;
      overflow: hidden;
    }

    .guild-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .guild-panel-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .guild-panel-hint {
      font-size: 10px;
      color: var(--text-tertiary);
      font-style: italic;
    }

    .guild-panel-content {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 16px;
      overflow-x: auto;
    }

    /* CSS variable for text-tertiary */
    :root {
      --text-tertiary: #6e7681;
    }

    /* Stats bar */
    .stats-bar {
      display: flex;
      gap: 16px;
      padding: 8px 16px;
      background: var(--bg-tertiary);
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--text-secondary);
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stat-value {
      color: var(--text-primary);
      font-weight: 500;
    }

    /* Empty state hint */
    .empty-state-text {
      margin-bottom: 4px;
    }

    .empty-state-hint {
      font-size: 11px;
      opacity: 0.7;
    }
  `;
}

/**
 * Get all component styles combined
 */
export function getComponentStyles(): string {
  return getAgentListStyles() + getThreadPanelStyles() + getSpaceViewStyles() +
    getGuildPanelStyles() + getGuildMapStyles();
}

/**
 * Render the base layout
 */
export function renderLayout(options: {
  title: string;
  content: string;
  scripts?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
${getPortalStyles()}
${getComponentStyles()}
  </style>
</head>
<body data-app="portal">
  <header class="header">
    <div class="header-title">ProofPortal</div>
    <div class="header-meta">
      <div class="connection-status disconnected" id="connectionStatus">
        <span class="connection-dot"></span>
        <span class="connection-text">Disconnected</span>
      </div>
      <span id="eventCount">0 events</span>
    </div>
  </header>
  ${options.content}
  <script>
${options.scripts ?? ''}
  </script>
</body>
</html>`;
}
