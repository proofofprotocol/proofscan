/**
 * ProofPortal - Agent Communication Visualization
 * Phase 5: ProofGuild
 *
 * Real-time visualization UI for ProofComm agent communication.
 * Consumes SSE events and provides read-only monitoring.
 * Displays agents as Guild members with roles, levels, and visual states.
 *
 * Usage:
 *   import { registerPortalRoutes } from './proofportal/index.js';
 *   registerPortalRoutes(fastify);
 *
 * Access:
 *   http://localhost:8080/portal
 */

// Route registration
export { registerPortalRoutes, type PortalRoutesOptions } from './routes.js';

// Types
export {
  // Portal types
  type PortalState,
  type ThreadState,
  type SpaceState,
  type AgentState,
  type PortalEventDisplay,
  type PortalSseEvent,
  type ProofCommMetadata,
  type ProofCommAction,
  PROOFCOMM_EVENT_KINDS,
  createInitialState,
  toDisplayEvent,
  applyEvent,
  // Guild types (Phase 5)
  type GuildRole,
  type GuildVisualState,
  type GuildMembershipStatus,
  type GuildMember,
  type GuildSpaceRoom,
  type GuildState,
  // Guild helpers
  calcLevel,
  getVisualState,
  getMembershipStatus,
  getGuildRole,
  toGuildMember,
  deriveGuildState,
  SPEAKING_THRESHOLD_MS,
  ACTIVE_THRESHOLD_MS,
} from './types.js';

// Templates
export { renderDashboard, renderLayout, escapeHtml } from './templates/index.js';

// SSE Client script
export { getSseClientScript } from './sse-client.js';
