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
  getVisibilityBadge,
  truncateSpaceId,
  renderMemberBadge,
  renderSpaceCard,
  renderSpaceEmptyState,
  getSpaceViewStyles,
} from './SpaceView.js';
