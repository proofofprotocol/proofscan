/**
 * Tests for SpaceManager
 * Phase 9.3: Autonomous Spaces
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SpacesStore } from '../../../db/spaces-store.js';
import { closeAllDbs } from '../../../db/connection.js';
import { EVENTS_DB_SCHEMA } from '../../../db/schema.js';
import { createAuditLogger, type AuditLogger } from '../../../gateway/audit.js';
import {
  SpaceManager,
  type DispatchToAgentFn,
  type SpaceBroadcastRequest,
} from '../space-manager.js';
import type { ProofCommEventBaseOptions } from '../../events.js';
import type { A2AMessage } from '../../../db/types.js';

describe('SpaceManager', () => {
  let testDir: string;
  let spacesStore: SpacesStore;
  let auditLogger: AuditLogger;
  let manager: SpaceManager;

  const baseOptions: ProofCommEventBaseOptions = {
    requestId: 'test-request-id',
    clientId: 'test-client',
  };

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

    spacesStore = new SpacesStore(testDir);
    auditLogger = createAuditLogger(testDir);
    manager = new SpaceManager(spacesStore, auditLogger);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==================== Space Management ====================

  describe('createSpace', () => {
    it('should create a space and return SpaceEntry', () => {
      const result = manager.createSpace(
        { name: 'Test Space', visibility: 'public' },
        baseOptions,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Test Space');
        expect(result.value.visibility).toBe('public');
      }
    });

    it('should auto-join creator as moderator', () => {
      const result = manager.createSpace(
        {
          name: 'Test Space',
          visibility: 'public',
          creatorAgentId: 'agent-creator',
        },
        baseOptions,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify creator is a member with moderator role
        expect(manager.isMember(result.value.spaceId, 'agent-creator')).toBe(true);

        const members = manager.listMembers(result.value.spaceId);
        const creatorMembership = members.find(m => m.agentId === 'agent-creator');
        expect(creatorMembership?.role).toBe('moderator');
      }
    });

    it('should not auto-join when no creatorAgentId', () => {
      const result = manager.createSpace(
        { name: 'Test Space', visibility: 'public' },
        baseOptions,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const members = manager.listMembers(result.value.spaceId);
        expect(members).toHaveLength(0);
      }
    });

    it('should emit created event', () => {
      // Spy on auditLogger.logEvent
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');

      manager.createSpace(
        { name: 'Test Space', visibility: 'public', creatorAgentId: 'agent-1' },
        baseOptions,
      );

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'created',
            space_name: 'Test Space',
            agent_id: 'agent-1',
          }),
        }),
      );
    });
  });

  describe('getSpace', () => {
    it('should return space by ID', () => {
      const created = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!created.ok) throw new Error('Create failed');

      const space = manager.getSpace(created.value.spaceId);
      expect(space?.name).toBe('Test');
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getSpace('nonexistent')).toBeUndefined();
    });
  });

  describe('listSpaces', () => {
    it('should list all spaces', () => {
      manager.createSpace({ name: 'Space A', visibility: 'public' }, baseOptions);
      manager.createSpace({ name: 'Space B', visibility: 'private' }, baseOptions);

      const spaces = manager.listSpaces();
      expect(spaces).toHaveLength(2);
    });

    it('should filter by visibility', () => {
      manager.createSpace({ name: 'Public', visibility: 'public' }, baseOptions);
      manager.createSpace({ name: 'Private', visibility: 'private' }, baseOptions);

      const publicSpaces = manager.listSpaces({ visibility: 'public' });
      expect(publicSpaces).toHaveLength(1);
      expect(publicSpaces[0].name).toBe('Public');
    });
  });

  describe('deleteSpace', () => {
    it('should delete space and return success', () => {
      const created = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!created.ok) throw new Error('Create failed');

      const result = manager.deleteSpace(created.value.spaceId, baseOptions);

      expect(result.ok).toBe(true);
      expect(manager.getSpace(created.value.spaceId)).toBeUndefined();
    });

    it('should return error for nonexistent space', () => {
      const result = manager.deleteSpace('nonexistent', baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPACE_NOT_FOUND');
      }
    });

    it('should emit deleted event', () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');

      const created = manager.createSpace(
        { name: 'Test Space', visibility: 'public' },
        baseOptions,
      );
      if (!created.ok) throw new Error('Create failed');

      logEventSpy.mockClear();
      manager.deleteSpace(created.value.spaceId, baseOptions);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'deleted',
            space_id: created.value.spaceId,
            space_name: 'Test Space',
          }),
        }),
      );
    });
  });

  // ==================== Membership Management ====================

  describe('joinSpace', () => {
    let spaceId: string;

    beforeEach(() => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');
      spaceId = result.value.spaceId;
    });

    it('should add member and return success', () => {
      const result = manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);

      expect(result.ok).toBe(true);
      expect(manager.isMember(spaceId, 'agent-1')).toBe(true);
    });

    it('should return error for nonexistent space', () => {
      const result = manager.joinSpace('nonexistent', 'agent-1', 'member', baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPACE_NOT_FOUND');
      }
    });

    it('should return error if already member', () => {
      manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);
      const result = manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ALREADY_MEMBER');
      }
    });

    it('should allow re-join after leave', () => {
      manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);
      manager.leaveSpace(spaceId, 'agent-1', baseOptions);

      const result = manager.joinSpace(spaceId, 'agent-1', 'moderator', baseOptions);

      expect(result.ok).toBe(true);
      expect(manager.isMember(spaceId, 'agent-1')).toBe(true);
    });

    it('should emit joined event', () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');
      logEventSpy.mockClear();

      manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'joined',
            space_id: spaceId,
            agent_id: 'agent-1',
          }),
        }),
      );
    });
  });

  describe('leaveSpace', () => {
    let spaceId: string;

    beforeEach(() => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');
      spaceId = result.value.spaceId;
      manager.joinSpace(spaceId, 'agent-1', 'member', baseOptions);
    });

    it('should remove member and return success', () => {
      const result = manager.leaveSpace(spaceId, 'agent-1', baseOptions);

      expect(result.ok).toBe(true);
      expect(manager.isMember(spaceId, 'agent-1')).toBe(false);
    });

    it('should return error for nonexistent space', () => {
      const result = manager.leaveSpace('nonexistent', 'agent-1', baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPACE_NOT_FOUND');
      }
    });

    it('should return error if not a member', () => {
      const result = manager.leaveSpace(spaceId, 'nonexistent-agent', baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_MEMBER');
      }
    });

    it('should emit left event', () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');
      logEventSpy.mockClear();

      manager.leaveSpace(spaceId, 'agent-1', baseOptions);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'left',
            space_id: spaceId,
            agent_id: 'agent-1',
          }),
        }),
      );
    });
  });

  // ==================== G3 Broadcast ====================

  describe('broadcastToSpace', () => {
    let spaceId: string;
    let mockDispatch: DispatchToAgentFn;

    const testMessage: A2AMessage = {
      role: 'user',
      parts: [{ text: 'Hello everyone!' }],
    };

    beforeEach(() => {
      // Create space with creator
      const result = manager.createSpace(
        {
          name: 'Broadcast Test',
          visibility: 'public',
          creatorAgentId: 'sender-agent',
        },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');
      spaceId = result.value.spaceId;

      // Add some recipients
      manager.joinSpace(spaceId, 'recipient-1', 'member', baseOptions);
      manager.joinSpace(spaceId, 'recipient-2', 'member', baseOptions);
      manager.joinSpace(spaceId, 'recipient-3', 'member', baseOptions);

      // Default mock dispatch - all succeed
      mockDispatch = vi.fn().mockResolvedValue({ success: true });
    });

    it('should broadcast to all members except sender', async () => {
      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      const result = await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.recipientCount).toBe(3); // 3 recipients, not including sender
        expect(result.value.deliveredCount).toBe(3);
        expect(result.value.failedCount).toBe(0);
      }

      // Verify dispatch was called for each recipient, not sender
      expect(mockDispatch).toHaveBeenCalledTimes(3);
      expect(mockDispatch).toHaveBeenCalledWith('recipient-1', testMessage);
      expect(mockDispatch).toHaveBeenCalledWith('recipient-2', testMessage);
      expect(mockDispatch).toHaveBeenCalledWith('recipient-3', testMessage);
    });

    it('should return error if space not found', async () => {
      const request: SpaceBroadcastRequest = {
        spaceId: 'nonexistent',
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      const result = await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPACE_NOT_FOUND');
      }
    });

    it('should return error if sender is not a member', async () => {
      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'nonmember-agent',
        message: testMessage,
      };

      const result = await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_MEMBER');
      }
    });

    it('should emit G3 message event (single event)', async () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');
      logEventSpy.mockClear();

      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      // Should have exactly ONE message event (G3 pattern)
      const messageEvents = logEventSpy.mock.calls.filter(
        call => (call[0] as Record<string, unknown>).metadata?.action === 'message'
      );
      expect(messageEvents).toHaveLength(1);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'message',
            space_id: spaceId,
            recipient_count: 3,
            message_preview: 'Hello everyone!',
          }),
        }),
      );
    });

    it('should handle delivery failures', async () => {
      // Make some dispatches fail
      mockDispatch = vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Connection refused' })
        .mockResolvedValueOnce({ success: true });

      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      const result = await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deliveredCount).toBe(2);
        expect(result.value.failedCount).toBe(1);
        expect(result.value.failures).toHaveLength(1);
        expect(result.value.failures![0].error).toBe('Connection refused');
      }
    });

    it('should emit G3 delivery_failed event on failures', async () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');

      mockDispatch = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Failed' })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Timeout' });

      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      // Should have ONE delivery_failed event (G3 pattern)
      const failedEvents = logEventSpy.mock.calls.filter(
        call => (call[0] as Record<string, unknown>).metadata?.action === 'delivery_failed'
      );
      expect(failedEvents).toHaveLength(1);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'proofcomm_space',
          metadata: expect.objectContaining({
            action: 'delivery_failed',
            space_id: spaceId,
            failed_count: 2,
            recipient_count: 3,
          }),
        }),
      );
    });

    it('should not emit delivery_failed event when all succeed', async () => {
      const logEventSpy = vi.spyOn(auditLogger, 'logEvent');
      logEventSpy.mockClear();

      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      // Should NOT have delivery_failed event
      const failedEvents = logEventSpy.mock.calls.filter(
        call => (call[0] as Record<string, unknown>).metadata?.action === 'delivery_failed'
      );
      expect(failedEvents).toHaveLength(0);
    });

    it('should handle dispatch throwing errors', async () => {
      mockDispatch = vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const request: SpaceBroadcastRequest = {
        spaceId,
        senderAgentId: 'sender-agent',
        message: testMessage,
      };

      const result = await manager.broadcastToSpace(request, mockDispatch, baseOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deliveredCount).toBe(2);
        expect(result.value.failedCount).toBe(1);
        expect(result.value.failures![0].error).toBe('Network error');
      }
    });
  });

  // ==================== Convenience Methods ====================

  describe('spaceExists', () => {
    it('should return true for existing space', () => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');

      expect(manager.spaceExists(result.value.spaceId)).toBe(true);
    });

    it('should return false for nonexistent space', () => {
      expect(manager.spaceExists('nonexistent')).toBe(false);
    });
  });

  describe('isMember', () => {
    it('should delegate to spacesStore', () => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');

      manager.joinSpace(result.value.spaceId, 'agent-1', 'member', baseOptions);

      expect(manager.isMember(result.value.spaceId, 'agent-1')).toBe(true);
      expect(manager.isMember(result.value.spaceId, 'agent-2')).toBe(false);
    });
  });

  describe('getActiveMembers', () => {
    it('should return active member IDs', () => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');

      manager.joinSpace(result.value.spaceId, 'agent-1', 'member', baseOptions);
      manager.joinSpace(result.value.spaceId, 'agent-2', 'member', baseOptions);
      manager.leaveSpace(result.value.spaceId, 'agent-2', baseOptions);

      const members = manager.getActiveMembers(result.value.spaceId);
      expect(members).toContain('agent-1');
      expect(members).not.toContain('agent-2');
    });
  });

  describe('memberCount', () => {
    it('should return active member count', () => {
      const result = manager.createSpace(
        { name: 'Test', visibility: 'public' },
        baseOptions,
      );
      if (!result.ok) throw new Error('Create failed');

      expect(manager.memberCount(result.value.spaceId)).toBe(0);

      manager.joinSpace(result.value.spaceId, 'agent-1', 'member', baseOptions);
      manager.joinSpace(result.value.spaceId, 'agent-2', 'member', baseOptions);

      expect(manager.memberCount(result.value.spaceId)).toBe(2);

      manager.leaveSpace(result.value.spaceId, 'agent-1', baseOptions);

      expect(manager.memberCount(result.value.spaceId)).toBe(1);
    });
  });
});
