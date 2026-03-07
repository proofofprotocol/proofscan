/**
 * ProofPortal - SpaceView Component
 * Phase 4.5: Space visualization
 *
 * Displays autonomous spaces with:
 * - Member list with join/leave tracking
 * - Message count and activity
 * - G3 representative event display
 */

import { escapeHtml } from '../layout.js';

/**
 * Space member data
 */
export interface SpaceMemberData {
  agentId: string;
  isActive: boolean;
  joinedAt: number;
}

/**
 * Space display data
 *
 * Note: visibility field was removed as it's not currently available
 * from ProofComm events. Can be added back when Space metadata includes
 * visibility information.
 */
export interface SpaceDisplayData {
  spaceId: string;
  spaceName: string | null;
  members: SpaceMemberData[];
  memberCount: number;
  messageCount: number;
  lastActivityAt: number;
}

/**
 * Format member count with proper pluralization
 */
export function formatMemberCount(count: number): string {
  return count === 1 ? '1 member' : `${count} members`;
}

/**
 * Format message count with proper pluralization
 */
export function formatMessageCount(count: number): string {
  return count === 1 ? '1 message' : `${count} messages`;
}

// Note: getVisibilityBadge was removed as visibility is not currently
// available from ProofComm events. The function can be restored when
// Space metadata includes visibility information.

/**
 * Truncate space ID for display
 */
export function truncateSpaceId(spaceId: string): string {
  if (spaceId.length <= 12) return spaceId;
  return spaceId.slice(0, 8) + '…';
}

/**
 * Render a member avatar/badge
 */
export function renderMemberBadge(member: SpaceMemberData): string {
  const initial = member.agentId.charAt(0).toUpperCase();
  const activeClass = member.isActive ? 'active' : '';
  const shortId = member.agentId.slice(0, 8);

  return `
    <div class="member-badge ${activeClass}" title="${escapeHtml(member.agentId)}">
      <span class="member-avatar">${initial}</span>
      <span class="member-id">${escapeHtml(shortId)}</span>
    </div>
  `;
}

/**
 * Render a space card
 */
export function renderSpaceCard(space: SpaceDisplayData): string {
  const displayName = space.spaceName || truncateSpaceId(space.spaceId);
  const memberBadges = space.members
    .slice(0, 5)
    .map(m => renderMemberBadge(m))
    .join('');
  const moreMembers = space.memberCount > 5 ? `<span class="more-members">+${space.memberCount - 5}</span>` : '';

  return `
    <div class="space-card" data-space-id="${escapeHtml(space.spaceId)}">
      <div class="space-header">
        <div class="space-title">
          <span class="space-icon">🏠</span>
          <span class="space-name" title="${escapeHtml(space.spaceId)}">${escapeHtml(displayName)}</span>
        </div>
      </div>
      <div class="space-stats">
        <div class="space-stat">
          <span class="stat-label">Members</span>
          <span class="stat-value">${space.memberCount}</span>
        </div>
        <div class="space-stat">
          <span class="stat-label">Messages</span>
          <span class="stat-value">${space.messageCount}</span>
        </div>
      </div>
      <div class="space-members">
        ${memberBadges}
        ${moreMembers}
      </div>
      <div class="space-activity">
        <span class="activity-indicator ${space.messageCount > 0 ? 'active' : ''}"></span>
        <span class="activity-text">${space.messageCount > 0 ? 'Active' : 'Quiet'}</span>
      </div>
    </div>
  `;
}

/**
 * Render empty state for space view
 */
export function renderSpaceEmptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🏠</div>
      <div class="empty-state-text">No spaces yet</div>
      <div class="empty-state-hint">Spaces appear when agents join or send messages</div>
    </div>
  `;
}

/**
 * Get SpaceView-specific CSS styles
 */
export function getSpaceViewStyles(): string {
  return `
    /* Space view styles */
    .space-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
    }

    .space-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .space-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .space-icon {
      font-size: 16px;
    }

    .space-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .space-stats {
      display: flex;
      padding: 10px 12px;
      gap: 20px;
    }

    .space-stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .space-stat .stat-label {
      font-size: 10px;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    .space-stat .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--accent-blue);
    }

    .space-members {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
    }

    .member-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font-size: 11px;
    }

    .member-badge.active {
      border-color: var(--accent-green);
      background: rgba(63, 185, 80, 0.1);
    }

    .member-avatar {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--accent-purple);
      color: white;
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .member-id {
      font-family: monospace;
      color: var(--text-secondary);
    }

    .more-members {
      display: flex;
      align-items: center;
      padding: 3px 8px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .space-activity {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--text-secondary);
    }

    .activity-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-gray);
    }

    .activity-indicator.active {
      background: var(--accent-green);
      animation: pulse 2s infinite;
    }
  `;
}
