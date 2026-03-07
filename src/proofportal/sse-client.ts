/**
 * ProofPortal - SSE Client (Browser-side)
 * Phase 4: ProofPortal MVP
 *
 * This module generates inline JavaScript for browser-side SSE consumption.
 * The generated code runs in the browser to receive real-time events from Gateway.
 */

/**
 * Get browser-side SSE client script
 * This is embedded as inline JavaScript in the HTML page.
 */
export function getSseClientScript(): string {
  return `
(function() {
  'use strict';

  // ProofComm event kinds to filter
  const PROOFCOMM_KINDS = [
    'proofcomm_space',
    'proofcomm_skill',
    'proofcomm_document',
    'proofcomm_route'
  ];

  // State
  const state = {
    threads: new Map(),
    spaces: new Map(),
    agents: new Map(),
    connected: false,
    eventCount: 0,
    lastEventTs: 0
  };

  let eventSource = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY = 3000;

  // DOM elements
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionText = connectionStatus?.querySelector('.connection-text');
  const eventCountEl = document.getElementById('eventCount');
  const agentListEl = document.getElementById('agentList');
  const threadListEl = document.getElementById('threadList');
  const spaceListEl = document.getElementById('spaceList');

  /**
   * Update connection status display
   */
  function updateConnectionStatus(connected) {
    state.connected = connected;
    if (connectionStatus) {
      connectionStatus.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
    }
    if (connectionText) {
      connectionText.textContent = connected ? 'Connected' : 'Disconnected';
    }
  }

  /**
   * Update event count display
   */
  function updateEventCount() {
    if (eventCountEl) {
      eventCountEl.textContent = state.eventCount + ' events';
    }
  }

  /**
   * Format timestamp
   */
  function formatTime(ts) {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  /**
   * Escape HTML
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Process incoming SSE event
   */
  function processEvent(data) {
    const metadata = data.metadata || {};
    const agentId = metadata.agent_id || data.client_id;
    const spaceId = metadata.space_id;
    const traceId = data.trace_id;
    const now = data.ts || Date.now();

    state.eventCount++;
    state.lastEventTs = now;

    // Update agent state
    if (agentId) {
      let agent = state.agents.get(agentId);
      if (!agent) {
        agent = {
          agentId: agentId,
          traceIds: new Set(),
          spaceIds: new Set(),
          eventCount: 0,
          lastSeenAt: now
        };
        state.agents.set(agentId, agent);
      }
      agent.eventCount++;
      agent.lastSeenAt = now;
      if (traceId) agent.traceIds.add(traceId);
      if (spaceId) agent.spaceIds.add(spaceId);
    }

    // Update space state
    if (spaceId) {
      let space = state.spaces.get(spaceId);
      if (!space) {
        space = {
          spaceId: spaceId,
          spaceName: metadata.space_name,
          members: new Set(),
          messageCount: 0,
          lastActivityAt: now
        };
        state.spaces.set(spaceId, space);
      }
      space.lastActivityAt = now;
      if (metadata.space_name) space.spaceName = metadata.space_name;

      if (metadata.action === 'joined' && agentId) {
        space.members.add(agentId);
      } else if (metadata.action === 'left' && agentId) {
        space.members.delete(agentId);
      } else if (metadata.action === 'message') {
        space.messageCount++;
      }
    }

    // Update thread state
    if (traceId) {
      let thread = state.threads.get(traceId);
      if (!thread) {
        thread = {
          traceId: traceId,
          participants: new Set(),
          eventCount: 0,
          startedAt: now,
          lastActivityAt: now
        };
        state.threads.set(traceId, thread);
      }
      thread.eventCount++;
      thread.lastActivityAt = now;
      if (agentId) thread.participants.add(agentId);
    }

    // Update UI
    renderAgentList();
    renderSpaceList();
    renderThreadList();
    updateEventCount();
  }

  /**
   * Get activity class based on last seen time
   */
  function getActivityClass(lastSeenAt) {
    const now = Date.now();
    const diffSec = (now - lastSeenAt) / 1000;
    if (diffSec < 30) return 'active';
    if (diffSec < 300) return 'recent';
    return 'idle';
  }

  /**
   * Format relative time (e.g., "2s ago", "5m ago")
   */
  function formatRelativeTime(ts) {
    const now = Date.now();
    const diffMs = now - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return diffSec + 's ago';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + 'h ago';
    return Math.floor(diffHour / 24) + 'd ago';
  }

  /**
   * Truncate ID for display
   */
  function truncateId(id, maxLen) {
    if (!id) return '';
    if (id.length <= maxLen) return id;
    return id.slice(0, maxLen - 3) + '...';
  }

  /**
   * Render agent list
   */
  function renderAgentList() {
    if (!agentListEl) return;

    if (state.agents.size === 0) {
      agentListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-text">No agents yet</div><div class="empty-state-hint">Agents will appear when events are received</div></div>';
      return;
    }

    const agents = Array.from(state.agents.values())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 20);

    agentListEl.innerHTML = agents.map(function(agent) {
      const activityClass = getActivityClass(agent.lastSeenAt);
      const displayId = truncateId(agent.agentId, 20);
      return '<div class="list-item agent-item ' + activityClass + '" data-agent-id="' + escapeHtml(agent.agentId) + '">' +
        '<div class="agent-header">' +
          '<span class="agent-indicator ' + activityClass + '"></span>' +
          '<span class="agent-id" title="' + escapeHtml(agent.agentId) + '">' + escapeHtml(displayId) + '</span>' +
        '</div>' +
        '<div class="agent-stats">' +
          '<span class="stat-item" title="Events"><span class="stat-icon">📊</span><span class="stat-value">' + agent.eventCount + '</span></span>' +
          '<span class="stat-item" title="Spaces"><span class="stat-icon">🏠</span><span class="stat-value">' + agent.spaceIds.size + '</span></span>' +
          '<span class="stat-item" title="Threads"><span class="stat-icon">🧵</span><span class="stat-value">' + agent.traceIds.size + '</span></span>' +
        '</div>' +
        '<div class="agent-time">' + formatRelativeTime(agent.lastSeenAt) + '</div>' +
      '</div>';
    }).join('');

    // Update panel header count
    const header = agentListEl.closest('.panel')?.querySelector('.panel-count');
    if (header) header.textContent = state.agents.size;
  }

  /**
   * Render space list
   */
  function renderSpaceList() {
    if (!spaceListEl) return;

    if (state.spaces.size === 0) {
      spaceListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏠</div><div class="empty-state-text">No spaces yet</div><div class="empty-state-hint">Spaces appear when agents join or send messages</div></div>';
      return;
    }

    const spaces = Array.from(state.spaces.values())
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 20);

    spaceListEl.innerHTML = spaces.map(function(space) {
      const displayName = space.spaceName || truncateId(space.spaceId, 12);
      const memberCount = space.members.size;
      const isActive = space.messageCount > 0;

      // Render up to 5 member badges
      const memberArr = Array.from(space.members).slice(0, 5);
      const memberBadges = memberArr.map(function(agentId) {
        const initial = agentId.charAt(0).toUpperCase();
        const shortId = agentId.slice(0, 8);
        return '<div class="member-badge" title="' + escapeHtml(agentId) + '">' +
          '<span class="member-avatar">' + initial + '</span>' +
          '<span class="member-id">' + escapeHtml(shortId) + '</span>' +
        '</div>';
      }).join('');
      const moreMembers = memberCount > 5 ? '<span class="more-members">+' + (memberCount - 5) + '</span>' : '';

      return '<div class="space-card" data-space-id="' + escapeHtml(space.spaceId) + '">' +
        '<div class="space-header">' +
          '<div class="space-title">' +
            '<span class="space-icon">🏠</span>' +
            '<span class="space-name" title="' + escapeHtml(space.spaceId) + '">' + escapeHtml(displayName) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="space-stats">' +
          '<div class="space-stat"><span class="stat-label">Members</span><span class="stat-value">' + memberCount + '</span></div>' +
          '<div class="space-stat"><span class="stat-label">Messages</span><span class="stat-value">' + space.messageCount + '</span></div>' +
        '</div>' +
        '<div class="space-members">' + memberBadges + moreMembers + '</div>' +
        '<div class="space-activity">' +
          '<span class="activity-indicator ' + (isActive ? 'active' : '') + '"></span>' +
          '<span class="activity-text">' + (isActive ? 'Active' : 'Quiet') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    // Update panel header count
    const header = spaceListEl.closest('.panel')?.querySelector('.panel-count');
    if (header) header.textContent = state.spaces.size;
  }

  /**
   * Format duration in human-readable format
   */
  function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    var sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    return min + 'm ' + (sec % 60) + 's';
  }

  /**
   * Render thread list
   */
  function renderThreadList() {
    if (!threadListEl) return;

    if (state.threads.size === 0) {
      threadListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🧵</div><div class="empty-state-text">No threads yet</div><div class="empty-state-hint">Threads appear when traced events arrive</div></div>';
      return;
    }

    const threads = Array.from(state.threads.values())
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 50);

    threadListEl.innerHTML = threads.map(function(thread) {
      const shortId = thread.traceId.slice(0, 8) + '…' + thread.traceId.slice(-4);
      const participantCount = thread.participants.size;
      const eventCount = thread.eventCount;
      const duration = thread.lastActivityAt - thread.startedAt;

      return '<div class="thread-card" data-trace-id="' + escapeHtml(thread.traceId) + '">' +
        '<div class="thread-header">' +
          '<span class="thread-id" title="' + escapeHtml(thread.traceId) + '">' + escapeHtml(shortId) + '</span>' +
          '<span class="thread-meta">' +
            '<span class="thread-stat">' + eventCount + ' events</span>' +
            '<span class="thread-stat">' + participantCount + ' agents</span>' +
          '</span>' +
        '</div>' +
        '<div class="thread-footer">' +
          '<span class="thread-duration">' + formatDuration(duration) + '</span>' +
          '<span class="thread-time">' + formatTime(thread.lastActivityAt) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    // Update panel header count
    const header = threadListEl.closest('.panel')?.querySelector('.panel-count');
    if (header) header.textContent = state.threads.size;
  }

  /**
   * Connect to SSE stream
   */
  function connect() {
    if (eventSource) {
      eventSource.close();
    }

    const kinds = PROOFCOMM_KINDS.join(',');
    const url = '/events/stream?kinds=' + encodeURIComponent(kinds);

    console.log('[Portal] Connecting to SSE:', url);
    eventSource = new EventSource(url);

    eventSource.onopen = function() {
      console.log('[Portal] SSE connected');
      updateConnectionStatus(true);
      reconnectAttempts = 0;
    };

    eventSource.onerror = function(e) {
      console.error('[Portal] SSE error:', e);
      updateConnectionStatus(false);

      if (eventSource.readyState === EventSource.CLOSED) {
        scheduleReconnect();
      }
    };

    eventSource.addEventListener('gateway_event', function(e) {
      try {
        const data = JSON.parse(e.data);
        if (PROOFCOMM_KINDS.includes(data.event_kind)) {
          processEvent(data);
        }
      } catch (err) {
        console.error('[Portal] Failed to parse event:', err);
      }
    });
  }

  /**
   * Schedule reconnection
   */
  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[Portal] Max reconnect attempts reached');
      return;
    }

    reconnectAttempts++;
    const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5);
    console.log('[Portal] Reconnecting in', delay, 'ms (attempt', reconnectAttempts, ')');

    setTimeout(connect, delay);
  }

  // Initialize
  renderAgentList();
  renderSpaceList();
  renderThreadList();
  connect();

  // Cleanup on page unload
  window.addEventListener('beforeunload', function() {
    if (eventSource) {
      eventSource.close();
    }
  });
})();
`;
}
