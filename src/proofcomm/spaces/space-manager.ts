/**
 * ProofComm Space Manager
 * Phase 9.3: Autonomous Spaces
 *
 * Manages autonomous conversation spaces with event emission.
 * Uses G3 Representative Event pattern for broadcast operations.
 *
 * Key design decisions:
 * - createSpace auto-joins creator as moderator
 * - Membership uses soft delete (left_at) for re-join support
 * - Broadcast emits single 'message' event, individual deliveries have no audit
 */

import type { AuditLogger } from '../../gateway/audit.js';
import type {
  SpaceEntry,
  SpaceMembershipEntry,
  SpaceVisibility,
  MemberRole,
  A2AMessage,
} from '../../db/types.js';
import { SpacesStore, type CreateSpaceOptions, type UpdateSpaceOptions } from '../../db/spaces-store.js';
import {
  emitSpaceEvent,
  truncatePreview,
  extractMessageText,
  type ProofCommEventBaseOptions,
} from '../events.js';

// ==================== Error Types ====================

/**
 * Space operation error codes
 */
export type SpaceErrorCode =
  | 'SPACE_NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'NOT_MEMBER'
  | 'AGENT_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_OPERATION';

/**
 * Space operation error
 */
export interface SpaceError {
  code: SpaceErrorCode;
  message: string;
}

/**
 * Result type for space operations
 */
export type SpaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SpaceError };

// ==================== Broadcast Types ====================

/**
 * A2A Message parts for broadcast
 */
export interface MessagePart {
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * Request to broadcast a message to a space
 */
export interface SpaceBroadcastRequest {
  /** Space to broadcast to */
  spaceId: string;
  /** Agent sending the message */
  senderAgentId: string;
  /** A2A Message to broadcast */
  message: A2AMessage;
}

/**
 * Result of a space broadcast operation
 */
export interface BroadcastResult {
  spaceId: string;
  /** Number of agents to receive the message (excluding sender) */
  recipientCount: number;
  /** Number of successful deliveries */
  deliveredCount: number;
  /** Number of failed deliveries */
  failedCount: number;
  /** Details of failures (if any) */
  failures?: Array<{ agentId: string; error: string }>;
}

/**
 * Function to dispatch a message to an agent
 * This is provided by the caller (a2aProxy) to actually send messages
 */
export type DispatchToAgentFn = (
  agentId: string,
  message: A2AMessage,
) => Promise<{ success: boolean; error?: string }>;

// ==================== Space Manager ====================

/**
 * SpaceManager manages autonomous conversation spaces
 * with event emission and G3 broadcast support
 */
export class SpaceManager {
  constructor(
    private readonly spacesStore: SpacesStore,
    private readonly auditLogger: AuditLogger,
  ) {}

  // ==================== Space Management ====================

  /**
   * Create a new space
   * IMPORTANT: Automatically joins creator as moderator if creatorAgentId provided
   *
   * @param options - Space creation options
   * @param baseOptions - Event emission options
   * @returns SpaceResult with created SpaceEntry
   */
  createSpace(
    options: CreateSpaceOptions,
    baseOptions: ProofCommEventBaseOptions,
  ): SpaceResult<SpaceEntry> {
    // Create the space
    const space = this.spacesStore.create(options);

    // Auto-join creator as moderator (design decision: prevents "can't post to own space" bug)
    if (options.creatorAgentId) {
      this.spacesStore.join(space.spaceId, options.creatorAgentId, 'moderator');
    }

    // Emit created event
    emitSpaceEvent(
      this.auditLogger,
      'created',
      {
        space_id: space.spaceId,
        space_name: space.name,
        agent_id: options.creatorAgentId,
      },
      baseOptions,
    );

    return { ok: true, value: space };
  }

  /**
   * Get a space by ID
   */
  getSpace(spaceId: string): SpaceEntry | undefined {
    return this.spacesStore.get(spaceId);
  }

  /**
   * List all spaces, optionally filtered
   */
  listSpaces(options?: { visibility?: SpaceVisibility }): SpaceEntry[] {
    return this.spacesStore.list(options);
  }

  /**
   * Update a space
   * Emits 'updated' event for Portal consistency
   */
  updateSpace(
    spaceId: string,
    updates: UpdateSpaceOptions,
    baseOptions: ProofCommEventBaseOptions,
  ): SpaceResult<SpaceEntry> {
    const space = this.spacesStore.get(spaceId);
    if (!space) {
      return {
        ok: false,
        error: { code: 'SPACE_NOT_FOUND', message: `Space not found: ${spaceId}` },
      };
    }

    const updated = this.spacesStore.update(spaceId, updates);
    if (!updated) {
      // No fields to update (empty updates object)
      return { ok: true, value: space };
    }

    const updatedSpace = this.spacesStore.get(spaceId)!;

    // Emit updated event
    emitSpaceEvent(
      this.auditLogger,
      'updated',
      {
        space_id: spaceId,
        space_name: updatedSpace.name,
      },
      baseOptions,
    );

    return { ok: true, value: updatedSpace };
  }

  /**
   * Delete a space
   * Emits 'deleted' event for Portal consistency
   */
  deleteSpace(
    spaceId: string,
    baseOptions: ProofCommEventBaseOptions,
  ): SpaceResult<void> {
    const space = this.spacesStore.get(spaceId);
    if (!space) {
      return {
        ok: false,
        error: { code: 'SPACE_NOT_FOUND', message: `Space not found: ${spaceId}` },
      };
    }

    // Delete the space (cascade deletes memberships)
    this.spacesStore.remove(spaceId);

    // Emit deleted event
    emitSpaceEvent(
      this.auditLogger,
      'deleted',
      {
        space_id: spaceId,
        space_name: space.name,
      },
      baseOptions,
    );

    return { ok: true, value: undefined };
  }

  /**
   * Check if a space exists
   */
  spaceExists(spaceId: string): boolean {
    return this.spacesStore.exists(spaceId);
  }

  // ==================== Membership Management ====================

  /**
   * Join a space
   * Supports re-join after leave (clears left_at, updates joined_at)
   */
  joinSpace(
    spaceId: string,
    agentId: string,
    role: MemberRole = 'member',
    baseOptions: ProofCommEventBaseOptions,
  ): SpaceResult<void> {
    const space = this.spacesStore.get(spaceId);
    if (!space) {
      return {
        ok: false,
        error: { code: 'SPACE_NOT_FOUND', message: `Space not found: ${spaceId}` },
      };
    }

    const joined = this.spacesStore.join(spaceId, agentId, role);
    if (!joined) {
      return {
        ok: false,
        error: { code: 'ALREADY_MEMBER', message: `Agent ${agentId} is already a member of space ${spaceId}` },
      };
    }

    // Emit joined event
    emitSpaceEvent(
      this.auditLogger,
      'joined',
      {
        space_id: spaceId,
        space_name: space.name,
        agent_id: agentId,
      },
      baseOptions,
    );

    return { ok: true, value: undefined };
  }

  /**
   * Leave a space (soft delete)
   */
  leaveSpace(
    spaceId: string,
    agentId: string,
    baseOptions: ProofCommEventBaseOptions,
  ): SpaceResult<void> {
    const space = this.spacesStore.get(spaceId);
    if (!space) {
      return {
        ok: false,
        error: { code: 'SPACE_NOT_FOUND', message: `Space not found: ${spaceId}` },
      };
    }

    const left = this.spacesStore.leave(spaceId, agentId);
    if (!left) {
      return {
        ok: false,
        error: { code: 'NOT_MEMBER', message: `Agent ${agentId} is not an active member of space ${spaceId}` },
      };
    }

    // Emit left event
    emitSpaceEvent(
      this.auditLogger,
      'left',
      {
        space_id: spaceId,
        space_name: space.name,
        agent_id: agentId,
      },
      baseOptions,
    );

    return { ok: true, value: undefined };
  }

  /**
   * List members of a space
   */
  listMembers(spaceId: string, options?: { activeOnly?: boolean }): SpaceMembershipEntry[] {
    return this.spacesStore.listMembers(spaceId, options);
  }

  /**
   * Check if an agent is an active member
   */
  isMember(spaceId: string, agentId: string): boolean {
    return this.spacesStore.isMember(spaceId, agentId);
  }

  /**
   * Get active member agent IDs (for broadcast)
   */
  getActiveMembers(spaceId: string): string[] {
    return this.spacesStore.getActiveMembers(spaceId);
  }

  /**
   * Get member count
   */
  memberCount(spaceId: string): number {
    return this.spacesStore.memberCount(spaceId);
  }

  /**
   * Get member counts for multiple spaces in a single query (batch operation)
   */
  getMemberCounts(spaceIds: string[]): Map<string, number> {
    return this.spacesStore.getMemberCounts(spaceIds);
  }

  // ==================== G3 Broadcast ====================

  /**
   * Broadcast a message to all members of a space (G3 Representative Event)
   *
   * Flow:
   * 1. Validate space exists
   * 2. Validate sender is a member
   * 3. Get active members (excluding sender)
   * 4. Emit proofcomm_space (action: 'message') - ONE event only
   * 5. Dispatch to each recipient (with auditLevel: 'none')
   * 6. If failures: Emit proofcomm_space (action: 'delivery_failed') - ONE event only
   * 7. Return BroadcastResult
   *
   * @param request - Broadcast request with message
   * @param dispatchFn - Function to dispatch message to individual agents
   * @param baseOptions - Event emission options
   * @returns BroadcastResult
   */
  async broadcastToSpace(
    request: SpaceBroadcastRequest,
    dispatchFn: DispatchToAgentFn,
    baseOptions: ProofCommEventBaseOptions,
  ): Promise<SpaceResult<BroadcastResult>> {
    const { spaceId, senderAgentId, message } = request;

    // 1. Validate space exists
    const space = this.spacesStore.get(spaceId);
    if (!space) {
      return {
        ok: false,
        error: { code: 'SPACE_NOT_FOUND', message: `Space not found: ${spaceId}` },
      };
    }

    // 2. Validate sender is a member
    if (!this.spacesStore.isMember(spaceId, senderAgentId)) {
      return {
        ok: false,
        error: { code: 'NOT_MEMBER', message: `Sender ${senderAgentId} is not a member of space ${spaceId}` },
      };
    }

    // 3. Get active members (excluding sender)
    const allMembers = this.spacesStore.getActiveMembers(spaceId);
    const recipients = allMembers.filter(id => id !== senderAgentId);
    const recipientCount = recipients.length;

    // Create message preview for logging
    const messagePreview = message.parts
      ? truncatePreview(extractMessageText(message.parts), 100)
      : undefined;

    // 4. Emit G3 representative 'message' event (ONE event for the entire broadcast)
    emitSpaceEvent(
      this.auditLogger,
      'message',
      {
        space_id: spaceId,
        space_name: space.name,
        agent_id: senderAgentId,
        recipient_count: recipientCount,
        message_preview: messagePreview,
      },
      baseOptions,
    );

    // 5. Dispatch to all recipients concurrently (no individual audit - G3 pattern)
    const failures: Array<{ agentId: string; error: string }> = [];
    let deliveredCount = 0;

    // Use Promise.allSettled with error wrapping to preserve agentId on failures
    const dispatchResults = await Promise.allSettled(
      recipients.map(async (agentId): Promise<{ agentId: string; success: boolean; error?: string }> => {
        try {
          const result = await dispatchFn(agentId, message);
          return { agentId, success: result.success, error: result.error };
        } catch (err) {
          return {
            agentId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    for (const [index, settled] of dispatchResults.entries()) {
      // All promises should resolve (errors caught within), but handle rejection just in case
      if (settled.status === 'fulfilled') {
        const { agentId, success, error } = settled.value;
        if (success) {
          deliveredCount++;
        } else {
          failures.push({ agentId, error: error ?? 'Unknown error' });
        }
      } else {
        // Promise rejected despite inner try/catch - should not happen but handle gracefully
        const agentId = recipients[index];
        const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        failures.push({ agentId, error: error || 'Promise rejected unexpectedly' });
        console.warn(`[space-manager] Unexpected promise rejection for agent ${agentId}:`, settled.reason);
      }
    }

    const failedCount = failures.length;

    // 6. If failures: Emit G3 representative 'delivery_failed' event (ONE event)
    if (failedCount > 0) {
      emitSpaceEvent(
        this.auditLogger,
        'delivery_failed',
        {
          space_id: spaceId,
          space_name: space.name,
          failed_count: failedCount,
          recipient_count: recipientCount,
        },
        baseOptions,
      );
    }

    // 7. Return result
    return {
      ok: true,
      value: {
        spaceId,
        recipientCount,
        deliveredCount,
        failedCount,
        ...(failedCount > 0 && { failures }),
      },
    };
  }
}
