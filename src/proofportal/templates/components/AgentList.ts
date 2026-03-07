/**
 * ProofPortal - AgentList Component
 * Phase 4.3: Agent activity visualization
 *
 * Displays a list of active agents with:
 * - Activity indicators (event count, last seen)
 * - Space/thread participation counts
 * - Click to filter events by agent
 */

import { escapeHtml } from '../layout.js';

/**
 * Agent display data
 */
export interface AgentDisplayData {
  agentId: string;
  eventCount: number;
  spaceCount: number;
  threadCount: number;
  lastSeenAt: number;
  isActive: boolean;  // activity in last 30 seconds
}

/**
 * Format relative time (e.g., "2s ago", "5m ago")
 */
export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  return `${Math.floor(diffHour / 24)}d ago`;
}

/**
 * Truncate agent ID for display
 */
export function truncateAgentId(agentId: string, maxLen: number = 20): string {
  if (agentId.length <= maxLen) {
    return agentId;
  }
  return agentId.slice(0, maxLen - 3) + '...';
}

/**
 * Get activity class based on last seen time
 */
export function getActivityClass(lastSeenAt: number): string {
  const now = Date.now();
  const diffSec = (now - lastSeenAt) / 1000;

  if (diffSec < 30) return 'active';
  if (diffSec < 300) return 'recent';
  return 'idle';
}

/**
 * Render a single agent list item
 */
export function renderAgentItem(agent: AgentDisplayData): string {
  const activityClass = getActivityClass(agent.lastSeenAt);
  const displayId = truncateAgentId(agent.agentId);

  return `
    <div class="list-item agent-item ${activityClass}" data-agent-id="${escapeHtml(agent.agentId)}">
      <div class="agent-header">
        <span class="agent-indicator ${activityClass}"></span>
        <span class="agent-id" title="${escapeHtml(agent.agentId)}">${escapeHtml(displayId)}</span>
      </div>
      <div class="agent-stats">
        <span class="stat-item" title="Events">
          <span class="stat-icon">📊</span>
          <span class="stat-value">${agent.eventCount}</span>
        </span>
        <span class="stat-item" title="Spaces">
          <span class="stat-icon">🏠</span>
          <span class="stat-value">${agent.spaceCount}</span>
        </span>
        <span class="stat-item" title="Threads">
          <span class="stat-icon">🧵</span>
          <span class="stat-value">${agent.threadCount}</span>
        </span>
      </div>
      <div class="agent-time">${formatRelativeTime(agent.lastSeenAt)}</div>
    </div>
  `;
}

/**
 * Render empty state for agent list
 */
export function renderAgentEmptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">👤</div>
      <div class="empty-state-text">No agents yet</div>
      <div class="empty-state-hint">Agents will appear when events are received</div>
    </div>
  `;
}

/**
 * Get AgentList-specific CSS styles
 */
export function getAgentListStyles(): string {
  return `
    /* Agent list styles */
    .agent-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-left: 3px solid var(--border-color);
      transition: border-color 0.2s, background 0.2s;
    }

    .agent-item.active {
      border-left-color: var(--accent-green);
      background: rgba(63, 185, 80, 0.05);
    }

    .agent-item.recent {
      border-left-color: var(--accent-yellow);
    }

    .agent-item.idle {
      border-left-color: var(--accent-gray);
      opacity: 0.7;
    }

    .agent-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .agent-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-gray);
    }

    .agent-indicator.active {
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
    }

    .agent-indicator.recent {
      background: var(--accent-yellow);
    }

    .agent-id {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      font-family: monospace;
    }

    .agent-stats {
      display: flex;
      gap: 12px;
      font-size: 11px;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--text-secondary);
    }

    .stat-icon {
      font-size: 10px;
    }

    .stat-value {
      color: var(--text-primary);
      font-weight: 500;
    }

    .agent-time {
      font-size: 10px;
      color: var(--text-secondary);
    }
  `;
}
