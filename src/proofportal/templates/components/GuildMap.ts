/**
 * ProofPortal - GuildMap Component
 * Phase 5: ProofGuild
 *
 * Displays spaces as "rooms" with agents inside:
 * - Lobby for agents without currentSpaceId
 * - Room for each space with members
 * - Visual state indicators
 * - Speaking bubbles
 */

import { escapeHtml } from '../layout.js';
import type { GuildVisualState } from '../../types.js';

/**
 * Room member display data
 */
export interface RoomMemberData {
  agentId: string;
  name: string;
  level: number;
  visualState: GuildVisualState;
  lastMessagePreview?: string;
}

/**
 * Room display data
 */
export interface RoomDisplayData {
  spaceId: string;
  spaceName: string;
  isLobby: boolean;
  members: RoomMemberData[];
}

/**
 * Get visual state class for map member
 */
export function getMapVisualStateClass(state: GuildVisualState): string {
  return `visual-state-${state}`;
}

/**
 * Format level for map display
 */
export function formatMapLevel(level: number): string {
  return `Lv.${level}`;
}

/**
 * Truncate space ID for room header
 */
export function truncateSpaceIdForRoom(id: string, maxLen: number = 12): string {
  if (id.length <= maxLen) {
    return id;
  }
  return id.slice(0, maxLen - 3) + '...';
}

/**
 * Render a room member (agent icon)
 */
export function renderRoomMember(member: RoomMemberData): string {
  const initial = member.name.charAt(0).toUpperCase();
  const isSpeaking = member.visualState === 'speaking';

  return `
    <div class="guild-map-member ${getMapVisualStateClass(member.visualState)}"
         data-agent-id="${escapeHtml(member.agentId)}"
         title="${escapeHtml(member.name)} (${formatMapLevel(member.level)})">
      <div class="guild-map-member-avatar">${initial}</div>
      <div class="guild-map-member-name">${escapeHtml(member.name)}</div>
      ${isSpeaking && member.lastMessagePreview ? `<div class="guild-map-bubble">${escapeHtml(member.lastMessagePreview)}</div>` : ''}
    </div>
  `;
}

/**
 * Render a room card
 */
export function renderRoomCard(room: RoomDisplayData): string {
  const roomIcon = room.isLobby ? '🏠' : '🚪';
  const memberCount = room.members.length;
  const membersHtml = room.members.map(renderRoomMember).join('');

  return `
    <div class="guild-map-room ${room.isLobby ? 'lobby' : ''}" data-space-id="${escapeHtml(room.spaceId)}">
      <div class="guild-map-room-header">
        <span class="guild-map-room-icon">${roomIcon}</span>
        <span class="guild-map-room-name">${escapeHtml(room.spaceName)}</span>
        <span class="guild-map-room-count">${memberCount}</span>
      </div>
      <div class="guild-map-room-members">
        ${membersHtml || '<div class="guild-map-room-empty">Empty</div>'}
      </div>
    </div>
  `;
}

/**
 * Render empty state for guild map
 */
export function renderGuildMapEmptyState(): string {
  return `
    <div class="guild-map-empty">
      <div class="guild-map-empty-icon">🗺️</div>
      <div class="guild-map-empty-text">No rooms yet</div>
      <div class="guild-map-empty-hint">Rooms appear when spaces are created</div>
    </div>
  `;
}

/**
 * Get GuildMap-specific CSS styles
 */
export function getGuildMapStyles(): string {
  return `
    /* Guild map container */
    .guild-map-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px;
      min-height: 200px;
    }

    /* Room card */
    .guild-map-room {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .guild-map-room.lobby {
      border-color: var(--accent-yellow);
      background: rgba(210, 153, 34, 0.05);
    }

    .guild-map-room-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .guild-map-room.lobby .guild-map-room-header {
      background: rgba(210, 153, 34, 0.1);
    }

    .guild-map-room-icon {
      font-size: 14px;
    }

    .guild-map-room-name {
      flex: 1;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .guild-map-room-count {
      background: var(--bg-primary);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    /* Room members area */
    .guild-map-room-members {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px;
      min-height: 60px;
    }

    .guild-map-room-empty {
      color: var(--text-tertiary);
      font-size: 11px;
      font-style: italic;
      width: 100%;
      text-align: center;
      padding: 8px;
    }

    /* Room member (agent) */
    .guild-map-member {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 8px;
      border-radius: 8px;
      cursor: default;
      position: relative;
      transition: background 0.2s;
    }

    .guild-map-member:hover {
      background: var(--bg-tertiary);
    }

    .guild-map-member-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--accent-purple);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      transition: box-shadow 0.2s;
    }

    /* Visual states for map members */
    .guild-map-member.visual-state-speaking .guild-map-member-avatar {
      background: var(--accent-green);
      box-shadow: 0 0 12px rgba(63, 185, 80, 0.6);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .guild-map-member.visual-state-active .guild-map-member-avatar {
      background: var(--accent-blue);
      box-shadow: 0 0 6px rgba(88, 166, 255, 0.4);
    }

    .guild-map-member.visual-state-idle .guild-map-member-avatar {
      background: var(--accent-gray);
      opacity: 0.6;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }

    .guild-map-member-name {
      font-size: 10px;
      color: var(--text-secondary);
      max-width: 60px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
    }

    /* Speaking bubble in map */
    .guild-map-bubble {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 8px;
      background: var(--accent-green);
      color: white;
      padding: 6px 10px;
      border-radius: 12px;
      font-size: 10px;
      max-width: 120px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      z-index: 10;
    }

    .guild-map-bubble::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: var(--accent-green);
    }

    /* Empty state */
    .guild-map-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      color: var(--text-secondary);
      min-height: 200px;
    }

    .guild-map-empty-icon {
      font-size: 40px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .guild-map-empty-text {
      font-size: 14px;
      font-weight: 500;
    }

    .guild-map-empty-hint {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }
  `;
}
