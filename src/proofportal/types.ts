/**
 * ProofPortal - Type definitions
 * Phase 4: ProofPortal MVP
 *
 * State management types for real-time agent communication visualization.
 * State keys follow vault 3040 specification: trace_id / space_id / agent_id
 */

import type { GatewayEventKind } from '../db/types.js';

/**
 * ProofComm event kinds that Portal observes
 */
export const PROOFCOMM_EVENT_KINDS: GatewayEventKind[] = [
  'proofcomm_space',
  'proofcomm_skill',
  'proofcomm_document',
  'proofcomm_route',
];

/**
 * ProofComm action types (from events.ts)
 */
export type ProofCommAction =
  // space
  | 'created' | 'joined' | 'left' | 'message' | 'delivery_failed' | 'updated' | 'deleted'
  // skill
  | 'search' | 'match'
  // document
  | 'activated' | 'deactivated' | 'context_updated'
  // route
  | 'resolved' | 'dispatched';

/**
 * SSE event data received from Gateway
 */
export interface PortalSseEvent {
  event_kind: GatewayEventKind;
  client_id: string;
  ts: number;
  request_id: string;
  trace_id?: string | null;
  target_id?: string | null;
  method?: string | null;
  metadata?: ProofCommMetadata | null;
}

/**
 * ProofComm metadata from SSE events
 */
export interface ProofCommMetadata {
  action: ProofCommAction;
  space_id?: string;
  space_name?: string;
  agent_id?: string;
  agent_name?: string;
  doc_target_id?: string;
  doc_path?: string;
  skill_id?: string;
  skill_name?: string;
  match_score?: number;
  message_id?: string;
  message_preview?: string;
  task_id?: string;
  recipient_count?: number;
  failed_count?: number;
}

/**
 * Display-friendly event for UI rendering
 */
export interface PortalEventDisplay {
  id: string;
  eventKind: GatewayEventKind;
  action: ProofCommAction;
  timestamp: number;
  traceId: string | null;
  clientId: string;
  agentId: string | null;
  spaceId: string | null;
  spaceName: string | null;
  preview: string | null;
  metadata: ProofCommMetadata;
}

/**
 * Thread state - events grouped by trace_id
 */
export interface ThreadState {
  traceId: string;
  events: PortalEventDisplay[];
  participants: Set<string>;  // agent_ids
  startedAt: number;
  lastActivityAt: number;
}

/**
 * Space state - events grouped by space_id
 */
export interface SpaceState {
  spaceId: string;
  spaceName: string | null;
  members: Set<string>;  // agent_ids (from join/leave events)
  events: PortalEventDisplay[];
  messageCount: number;
  lastActivityAt: number;
}

/**
 * Agent state - activity grouped by agent_id
 */
export interface AgentState {
  agentId: string;
  traceIds: Set<string>;
  spaceIds: Set<string>;
  eventCount: number;
  lastSeenAt: number;
}

/**
 * Portal state root
 */
export interface PortalState {
  /** Events grouped by trace_id */
  threads: Map<string, ThreadState>;
  /** Events grouped by space_id */
  spaces: Map<string, SpaceState>;
  /** Activity grouped by agent_id */
  agents: Map<string, AgentState>;
  /** SSE connection status */
  connected: boolean;
  /** Last received event timestamp */
  lastEventTs: number;
  /** Total event count */
  eventCount: number;
}

/**
 * Create initial empty state
 */
export function createInitialState(): PortalState {
  return {
    threads: new Map(),
    spaces: new Map(),
    agents: new Map(),
    connected: false,
    lastEventTs: 0,
    eventCount: 0,
  };
}

/**
 * Convert SSE event to display format
 */
export function toDisplayEvent(event: PortalSseEvent): PortalEventDisplay {
  const metadata = event.metadata ?? { action: 'message' as ProofCommAction };
  return {
    id: event.request_id,
    eventKind: event.event_kind,
    action: metadata.action,
    timestamp: event.ts,
    traceId: event.trace_id ?? null,
    clientId: event.client_id,
    agentId: metadata.agent_id ?? null,
    spaceId: metadata.space_id ?? null,
    spaceName: metadata.space_name ?? null,
    preview: metadata.message_preview ?? null,
    metadata,
  };
}

/**
 * Update state with a new event
 */
export function updateState(state: PortalState, event: PortalSseEvent): PortalState {
  const display = toDisplayEvent(event);
  const now = event.ts;

  // Update thread state
  if (display.traceId) {
    let thread = state.threads.get(display.traceId);
    if (!thread) {
      thread = {
        traceId: display.traceId,
        events: [],
        participants: new Set(),
        startedAt: now,
        lastActivityAt: now,
      };
      state.threads.set(display.traceId, thread);
    }
    thread.events.push(display);
    thread.lastActivityAt = now;
    if (display.agentId) {
      thread.participants.add(display.agentId);
    }
  }

  // Update space state
  if (display.spaceId) {
    let space = state.spaces.get(display.spaceId);
    if (!space) {
      space = {
        spaceId: display.spaceId,
        spaceName: display.spaceName,
        members: new Set(),
        events: [],
        messageCount: 0,
        lastActivityAt: now,
      };
      state.spaces.set(display.spaceId, space);
    }
    space.events.push(display);
    space.lastActivityAt = now;
    if (display.spaceName) {
      space.spaceName = display.spaceName;
    }

    // Track membership changes
    if (display.action === 'joined' && display.agentId) {
      space.members.add(display.agentId);
    } else if (display.action === 'left' && display.agentId) {
      space.members.delete(display.agentId);
    } else if (display.action === 'message') {
      space.messageCount++;
    }
  }

  // Update agent state
  const agentId = display.agentId ?? display.clientId;
  let agent = state.agents.get(agentId);
  if (!agent) {
    agent = {
      agentId,
      traceIds: new Set(),
      spaceIds: new Set(),
      eventCount: 0,
      lastSeenAt: now,
    };
    state.agents.set(agentId, agent);
  }
  agent.eventCount++;
  agent.lastSeenAt = now;
  if (display.traceId) {
    agent.traceIds.add(display.traceId);
  }
  if (display.spaceId) {
    agent.spaceIds.add(display.spaceId);
  }

  // Update global state
  state.lastEventTs = now;
  state.eventCount++;

  return state;
}
