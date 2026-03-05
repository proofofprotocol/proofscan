/**
 * Spaces database store - manages autonomous conversation spaces
 * Phase 9.3: Autonomous Spaces
 *
 * Spaces are persistent conversation areas where multiple agents can communicate.
 * Memberships use soft delete (left_at) to preserve history and enable re-join.
 */

import { ulid } from 'ulid';
import { getEventsDb } from './connection.js';
import type {
  Space,
  SpaceEntry,
  SpaceMembership,
  SpaceMembershipEntry,
  SpaceVisibility,
  MemberRole,
} from './types.js';

/**
 * Options for creating a new space
 */
export interface CreateSpaceOptions {
  /** Space name (human-readable) */
  name: string;
  /** Optional description */
  description?: string;
  /** Visibility: 'public' or 'private' */
  visibility: SpaceVisibility;
  /** Whether to show in Portal UI (default: true) */
  portalVisible?: boolean;
  /** Agent ID that created this space (optional) */
  creatorAgentId?: string;
  /** Additional configuration as JSON-serializable object */
  config?: Record<string, unknown>;
}

/**
 * Options for updating a space
 */
export type UpdateSpaceOptions = Partial<Omit<CreateSpaceOptions, 'creatorAgentId'>>;

/**
 * Spaces store
 * Manages autonomous conversation spaces and their memberships
 */
export class SpacesStore {
  constructor(private readonly configDir?: string) {}

  private get db() {
    return getEventsDb(this.configDir);
  }

  /**
   * Convert a DB Space row to external SpaceEntry format
   */
  private toSpaceEntry(row: Space): SpaceEntry {
    let config: Record<string, unknown> | undefined;
    if (row.config_json) {
      try {
        config = JSON.parse(row.config_json);
      } catch {
        console.warn(`[spaces-store] Failed to parse config_json for space ${row.space_id}`);
      }
    }

    return {
      spaceId: row.space_id,
      name: row.name,
      ...(row.description != null && { description: row.description }),
      visibility: row.visibility,
      portalVisible: row.portal_visible === 1,
      createdAt: row.created_at,
      ...(row.updated_at != null && { updatedAt: row.updated_at }),
      ...(row.creator_agent_id != null && { creatorAgentId: row.creator_agent_id }),
      ...(config != null && { config }),
    };
  }

  /**
   * Convert a DB SpaceMembership row to external SpaceMembershipEntry format
   */
  private toMembershipEntry(row: SpaceMembership): SpaceMembershipEntry {
    return {
      spaceId: row.space_id,
      agentId: row.agent_id,
      role: row.role,
      joinedAt: row.joined_at,
      ...(row.left_at != null && { leftAt: row.left_at }),
    };
  }

  // ==================== Space CRUD ====================

  /**
   * Create a new space
   * @param options - Space creation options
   * @param overrideId - Optional ID to use (for testing)
   * @returns The created SpaceEntry
   */
  create(options: CreateSpaceOptions, overrideId?: string): SpaceEntry {
    const spaceId = overrideId ?? ulid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO spaces (
        space_id, name, description, visibility,
        portal_visible, created_at, creator_agent_id, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      spaceId,
      options.name,
      options.description ?? null,
      options.visibility,
      options.portalVisible !== false ? 1 : 0,
      now,
      options.creatorAgentId ?? null,
      options.config != null ? JSON.stringify(options.config) : null,
    );

    return this.get(spaceId)!;
  }

  /**
   * Get a space by ID
   * @returns SpaceEntry or undefined if not found
   */
  get(spaceId: string): SpaceEntry | undefined {
    const row = this.db.prepare(
      'SELECT * FROM spaces WHERE space_id = ?'
    ).get(spaceId) as Space | undefined;

    return row ? this.toSpaceEntry(row) : undefined;
  }

  /**
   * List all spaces, optionally filtered by visibility
   */
  list(options?: { visibility?: SpaceVisibility }): SpaceEntry[] {
    let rows: Space[];

    if (options?.visibility != null) {
      rows = this.db.prepare(`
        SELECT * FROM spaces
        WHERE visibility = ?
        ORDER BY created_at DESC
      `).all(options.visibility) as Space[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM spaces
        ORDER BY created_at DESC
      `).all() as Space[];
    }

    return rows.map(r => this.toSpaceEntry(r));
  }

  /**
   * Update a space
   * @returns true if updated, false if space not found
   */
  update(spaceId: string, updates: UpdateSpaceOptions): boolean {
    // Build SET clause dynamically based on provided fields
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.visibility !== undefined) {
      setClauses.push('visibility = ?');
      values.push(updates.visibility);
    }
    if (updates.portalVisible !== undefined) {
      setClauses.push('portal_visible = ?');
      values.push(updates.portalVisible ? 1 : 0);
    }
    if (updates.config !== undefined) {
      setClauses.push('config_json = ?');
      values.push(JSON.stringify(updates.config));
    }

    if (setClauses.length === 0) {
      return false;
    }

    // Always set updated_at when updating
    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(spaceId);

    const result = this.db.prepare(`
      UPDATE spaces SET ${setClauses.join(', ')} WHERE space_id = ?
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * Remove a space (cascade deletes memberships)
   * @returns true if deleted, false if space not found
   */
  remove(spaceId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM spaces WHERE space_id = ?'
    ).run(spaceId);
    return result.changes > 0;
  }

  /**
   * Check if a space exists
   */
  exists(spaceId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM spaces WHERE space_id = ?'
    ).get(spaceId);
    return row != null;
  }

  /**
   * Get total space count
   */
  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as n FROM spaces'
    ).get() as { n: number };
    return row.n;
  }

  // ==================== Membership ====================

  /**
   * Join a space (or re-join if previously left)
   *
   * State transitions:
   * - Not a member → INSERT (return true)
   * - Left (left_at != null) → UPDATE left_at=NULL, joined_at=now (return true)
   * - Already active (left_at = null) → no-op (return false)
   *
   * Uses INSERT OR IGNORE to reduce race conditions under concurrent requests.
   * Note: Two simultaneous re-join requests may still race on the UPDATE branch,
   * but this is acceptable for current load patterns.
   *
   * @param spaceId - Space to join
   * @param agentId - Agent joining
   * @param role - Membership role (default: 'member')
   * @returns true if joined/re-joined, false if already active member
   */
  join(spaceId: string, agentId: string, role: MemberRole = 'member'): boolean {
    const now = new Date().toISOString();

    // Try INSERT OR IGNORE first - handles new member case atomically
    const insertResult = this.db.prepare(`
      INSERT OR IGNORE INTO space_memberships (space_id, agent_id, role, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(spaceId, agentId, role, now);

    if (insertResult.changes > 0) {
      // Successfully inserted - new member
      return true;
    }

    // Row exists - check if it's a re-join case (left_at != null)
    const updateResult = this.db.prepare(`
      UPDATE space_memberships
      SET left_at = NULL, joined_at = ?, role = ?
      WHERE space_id = ? AND agent_id = ? AND left_at IS NOT NULL
    `).run(now, role, spaceId, agentId);

    // Returns true if re-joined (was left), false if already active
    return updateResult.changes > 0;
  }

  /**
   * Leave a space (soft delete: sets left_at)
   *
   * State transitions:
   * - Active (left_at = null) → UPDATE left_at=now (return true)
   * - Not a member or already left → no-op (return false)
   *
   * @param spaceId - Space to leave
   * @param agentId - Agent leaving
   * @returns true if left, false if not an active member
   */
  leave(spaceId: string, agentId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE space_memberships
      SET left_at = ?
      WHERE space_id = ? AND agent_id = ? AND left_at IS NULL
    `).run(now, spaceId, agentId);

    return result.changes > 0;
  }

  /**
   * Check if an agent is an active member of a space
   */
  isMember(spaceId: string, agentId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM space_memberships
      WHERE space_id = ? AND agent_id = ? AND left_at IS NULL
    `).get(spaceId, agentId);
    return row != null;
  }

  /**
   * List members of a space
   * @param spaceId - Space ID
   * @param options - Filter options
   * @param options.activeOnly - If true, only return active members (left_at IS NULL). Default: true
   * @returns Array of membership entries
   */
  listMembers(spaceId: string, options?: { activeOnly?: boolean }): SpaceMembershipEntry[] {
    const activeOnly = options?.activeOnly !== false;

    let rows: SpaceMembership[];
    if (activeOnly) {
      rows = this.db.prepare(`
        SELECT * FROM space_memberships
        WHERE space_id = ? AND left_at IS NULL
        ORDER BY joined_at ASC
      `).all(spaceId) as SpaceMembership[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM space_memberships
        WHERE space_id = ?
        ORDER BY joined_at ASC
      `).all(spaceId) as SpaceMembership[];
    }

    return rows.map(r => this.toMembershipEntry(r));
  }

  /**
   * Get list of active member agent IDs for a space
   * Used for broadcast operations
   */
  getActiveMembers(spaceId: string): string[] {
    const rows = this.db.prepare(`
      SELECT agent_id FROM space_memberships
      WHERE space_id = ? AND left_at IS NULL
    `).all(spaceId) as { agent_id: string }[];

    return rows.map(r => r.agent_id);
  }

  /**
   * Update a member's role
   * @returns true if updated, false if not an active member
   */
  updateRole(spaceId: string, agentId: string, role: MemberRole): boolean {
    const result = this.db.prepare(`
      UPDATE space_memberships
      SET role = ?
      WHERE space_id = ? AND agent_id = ? AND left_at IS NULL
    `).run(role, spaceId, agentId);

    return result.changes > 0;
  }

  /**
   * Get count of active members in a space
   */
  memberCount(spaceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as n FROM space_memberships
      WHERE space_id = ? AND left_at IS NULL
    `).get(spaceId) as { n: number };
    return row.n;
  }

  /**
   * Get member counts for multiple spaces in a single query (batch operation)
   * Returns a Map from spaceId to member count
   */
  getMemberCounts(spaceIds: string[]): Map<string, number> {
    if (spaceIds.length === 0) {
      return new Map();
    }

    const placeholders = spaceIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT space_id, COUNT(*) as n FROM space_memberships
      WHERE space_id IN (${placeholders}) AND left_at IS NULL
      GROUP BY space_id
    `).all(...spaceIds) as Array<{ space_id: string; n: number }>;

    const result = new Map<string, number>();
    // Initialize all requested space IDs to 0 (in case they have no members)
    for (const spaceId of spaceIds) {
      result.set(spaceId, 0);
    }
    // Update with actual counts
    for (const row of rows) {
      result.set(row.space_id, row.n);
    }
    return result;
  }

  /**
   * Get a specific membership entry (regardless of active/left status)
   *
   * Note: This returns the membership record even if the agent has left (left_at != null).
   * Use `isMember()` to check if an agent is an active member.
   *
   * @returns Membership entry or undefined if never joined
   */
  getMembership(spaceId: string, agentId: string): SpaceMembershipEntry | undefined {
    const row = this.db.prepare(`
      SELECT * FROM space_memberships
      WHERE space_id = ? AND agent_id = ?
    `).get(spaceId, agentId) as SpaceMembership | undefined;

    return row ? this.toMembershipEntry(row) : undefined;
  }
}
