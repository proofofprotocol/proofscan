/**
 * ProofPortal - Component exports
 * Phase 4: ProofPortal MVP
 */

// AgentList
export {
  type AgentDisplayData,
  formatRelativeTime,
  truncateAgentId,
  getActivityClass,
  renderAgentItem,
  renderAgentEmptyState,
  getAgentListStyles,
} from './AgentList.js';

// ThreadPanel
export {
  type ThreadEventData,
  type ThreadDisplayData,
  formatTimestamp,
  formatDuration,
  getActionClass,
  getEventKindIcon,
  truncateTraceId,
  renderThreadEvent,
  renderThreadCard,
  renderThreadEmptyState,
  getThreadPanelStyles,
} from './ThreadPanel.js';

// SpaceView
export {
  type SpaceMemberData,
  type SpaceDisplayData,
  formatMemberCount,
  formatMessageCount,
  truncateSpaceId,
  renderMemberBadge,
  renderSpaceCard,
  renderSpaceEmptyState,
  getSpaceViewStyles,
} from './SpaceView.js';

// GuildPanel (Phase 5)
export {
  type GuildMemberDisplayData,
  truncateGuildId,
  getVisualStateClass,
  formatMembershipStatus,
  formatLevel,
  renderGuildMemberCard,
  renderGuildEmptyState,
  getGuildPanelStyles,
} from './GuildPanel.js';

// GuildMap (Phase 5)
export {
  type RoomMemberData,
  type RoomDisplayData,
  getMapVisualStateClass,
  formatMapLevel,
  truncateSpaceIdForRoom,
  renderRoomMember,
  renderRoomCard,
  renderGuildMapEmptyState,
  getGuildMapStyles,
} from './GuildMap.js';
