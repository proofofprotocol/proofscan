/**
 * ProofPortal - GuildPanel Component
 * Phase 5: ProofGuild
 *
 * Displays guild members with:
 * - Name and level
 * - Visual state (speaking/active/idle)
 * - Membership status
 * - Agent ID (for debugging)
 * - Last message preview bubble
 */

import { escapeHtml } from '../layout.js';
import type { GuildVisualState, GuildMembershipStatus } from '../../types.js';

/**
 * Guild member display data
 */
export interface GuildMemberDisplayData {
  agentId: string;
  name: string;
  level: number;
  experience: number;
  visualState: GuildVisualState;
  membershipStatus: GuildMembershipStatus;
  lastMessagePreview?: string;
  currentSpaceName?: string;
}

/**
 * Truncate agent ID for display
 */
export function truncateGuildId(id: string, maxLen: number = 16): string {
  if (id.length <= maxLen) {
    return id;
  }
  return id.slice(0, maxLen - 3) + '...';
}

/**
 * Get visual state CSS class
 */
export function getVisualStateClass(state: GuildVisualState): string {
  return `visual-state-${state}`;
}

/**
 * Format membership status for display
 */
export function formatMembershipStatus(status: GuildMembershipStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'joined':
      return 'Joined';
    case 'candidate':
      return 'Candidate';
    default:
      return status;
  }
}

/**
 * Format level for display
 */
export function formatLevel(level: number): string {
  return `Lv.${level}`;
}

/**
 * Render a guild member card
 */
export function renderGuildMemberCard(member: GuildMemberDisplayData): string {
  const initial = member.name.charAt(0).toUpperCase();
  const displayId = truncateGuildId(member.agentId);
  const statusClass = member.membershipStatus;
  const isSpeaking = member.visualState === 'speaking';

  return `
    <div class="guild-member ${getVisualStateClass(member.visualState)}" data-agent-id="${escapeHtml(member.agentId)}">
      <div class="guild-member-avatar">${initial}</div>
      <div class="guild-member-info">
        <div class="guild-member-name">${escapeHtml(member.name)}</div>
        <div class="guild-member-meta">
          <span class="guild-member-level" title="Session Level (XP: ${member.experience})">Session ${formatLevel(member.level)}</span>
          <span class="guild-member-status ${statusClass}">${formatMembershipStatus(member.membershipStatus)}</span>
        </div>
        <div class="guild-member-id" title="${escapeHtml(member.agentId)}">${escapeHtml(displayId)}</div>
      </div>
      ${isSpeaking && member.lastMessagePreview ? `<div class="guild-member-bubble">${escapeHtml(member.lastMessagePreview)}</div>` : ''}
    </div>
  `;
}

/**
 * Render empty state for guild panel
 */
export function renderGuildEmptyState(): string {
  return `
    <div class="guild-empty">
      <div class="guild-empty-icon">⚔️</div>
      <div class="guild-empty-text">No guild members yet</div>
      <div class="guild-empty-hint">Members will appear when agents join spaces</div>
    </div>
  `;
}

/**
 * Get GuildPanel-specific CSS styles
 */
export function getGuildPanelStyles(): string {
  return `
    /* Guild panel container */
    .guild-panel-content {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
    }

    /* Guild member card */
    .guild-member {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg-secondary);
      border-radius: 8px;
      border-left: 3px solid var(--border-color);
      min-width: 220px;
      max-width: 300px;
      transition: border-color 0.2s, background 0.2s;
      position: relative;
    }

    /* Visual states */
    .guild-member.visual-state-speaking {
      border-left-color: var(--accent-green);
      background: rgba(63, 185, 80, 0.08);
    }

    .guild-member.visual-state-active {
      border-left-color: var(--accent-blue);
      background: rgba(88, 166, 255, 0.05);
    }

    .guild-member.visual-state-idle {
      border-left-color: var(--accent-gray);
      opacity: 0.7;
    }

    /* Avatar */
    .guild-member-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--accent-purple);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .guild-member.visual-state-speaking .guild-member-avatar {
      background: var(--accent-green);
      box-shadow: 0 0 8px rgba(63, 185, 80, 0.5);
    }

    .guild-member.visual-state-active .guild-member-avatar {
      background: var(--accent-blue);
    }

    .guild-member.visual-state-idle .guild-member-avatar {
      background: var(--accent-gray);
    }

    /* Info section */
    .guild-member-info {
      flex: 1;
      min-width: 0;
    }

    .guild-member-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .guild-member-meta {
      display: flex;
      gap: 8px;
      margin-top: 3px;
      font-size: 11px;
    }

    .guild-member-level {
      color: var(--accent-yellow);
      font-weight: 500;
    }

    .guild-member-status {
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .guild-member-status.active {
      background: rgba(63, 185, 80, 0.2);
      color: var(--accent-green);
    }

    .guild-member-status.joined {
      background: rgba(88, 166, 255, 0.2);
      color: var(--accent-blue);
    }

    .guild-member-status.candidate {
      background: rgba(139, 148, 158, 0.2);
      color: var(--accent-gray);
    }

    .guild-member-id {
      margin-top: 2px;
      font-size: 9px;
      color: var(--text-tertiary);
      font-family: monospace;
      opacity: 0.7;
    }

    /* Message bubble */
    .guild-member-bubble {
      position: absolute;
      top: -8px;
      right: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 10px;
      color: var(--text-secondary);
      max-width: 160px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      animation: bubbleAppear 0.3s ease-out;
    }

    @keyframes bubbleAppear {
      from {
        opacity: 0;
        transform: translateY(5px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .guild-member.visual-state-speaking .guild-member-bubble {
      background: var(--accent-green);
      color: white;
      border-color: var(--accent-green);
    }

    /* Empty state */
    .guild-empty {
      text-align: center;
      padding: 24px;
      color: var(--text-secondary);
    }

    .guild-empty-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .guild-empty-text {
      font-size: 14px;
      font-weight: 500;
    }

    .guild-empty-hint {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }
  `;
}
