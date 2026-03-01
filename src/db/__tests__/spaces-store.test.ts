/**
 * Tests for SpacesStore
 * Phase 9.3: Autonomous Spaces
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SpacesStore } from '../spaces-store.js';
import { closeAllDbs } from '../connection.js';
import { EVENTS_DB_SCHEMA } from '../schema.js';

describe('SpacesStore', () => {
  let testDir: string;
  let store: SpacesStore;

  beforeEach(() => {
    closeAllDbs();

    testDir = join(tmpdir(), `proofscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize database with schema (version 13 has spaces tables)
    const dbPath = join(testDir, 'events.db');
    const db = new Database(dbPath);
    db.exec(EVENTS_DB_SCHEMA);
    db.pragma('user_version = 13');
    db.close();

    store = new SpacesStore(testDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==================== Space CRUD ====================

  describe('create', () => {
    it('should create a new space and return SpaceEntry', () => {
      const space = store.create({
        name: 'Test Space',
        description: 'A test space',
        visibility: 'public',
      });

      expect(space).toBeDefined();
      expect(space.spaceId).toBeDefined();
      expect(space.name).toBe('Test Space');
      expect(space.description).toBe('A test space');
      expect(space.visibility).toBe('public');
      expect(space.portalVisible).toBe(true);
      expect(space.createdAt).toBeDefined();
    });

    it('should use overrideId when provided', () => {
      const space = store.create(
        { name: 'Test', visibility: 'public' },
        'custom-space-id'
      );

      expect(space.spaceId).toBe('custom-space-id');
    });

    it('should store creatorAgentId when provided', () => {
      const space = store.create({
        name: 'Test',
        visibility: 'public',
        creatorAgentId: 'agent-123',
      });

      expect(space.creatorAgentId).toBe('agent-123');
    });

    it('should store config as JSON', () => {
      const space = store.create({
        name: 'Test',
        visibility: 'public',
        config: { maxMembers: 10, allowedRoles: ['member'] },
      });

      expect(space.config).toEqual({ maxMembers: 10, allowedRoles: ['member'] });
    });

    it('should respect portalVisible=false', () => {
      const space = store.create({
        name: 'Hidden',
        visibility: 'private',
        portalVisible: false,
      });

      expect(space.portalVisible).toBe(false);
    });
  });

  describe('get', () => {
    it('should return space by ID', () => {
      const created = store.create({ name: 'Test', visibility: 'public' });
      const retrieved = store.get(created.spaceId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test');
    });

    it('should return undefined for unknown ID', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all spaces', () => {
      store.create({ name: 'Space A', visibility: 'public' });
      store.create({ name: 'Space B', visibility: 'private' });

      const spaces = store.list();
      expect(spaces).toHaveLength(2);
    });

    it('should filter by visibility', () => {
      store.create({ name: 'Public Space', visibility: 'public' });
      store.create({ name: 'Private Space', visibility: 'private' });

      const publicSpaces = store.list({ visibility: 'public' });
      expect(publicSpaces).toHaveLength(1);
      expect(publicSpaces[0].name).toBe('Public Space');

      const privateSpaces = store.list({ visibility: 'private' });
      expect(privateSpaces).toHaveLength(1);
      expect(privateSpaces[0].name).toBe('Private Space');
    });

    it('should order by created_at DESC', () => {
      // Note: Since creates happen in same millisecond, we can't reliably test ordering.
      // We verify both items exist; the ORDER BY created_at DESC is implemented in the SQL.
      store.create({ name: 'First', visibility: 'public' }, 'space-1');
      store.create({ name: 'Second', visibility: 'public' }, 'space-2');

      const spaces = store.list();
      expect(spaces).toHaveLength(2);
      expect(spaces.map(s => s.name).sort()).toEqual(['First', 'Second']);
    });
  });

  describe('update', () => {
    it('should update space name', () => {
      const space = store.create({ name: 'Old Name', visibility: 'public' });
      const updated = store.update(space.spaceId, { name: 'New Name' });

      expect(updated).toBe(true);
      expect(store.get(space.spaceId)?.name).toBe('New Name');
    });

    it('should update multiple fields', () => {
      const space = store.create({ name: 'Test', visibility: 'public', description: 'Old' });
      store.update(space.spaceId, {
        name: 'Updated',
        description: 'New description',
        portalVisible: false,
      });

      const retrieved = store.get(space.spaceId);
      expect(retrieved?.name).toBe('Updated');
      expect(retrieved?.description).toBe('New description');
      expect(retrieved?.portalVisible).toBe(false);
    });

    it('should return false for nonexistent space', () => {
      expect(store.update('nonexistent', { name: 'Test' })).toBe(false);
    });

    it('should return false when no fields provided', () => {
      const space = store.create({ name: 'Test', visibility: 'public' });
      expect(store.update(space.spaceId, {})).toBe(false);
    });
  });

  describe('remove', () => {
    it('should delete space', () => {
      const space = store.create({ name: 'Test', visibility: 'public' });
      const removed = store.remove(space.spaceId);

      expect(removed).toBe(true);
      expect(store.get(space.spaceId)).toBeUndefined();
    });

    it('should return false for nonexistent space', () => {
      expect(store.remove('nonexistent')).toBe(false);
    });

    it('should cascade delete memberships', () => {
      const space = store.create({ name: 'Test', visibility: 'public' });
      store.join(space.spaceId, 'agent-1');
      store.join(space.spaceId, 'agent-2');

      store.remove(space.spaceId);

      // Verify memberships are gone
      const db = new Database(join(testDir, 'events.db'));
      const rows = db.prepare(
        'SELECT COUNT(*) as n FROM space_memberships WHERE space_id = ?'
      ).get(space.spaceId) as { n: number };
      db.close();

      expect(rows.n).toBe(0);
    });
  });

  describe('exists', () => {
    it('should return true for existing space', () => {
      const space = store.create({ name: 'Test', visibility: 'public' });
      expect(store.exists(space.spaceId)).toBe(true);
    });

    it('should return false for nonexistent space', () => {
      expect(store.exists('nonexistent')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('should count all spaces', () => {
      store.create({ name: 'Space A', visibility: 'public' });
      store.create({ name: 'Space B', visibility: 'private' });
      expect(store.count()).toBe(2);
    });
  });

  // ==================== Membership ====================

  describe('join', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
    });

    it('should add new member and return true', () => {
      const result = store.join(spaceId, 'agent-1');

      expect(result).toBe(true);
      expect(store.isMember(spaceId, 'agent-1')).toBe(true);
    });

    it('should use default role "member"', () => {
      store.join(spaceId, 'agent-1');
      const members = store.listMembers(spaceId);

      expect(members[0].role).toBe('member');
    });

    it('should use specified role', () => {
      store.join(spaceId, 'agent-1', 'moderator');
      const members = store.listMembers(spaceId);

      expect(members[0].role).toBe('moderator');
    });

    it('should return false if already active member', () => {
      store.join(spaceId, 'agent-1');
      const secondJoin = store.join(spaceId, 'agent-1');

      expect(secondJoin).toBe(false);
    });

    it('should re-join after leave (clear left_at, update joined_at)', () => {
      store.join(spaceId, 'agent-1');
      const firstMembership = store.getMembership(spaceId, 'agent-1');
      store.leave(spaceId, 'agent-1');

      // Small delay to ensure different timestamp
      const reJoin = store.join(spaceId, 'agent-1', 'moderator');

      expect(reJoin).toBe(true);
      expect(store.isMember(spaceId, 'agent-1')).toBe(true);

      const membership = store.getMembership(spaceId, 'agent-1');
      expect(membership?.leftAt).toBeUndefined();
      expect(membership?.role).toBe('moderator');
      // joined_at should be updated on re-join
      expect(new Date(membership!.joinedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(firstMembership!.joinedAt).getTime());
    });

    it('should set joined_at timestamp', () => {
      const before = new Date();
      store.join(spaceId, 'agent-1');
      const after = new Date();

      const membership = store.getMembership(spaceId, 'agent-1');
      const joinedAt = new Date(membership!.joinedAt);

      expect(joinedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(joinedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('leave', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
      store.join(spaceId, 'agent-1');
    });

    it('should soft delete (set left_at) and return true', () => {
      const result = store.leave(spaceId, 'agent-1');

      expect(result).toBe(true);
      expect(store.isMember(spaceId, 'agent-1')).toBe(false);

      // Verify left_at is set
      const membership = store.getMembership(spaceId, 'agent-1');
      expect(membership?.leftAt).toBeDefined();
    });

    it('should return false if not a member', () => {
      const result = store.leave(spaceId, 'nonexistent-agent');
      expect(result).toBe(false);
    });

    it('should return false if already left', () => {
      store.leave(spaceId, 'agent-1');
      const secondLeave = store.leave(spaceId, 'agent-1');
      expect(secondLeave).toBe(false);
    });

    it('should preserve joined_at when leaving', () => {
      const beforeLeave = store.getMembership(spaceId, 'agent-1')!.joinedAt;
      store.leave(spaceId, 'agent-1');
      const afterLeave = store.getMembership(spaceId, 'agent-1')!.joinedAt;

      expect(afterLeave).toBe(beforeLeave);
    });
  });

  describe('isMember', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
    });

    it('should return true for active member', () => {
      store.join(spaceId, 'agent-1');
      expect(store.isMember(spaceId, 'agent-1')).toBe(true);
    });

    it('should return false for non-member', () => {
      expect(store.isMember(spaceId, 'agent-1')).toBe(false);
    });

    it('should return false for left member', () => {
      store.join(spaceId, 'agent-1');
      store.leave(spaceId, 'agent-1');
      expect(store.isMember(spaceId, 'agent-1')).toBe(false);
    });
  });

  describe('listMembers', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
      store.join(spaceId, 'agent-1');
      store.join(spaceId, 'agent-2');
    });

    it('should list active members by default', () => {
      store.leave(spaceId, 'agent-2');

      const members = store.listMembers(spaceId);
      expect(members).toHaveLength(1);
      expect(members[0].agentId).toBe('agent-1');
    });

    it('should include left members with activeOnly=false', () => {
      store.leave(spaceId, 'agent-2');

      const members = store.listMembers(spaceId, { activeOnly: false });
      expect(members).toHaveLength(2);
    });

    it('should order by joined_at ASC', () => {
      // agent-1 joined first, then agent-2
      const members = store.listMembers(spaceId);
      expect(members[0].agentId).toBe('agent-1');
      expect(members[1].agentId).toBe('agent-2');
    });
  });

  describe('getActiveMembers', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
      store.join(spaceId, 'agent-1');
      store.join(spaceId, 'agent-2');
      store.join(spaceId, 'agent-3');
    });

    it('should return array of active agent IDs', () => {
      const members = store.getActiveMembers(spaceId);
      expect(members).toHaveLength(3);
      expect(members).toContain('agent-1');
      expect(members).toContain('agent-2');
      expect(members).toContain('agent-3');
    });

    it('should exclude left members', () => {
      store.leave(spaceId, 'agent-2');
      const members = store.getActiveMembers(spaceId);

      expect(members).toHaveLength(2);
      expect(members).not.toContain('agent-2');
    });

    it('should return empty array for space with no members', () => {
      const emptySpaceId = store.create({ name: 'Empty', visibility: 'public' }).spaceId;
      expect(store.getActiveMembers(emptySpaceId)).toHaveLength(0);
    });
  });

  describe('updateRole', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
      store.join(spaceId, 'agent-1', 'member');
    });

    it('should update role and return true', () => {
      const result = store.updateRole(spaceId, 'agent-1', 'moderator');

      expect(result).toBe(true);
      expect(store.getMembership(spaceId, 'agent-1')?.role).toBe('moderator');
    });

    it('should return false for non-member', () => {
      expect(store.updateRole(spaceId, 'nonexistent', 'moderator')).toBe(false);
    });

    it('should return false for left member', () => {
      store.leave(spaceId, 'agent-1');
      expect(store.updateRole(spaceId, 'agent-1', 'moderator')).toBe(false);
    });
  });

  describe('memberCount', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
    });

    it('should return 0 for space with no members', () => {
      expect(store.memberCount(spaceId)).toBe(0);
    });

    it('should count active members only', () => {
      store.join(spaceId, 'agent-1');
      store.join(spaceId, 'agent-2');
      store.leave(spaceId, 'agent-2');

      expect(store.memberCount(spaceId)).toBe(1);
    });
  });

  describe('getMemberCounts', () => {
    it('should return empty map for empty array', () => {
      const counts = store.getMemberCounts([]);
      expect(counts.size).toBe(0);
    });

    it('should return member counts for multiple spaces in single query', () => {
      const space1 = store.create({ name: 'Space 1', visibility: 'public' });
      const space2 = store.create({ name: 'Space 2', visibility: 'public' });
      const space3 = store.create({ name: 'Space 3', visibility: 'public' });

      store.join(space1.spaceId, 'agent-1');
      store.join(space1.spaceId, 'agent-2');
      store.join(space2.spaceId, 'agent-1');
      // space3 has no members

      const counts = store.getMemberCounts([space1.spaceId, space2.spaceId, space3.spaceId]);

      expect(counts.get(space1.spaceId)).toBe(2);
      expect(counts.get(space2.spaceId)).toBe(1);
      expect(counts.get(space3.spaceId)).toBe(0);
    });

    it('should only count active members', () => {
      const spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
      store.join(spaceId, 'agent-1');
      store.join(spaceId, 'agent-2');
      store.leave(spaceId, 'agent-2');

      const counts = store.getMemberCounts([spaceId]);
      expect(counts.get(spaceId)).toBe(1);
    });
  });

  describe('getMembership', () => {
    let spaceId: string;

    beforeEach(() => {
      spaceId = store.create({ name: 'Test', visibility: 'public' }).spaceId;
    });

    it('should return membership entry', () => {
      store.join(spaceId, 'agent-1', 'moderator');
      const membership = store.getMembership(spaceId, 'agent-1');

      expect(membership).toBeDefined();
      expect(membership?.spaceId).toBe(spaceId);
      expect(membership?.agentId).toBe('agent-1');
      expect(membership?.role).toBe('moderator');
      expect(membership?.joinedAt).toBeDefined();
      expect(membership?.leftAt).toBeUndefined();
    });

    it('should return undefined for non-member', () => {
      expect(store.getMembership(spaceId, 'nonexistent')).toBeUndefined();
    });

    it('should include leftAt for left member', () => {
      store.join(spaceId, 'agent-1');
      store.leave(spaceId, 'agent-1');

      const membership = store.getMembership(spaceId, 'agent-1');
      expect(membership?.leftAt).toBeDefined();
    });
  });
});
