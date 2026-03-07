/**
 * ProofPortal - ThreadPanel Component
 * Phase 4.4: Thread/trace visualization
 *
 * Displays events grouped by trace_id with:
 * - Timeline visualization
 * - Participant list
 * - Event details on expansion
 */

import { escapeHtml } from '../layout.js';
import type { ProofCommAction } from '../../types.js';

/**
 * Event display data for thread
 */
export interface ThreadEventData {
  id: string;
  action: ProofCommAction;
  eventKind: string;
  timestamp: number;
  agentId: string | null;
  spaceId: string | null;
  spaceName: string | null;
  preview: string | null;
}

/**
 * Thread display data
 */
export interface ThreadDisplayData {
  traceId: string;
  events: ThreadEventData[];
  participants: string[];
  startedAt: number;
  lastActivityAt: number;
  duration: number;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/**
 * Get action badge class
 */
export function getActionClass(action: ProofCommAction): string {
  switch (action) {
    case 'message':
    case 'created':
      return 'action-success';
    case 'joined':
    case 'activated':
      return 'action-info';
    case 'left':
    case 'deactivated':
      return 'action-warning';
    case 'delivery_failed':
    case 'deleted':
      return 'action-error';
    default:
      return 'action-default';
  }
}

/**
 * Get event kind icon
 */
export function getEventKindIcon(eventKind: string): string {
  switch (eventKind) {
    case 'proofcomm_space':
      return '🏠';
    case 'proofcomm_skill':
      return '🔧';
    case 'proofcomm_document':
      return '📄';
    case 'proofcomm_route':
      return '🔀';
    default:
      return '📌';
  }
}

/**
 * Truncate trace ID for display
 */
export function truncateTraceId(traceId: string): string {
  if (traceId.length <= 12) return traceId;
  return traceId.slice(0, 8) + '…' + traceId.slice(-4);
}

/**
 * Render a single event in the timeline
 */
export function renderThreadEvent(event: ThreadEventData): string {
  const icon = getEventKindIcon(event.eventKind);
  const actionClass = getActionClass(event.action);
  const agentDisplay = event.agentId ? escapeHtml(event.agentId.slice(0, 12)) : 'unknown';

  return `
    <div class="thread-event" data-event-id="${escapeHtml(event.id)}">
      <div class="event-timeline-dot"></div>
      <div class="event-content">
        <div class="event-header">
          <span class="event-icon">${icon}</span>
          <span class="event-action ${actionClass}">${escapeHtml(event.action)}</span>
          <span class="event-agent">${agentDisplay}</span>
          <span class="event-time">${formatTimestamp(event.timestamp)}</span>
        </div>
        ${event.preview ? `<div class="event-preview">${escapeHtml(event.preview)}</div>` : ''}
        ${event.spaceName ? `<div class="event-space">in ${escapeHtml(event.spaceName)}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render a thread card
 */
export function renderThreadCard(thread: ThreadDisplayData): string {
  const shortId = truncateTraceId(thread.traceId);
  const participantCount = thread.participants.length;
  const eventCount = thread.events.length;

  return `
    <div class="thread-card" data-trace-id="${escapeHtml(thread.traceId)}">
      <div class="thread-header">
        <span class="thread-id" title="${escapeHtml(thread.traceId)}">${escapeHtml(shortId)}</span>
        <span class="thread-meta">
          <span class="thread-stat">${eventCount} events</span>
          <span class="thread-stat">${participantCount} agents</span>
        </span>
      </div>
      <div class="thread-timeline">
        ${thread.events.slice(-5).map(e => renderThreadEvent(e)).join('')}
        ${thread.events.length > 5 ? `<div class="thread-more">+${thread.events.length - 5} more</div>` : ''}
      </div>
      <div class="thread-footer">
        <span class="thread-duration">${formatDuration(thread.duration)}</span>
        <span class="thread-time">${formatTimestamp(thread.lastActivityAt)}</span>
      </div>
    </div>
  `;
}

/**
 * Render empty state for thread panel
 */
export function renderThreadEmptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🧵</div>
      <div class="empty-state-text">No threads yet</div>
      <div class="empty-state-hint">Threads appear when traced events arrive</div>
    </div>
  `;
}

/**
 * Get ThreadPanel-specific CSS styles
 */
export function getThreadPanelStyles(): string {
  return `
    /* Thread panel styles */
    .thread-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
    }

    .thread-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .thread-id {
      font-family: monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent-blue);
    }

    .thread-meta {
      display: flex;
      gap: 10px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .thread-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .thread-timeline {
      padding: 8px 12px;
      position: relative;
    }

    .thread-timeline::before {
      content: '';
      position: absolute;
      left: 20px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--border-color);
    }

    .thread-event {
      display: flex;
      gap: 10px;
      padding: 6px 0;
      position: relative;
    }

    .event-timeline-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--bg-secondary);
      border: 2px solid var(--accent-blue);
      z-index: 1;
      flex-shrink: 0;
      margin-top: 4px;
    }

    .event-content {
      flex: 1;
      min-width: 0;
    }

    .event-header {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .event-icon {
      font-size: 12px;
    }

    .event-action {
      font-size: 11px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .action-success { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
    .action-info { background: rgba(0, 212, 255, 0.15); color: var(--accent-blue); }
    .action-warning { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }
    .action-error { background: rgba(248, 81, 73, 0.15); color: var(--accent-red); }
    .action-default { background: var(--bg-tertiary); color: var(--text-secondary); }

    .event-agent {
      font-size: 11px;
      color: var(--text-secondary);
      font-family: monospace;
    }

    .event-time {
      font-size: 10px;
      color: var(--text-secondary);
      margin-left: auto;
    }

    .event-preview {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .event-space {
      font-size: 10px;
      color: var(--accent-purple);
      margin-top: 2px;
    }

    .thread-more {
      text-align: center;
      font-size: 11px;
      color: var(--text-secondary);
      padding: 4px;
      cursor: pointer;
    }

    .thread-more:hover {
      color: var(--accent-blue);
    }

    .thread-footer {
      display: flex;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-top: 1px solid var(--border-color);
      font-size: 10px;
      color: var(--text-secondary);
    }

    .thread-duration {
      color: var(--accent-green);
    }
  `;
}
