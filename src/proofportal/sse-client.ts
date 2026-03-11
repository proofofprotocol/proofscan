/**
 * ProofPortal - SSE Client (Browser-side)
 * Phase 5: ProofGuild
 *
 * This module generates inline JavaScript for browser-side SSE consumption.
 * The generated code runs in the browser to receive real-time events from Gateway.
 *
 * Note: Utility functions (formatTime, formatRelativeTime, truncateId, etc.)
 * are intentionally duplicated here from the server-side component files.
 * This duplication is architecturally unavoidable because:
 * - Server-side: TypeScript modules used for SSR
 * - Browser-side: Inline JavaScript with no module system
 * The functions must be kept in sync manually.
 *
 * Phase 5 additions:
 * - Guild state tracking (name, XP, level, visualState)
 * - currentSpaceId tracking for Room placement
 * - Speaking/Active/Idle state calculation
 */

/**
 * Get browser-side SSE client script
 *
 * WARNING: The returned script is embedded directly in the HTML page.
 * Only trusted, hardcoded content should be used. Never pass user-controlled
 * data to this function as it would create an XSS vulnerability.
 *
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

  // State size limits (LRU eviction when exceeded)
  const MAX_THREADS = 100;
  const MAX_SPACES = 50;
  const MAX_AGENTS = 100;

  // Guild thresholds (Phase 5)
  const SPEAKING_THRESHOLD_MS = 10000;  // 10 seconds for 'speaking' state
  const ACTIVE_THRESHOLD_MS = 60000;    // 60 seconds for 'active' state

  // XP values per action
  // IMPORTANT: Keep in sync with applyEvent() in src/proofportal/types.ts
  // These values must match the server-side XP calculation
  const XP_VALUES = {
    joined: 2,
    message: 5,
    match: 10,
    context_updated: 8,
    dispatched: 6,
    registered: 3
  };

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

  // Per-agent timers for re-rendering when speaking state expires
  const speakingExpiryTimers = new Map();

  /**
   * Evict oldest entries from a Map to maintain size limit (LRU)
   * Entries are evicted based on lastActivityAt or lastSeenAt field
   */
  function evictOldest(map, maxSize, timeField) {
    if (map.size <= maxSize) return;

    // Convert to array and sort by time (oldest first)
    const entries = Array.from(map.entries())
      .sort((a, b) => (a[1][timeField] || 0) - (b[1][timeField] || 0));

    // Remove oldest entries until we're under the limit
    const toRemove = map.size - maxSize;
    for (let i = 0; i < toRemove; i++) {
      map.delete(entries[i][0]);
    }
  }

  // DOM elements
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionText = connectionStatus?.querySelector('.connection-text');
  const eventCountEl = document.getElementById('eventCount');
  const agentListEl = document.getElementById('agentList');
  const threadListEl = document.getElementById('threadList');
  const spaceListEl = document.getElementById('spaceList');
  // Guild DOM elements (Phase 5)
  const guildPanelEl = document.getElementById('guildPanel');
  const guildMapEl = document.getElementById('guildMap');

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

  // ============================================================================
  // Guild Helper Functions (Phase 5)
  // ============================================================================

  /**
   * Calculate level from XP
   */
  function calcLevel(xp) {
    return Math.floor(Math.sqrt(xp / 10)) + 1;
  }

  /**
   * Get visual state based on timestamps
   */
  function getVisualState(agent, now) {
    if (agent.lastMessageAt && (now - agent.lastMessageAt) < SPEAKING_THRESHOLD_MS) {
      return 'speaking';
    }
    if ((now - agent.lastSeenAt) < ACTIVE_THRESHOLD_MS) {
      return 'active';
    }
    return 'idle';
  }

  /**
   * Get membership status
   */
  function getMembershipStatus(agent, now) {
    if ((now - agent.lastSeenAt) < ACTIVE_THRESHOLD_MS) {
      return 'active';
    }
    if (agent.spaceIds.size > 0) {
      return 'joined';
    }
    return 'candidate';
  }

  /**
   * Get display name for agent
   */
  function getAgentDisplayName(agent) {
    return agent.name || truncateId(agent.agentId, 12);
  }

  /**
   * Truncate message preview for bubble display
   */
  function truncatePreview(str, maxLen) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
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
          lastSeenAt: now,
          // Guild fields (Phase 5)
          name: null,
          experience: 0,
          lastMessagePreview: null,
          lastMessageAt: null,
          currentSpaceId: null,
          currentSpaceName: null
        };
        state.agents.set(agentId, agent);
      }
      agent.eventCount++;
      agent.lastSeenAt = now;
      if (traceId) agent.traceIds.add(traceId);
      if (spaceId) agent.spaceIds.add(spaceId);

      // Guild updates (Phase 5)
      // Extract agent_name from metadata
      if (metadata.agent_name) {
        agent.name = metadata.agent_name;
      }

      // Track currentSpaceId and XP based on action
      const action = metadata.action;
      if (action === 'joined' && spaceId) {
        agent.currentSpaceId = spaceId;
        agent.currentSpaceName = metadata.space_name || null;
        agent.experience += XP_VALUES.joined || 0;
      } else if (action === 'message' && spaceId) {
        agent.currentSpaceId = spaceId;
        agent.currentSpaceName = metadata.space_name || null;
        agent.lastMessagePreview = truncatePreview(metadata.message_preview, 40);
        agent.lastMessageAt = now;
        agent.experience += XP_VALUES.message || 0;

        // Schedule re-render when speaking state expires (for bubble fade-out)
        // Use per-agent timer to handle multiple agents speaking simultaneously
        var existingTimer = speakingExpiryTimers.get(agentId);
        if (existingTimer) clearTimeout(existingTimer);
        speakingExpiryTimers.set(agentId, setTimeout(function() {
          speakingExpiryTimers.delete(agentId);
          renderGuildPanel();
          renderGuildMap();
        }, SPEAKING_THRESHOLD_MS + 100)); // Small buffer to ensure state change
      } else if (action === 'left' && spaceId) {
        if (agent.currentSpaceId === spaceId) {
          agent.currentSpaceId = null;
          agent.currentSpaceName = null;
        }
      } else if (action === 'match') {
        agent.experience += XP_VALUES.match || 0;
      } else if (action === 'context_updated') {
        agent.experience += XP_VALUES.context_updated || 0;
      } else if (action === 'dispatched') {
        agent.experience += XP_VALUES.dispatched || 0;
      } else if (action === 'registered') {
        agent.experience += XP_VALUES.registered || 0;
      }
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

    // LRU eviction to prevent unbounded memory growth
    evictOldest(state.agents, MAX_AGENTS, 'lastSeenAt');
    evictOldest(state.spaces, MAX_SPACES, 'lastActivityAt');
    evictOldest(state.threads, MAX_THREADS, 'lastActivityAt');

    // Update UI
    renderAgentList();
    renderSpaceList();
    renderThreadList();
    renderGuildPanel();
    renderGuildMap();
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

  // ============================================================================
  // Guild Rendering (Phase 5)
  // ============================================================================

  /**
   * Get visual state class name
   */
  function getVisualStateClass(visualState) {
    return 'visual-state-' + visualState;
  }

  /**
   * Format level display
   */
  function formatLevel(level) {
    return 'Lv.' + level;
  }

  /**
   * Format membership status for display
   */
  function formatMembershipStatus(status) {
    if (status === 'active') return 'Active';
    if (status === 'joined') return 'Joined';
    return 'Candidate';
  }

  /**
   * Render Guild Panel (member list)
   */
  function renderGuildPanel() {
    if (!guildPanelEl) return;

    const now = Date.now();

    if (state.agents.size === 0) {
      guildPanelEl.innerHTML = '<div class="guild-empty">No guild members yet</div>';
      return;
    }

    const agents = Array.from(state.agents.values())
      .sort(function(a, b) { return b.lastSeenAt - a.lastSeenAt; })
      .slice(0, 20);

    guildPanelEl.innerHTML = agents.map(function(agent) {
      const visualState = getVisualState(agent, now);
      const membershipStatus = getMembershipStatus(agent, now);
      const level = calcLevel(agent.experience);
      const displayName = getAgentDisplayName(agent);

      return '<div class="guild-member ' + getVisualStateClass(visualState) + '" data-agent-id="' + escapeHtml(agent.agentId) + '">' +
        '<div class="guild-member-avatar">' + displayName.charAt(0).toUpperCase() + '</div>' +
        '<div class="guild-member-info">' +
          '<div class="guild-member-name">' + escapeHtml(displayName) + '</div>' +
          '<div class="guild-member-meta">' +
            '<span class="guild-member-level" title="Session Level (XP: ' + agent.experience + ')">Session ' + formatLevel(level) + '</span>' +
            '<span class="guild-member-status ' + membershipStatus + '">' + formatMembershipStatus(membershipStatus) + '</span>' +
          '</div>' +
          '<div class="guild-member-id" title="' + escapeHtml(agent.agentId) + '">' + truncateId(agent.agentId, 16) + '</div>' +
        '</div>' +
        (visualState === 'speaking' && agent.lastMessagePreview ? '<div class="guild-member-bubble">' + escapeHtml(agent.lastMessagePreview) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  /**
   * Render Guild Map (rooms with members)
   */
  function renderGuildMap() {
    if (!guildMapEl) return;

    var MAX_MAP_AGENTS = 50; // Cap to prevent unbounded DOM growth
    var LOBBY_SPACE_ID = '_proofguild_lobby_'; // Namespaced sentinel to avoid collision with real space IDs

    var now = Date.now();

    // Build room Map for O(1) lookup by spaceId
    var rooms = [];
    var roomsBySpaceId = new Map();
    var lobbyMembers = [];

    state.spaces.forEach(function(space) {
      var room = {
        spaceId: space.spaceId,
        spaceName: space.spaceName || truncateId(space.spaceId, 12),
        members: []
      };
      rooms.push(room);
      roomsBySpaceId.set(space.spaceId, room);
    });

    // Place agents in rooms based on currentSpaceId (cap to MAX_MAP_AGENTS)
    var agentCount = 0;
    var agents = Array.from(state.agents.values())
      .sort(function(a, b) { return b.lastSeenAt - a.lastSeenAt; });

    for (var i = 0; i < agents.length && agentCount < MAX_MAP_AGENTS; i++) {
      var agent = agents[i];
      agentCount++;
      var visualState = getVisualState(agent, now);
      var level = calcLevel(agent.experience);
      var memberData = {
        agentId: agent.agentId,
        name: getAgentDisplayName(agent),
        level: level,
        visualState: visualState,
        lastMessagePreview: agent.lastMessagePreview
      };

      if (agent.currentSpaceId) {
        var room = roomsBySpaceId.get(agent.currentSpaceId);
        if (room) {
          room.members.push(memberData);
        } else {
          // Room not found, put in lobby
          lobbyMembers.push(memberData);
        }
      } else {
        // No current space, put in lobby
        lobbyMembers.push(memberData);
      }
    }

    // Add lobby room if there are members
    if (lobbyMembers.length > 0) {
      rooms.unshift({
        spaceId: LOBBY_SPACE_ID,
        spaceName: 'Lobby',
        members: lobbyMembers
      });
    }

    // Render rooms
    if (rooms.length === 0) {
      guildMapEl.innerHTML = '<div class="guild-map-empty">No rooms yet</div>';
      return;
    }

    guildMapEl.innerHTML = rooms.map(function(room) {
      var memberHtml = room.members.map(function(member) {
        return '<div class="guild-map-member ' + getVisualStateClass(member.visualState) + '" ' +
          'data-agent-id="' + escapeHtml(member.agentId) + '" ' +
          'title="' + escapeHtml(member.name) + ' (' + formatLevel(member.level) + ')">' +
          '<div class="guild-map-member-avatar">' + member.name.charAt(0).toUpperCase() + '</div>' +
          '<div class="guild-map-member-name">' + escapeHtml(member.name) + '</div>' +
          (member.visualState === 'speaking' && member.lastMessagePreview ?
            '<div class="guild-map-bubble">' + escapeHtml(member.lastMessagePreview) + '</div>' : '') +
        '</div>';
      }).join('');

      return '<div class="guild-map-room" data-space-id="' + escapeHtml(room.spaceId) + '">' +
        '<div class="guild-map-room-header">' +
          '<span class="guild-map-room-icon">' + (room.spaceId === LOBBY_SPACE_ID ? '🏠' : '🚪') + '</span>' +
          '<span class="guild-map-room-name">' + escapeHtml(room.spaceName) + '</span>' +
          '<span class="guild-map-room-count">' + room.members.length + '</span>' +
        '</div>' +
        '<div class="guild-map-room-members">' + memberHtml + '</div>' +
      '</div>';
    }).join('');
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
  renderGuildPanel();
  renderGuildMap();
  connect();

  // Cleanup on page unload
  window.addEventListener('beforeunload', function() {
    if (eventSource) {
      eventSource.close();
    }
    // Clear all speaking expiry timers
    speakingExpiryTimers.forEach(function(timer) {
      clearTimeout(timer);
    });
    speakingExpiryTimers.clear();
  });
})();
`;
}
