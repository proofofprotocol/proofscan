/**
 * ProofPortal - Type definitions
 * Phase 5: ProofGuild
 *
 * State management types for real-time agent communication visualization.
 * State keys follow vault 3040 specification: trace_id / space_id / agent_id
 *
 * ProofGuild extends ProofPortal to treat agents as guild members with
 * roles, levels, and visual states.
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
  | 'resolved' | 'dispatched'
  // guild (Phase 5)
  | 'registered';

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

// ============================================================================
// Guild Types (Phase 5: ProofGuild)
// ============================================================================

/**
 * Guild role derived from Space membership
 */
export type GuildRole =
  | 'moderator'   // Space moderator
  | 'member'      // Space member
  | 'observer'    // Space observer
  | 'visitor';    // No space membership

/**
 * Visual state for guild members
 */
export type GuildVisualState =
  | 'speaking'    // Message within last 10 seconds
  | 'active'      // Event within last 60 seconds
  | 'idle';       // Otherwise

/**
 * Membership status for guild members
 * Note: 'joined' is used instead of 'member' to avoid confusion with GuildRole
 */
export type GuildMembershipStatus =
  | 'active'      // Recent events (UI: "Active")
  | 'joined'      // Space membership (UI: "Joined")
  | 'candidate';  // Registered only (UI: "Candidate")

/**
 * Guild member representation for UI
 */
export interface GuildMember {
  agentId: string;
  /** Display name (agent_name from events, or agentId as fallback) */
  name: string;
  role: GuildRole;
  membershipStatus: GuildMembershipStatus;
  /** Session-only level (resets on page reload) */
  level: number;
  /** Session-only experience points */
  experience: number;
  /** Current space (last join/message space) */
  currentSpaceId?: string;
  currentSpaceName?: string;
  visualState: GuildVisualState;
  /** Truncated to 40 chars for bubble display */
  lastMessagePreview?: string;
  lastActiveAt?: number;
  eventCount: number;
}

/**
 * Space as a Guild "room" for visualization
 */
export interface GuildSpaceRoom {
  spaceId: string;
  spaceName: string;
  /** Agent IDs currently in this room */
  memberIds: string[];
}

/**
 * Guild derived state (computed from PortalState)
 */
export interface GuildState {
  members: Map<string, GuildMember>;
  rooms: Map<string, GuildSpaceRoom>;
}

// ============================================================================
// Portal Event Types
// ============================================================================

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
  /** Metadata from source event, or minimal fallback if source had none */
  metadata: Partial<ProofCommMetadata> & { action: ProofCommAction };
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
 * Extended in Phase 5 for Guild support
 */
export interface AgentState {
  agentId: string;
  traceIds: Set<string>;
  spaceIds: Set<string>;
  eventCount: number;
  lastSeenAt: number;
  // Phase 5: Guild fields
  /** Agent name from event metadata */
  name?: string;
  /** Last message preview for bubble display */
  lastMessagePreview?: string;
  /** Timestamp of last message (for speaking state) */
  lastMessageAt?: number;
  /** Current space ID (last join/message space) */
  currentSpaceId?: string;
  /** Current space name */
  currentSpaceName?: string;
  /** Session XP (not persisted) */
  experience: number;
}

/**
 * Portal state root
 *
 * Note: Guild state is not stored here. Use deriveGuildState() as a pure
 * projection function when guild data is needed. This avoids stale state
 * since deriveGuildState computes the guild view from current agents/spaces.
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
 * Apply event to state (mutates state in place)
 *
 * This function intentionally mutates the state object for performance.
 * The Maps and Sets are updated in place rather than creating new copies.
 *
 * @param state - Portal state to mutate
 * @param event - SSE event to apply
 */
export function applyEvent(state: PortalState, event: PortalSseEvent): void {
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
      experience: 0,
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

  // Phase 5: Guild fields
  // Extract agent_name from metadata
  const metadata = event.metadata;
  if (metadata?.agent_name) {
    agent.name = metadata.agent_name;
  }

  // Track currentSpaceId based on join/message/left
  if (display.action === 'joined' && display.spaceId) {
    agent.currentSpaceId = display.spaceId;
    agent.currentSpaceName = display.spaceName ?? undefined;
    agent.experience += 2; // XP for joining
  } else if (display.action === 'message' && display.spaceId) {
    agent.currentSpaceId = display.spaceId;
    agent.currentSpaceName = display.spaceName ?? undefined;
    agent.lastMessagePreview = display.preview
      ? display.preview.slice(0, 40)
      : undefined;
    agent.lastMessageAt = now;
    agent.experience += 5; // XP for message
  } else if (display.action === 'left' && display.spaceId) {
    // Clear currentSpaceId if leaving current space
    if (agent.currentSpaceId === display.spaceId) {
      agent.currentSpaceId = undefined;
      agent.currentSpaceName = undefined;
    }
  } else if (display.action === 'match') {
    agent.experience += 10; // XP for skill match
  } else if (display.action === 'context_updated') {
    agent.experience += 8; // XP for document context update
  } else if (display.action === 'dispatched') {
    agent.experience += 6; // XP for route dispatch
  } else if (display.action === 'registered') {
    agent.experience += 3; // XP for guild registration
  }

  // Update global state
  state.lastEventTs = now;
  state.eventCount++;
}

// ============================================================================
// Guild Helper Functions
// ============================================================================

/**
 * Calculate level from XP
 * Level 1 at 0 XP, Level 2 at 10 XP, etc.
 */
export function calcLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 10)) + 1;
}

/** Speaking threshold: 10 seconds */
export const SPEAKING_THRESHOLD_MS = 10_000;
/** Active threshold: 60 seconds */
export const ACTIVE_THRESHOLD_MS = 60_000;

/**
 * Determine visual state based on timestamps
 */
export function getVisualState(
  lastMessageAt: number | undefined,
  lastSeenAt: number,
  now: number
): GuildVisualState {
  if (lastMessageAt && now - lastMessageAt < SPEAKING_THRESHOLD_MS) {
    return 'speaking';
  }
  if (now - lastSeenAt < ACTIVE_THRESHOLD_MS) {
    return 'active';
  }
  return 'idle';
}

/**
 * Determine membership status based on activity and space membership
 */
export function getMembershipStatus(
  agent: AgentState,
  now: number
): GuildMembershipStatus {
  if (now - agent.lastSeenAt < ACTIVE_THRESHOLD_MS) {
    return 'active';
  }
  if (agent.spaceIds.size > 0) {
    return 'joined';
  }
  return 'candidate';
}

/**
 * Get highest role from space membership
 * For MVP, we return 'member' for any space membership.
 */
export function getGuildRole(agent: AgentState): GuildRole {
  if (agent.spaceIds.size === 0) {
    return 'visitor';
  }
  // For MVP, assume 'member' role for any space membership
  // Full role tracking would require storing membership role in SpaceState
  return 'member';
}

/**
 * Derive GuildMember from AgentState
 */
export function toGuildMember(
  agent: AgentState,
  now: number
): GuildMember {
  return {
    agentId: agent.agentId,
    name: agent.name ?? agent.agentId,
    role: getGuildRole(agent),
    membershipStatus: getMembershipStatus(agent, now),
    level: calcLevel(agent.experience),
    experience: agent.experience,
    currentSpaceId: agent.currentSpaceId,
    currentSpaceName: agent.currentSpaceName,
    visualState: getVisualState(agent.lastMessageAt, agent.lastSeenAt, now),
    lastMessagePreview: agent.lastMessagePreview,
    lastActiveAt: agent.lastSeenAt,
    eventCount: agent.eventCount,
  };
}

/**
 * Derive full GuildState from PortalState
 */
export function deriveGuildState(state: PortalState, now: number): GuildState {
  const members = new Map<string, GuildMember>();
  const rooms = new Map<string, GuildSpaceRoom>();

  // Derive members from agents
  for (const agent of state.agents.values()) {
    members.set(agent.agentId, toGuildMember(agent, now));
  }

  // Derive rooms from spaces
  for (const space of state.spaces.values()) {
    const memberIds: string[] = [];
    // Find agents whose currentSpaceId matches this space
    for (const member of members.values()) {
      if (member.currentSpaceId === space.spaceId) {
        memberIds.push(member.agentId);
      }
    }
    rooms.set(space.spaceId, {
      spaceId: space.spaceId,
      spaceName: space.spaceName ?? space.spaceId,
      memberIds,
    });
  }

  return { members, rooms };
}
