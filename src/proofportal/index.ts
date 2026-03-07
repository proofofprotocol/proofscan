/**
 * ProofPortal - Agent Communication Visualization
 * Phase 4: ProofPortal MVP
 *
 * Real-time visualization UI for ProofComm agent communication.
 * Consumes SSE events and provides read-only monitoring.
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
  updateState,
} from './types.js';

// Templates
export { renderDashboard, renderLayout, escapeHtml } from './templates/index.js';

// SSE Client script
export { getSseClientScript } from './sse-client.js';
