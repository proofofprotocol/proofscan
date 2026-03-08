/**
 * ProofPortal - Guild tests
 * Phase 5: ProofGuild
 */

import { describe, it, expect } from 'vitest';
import {
  calcLevel,
  getVisualState,
  getMembershipStatus,
  getGuildRole,
  toGuildMember,
  deriveGuildState,
  createInitialState,
  applyEvent,
  SPEAKING_THRESHOLD_MS,
  ACTIVE_THRESHOLD_MS,
  type AgentState,
  type PortalSseEvent,
} from '../types.js';

describe('ProofGuild - Level Calculation', () => {
  describe('calcLevel', () => {
    it('should return level 1 for 0 XP', () => {
      expect(calcLevel(0)).toBe(1);
    });

    it('should return level 1 for 9 XP', () => {
      expect(calcLevel(9)).toBe(1);
    });

    it('should return level 2 for 10 XP', () => {
      expect(calcLevel(10)).toBe(2);
    });

    it('should return level 2 for 39 XP', () => {
      expect(calcLevel(39)).toBe(2);
    });

    it('should return level 3 for 40 XP', () => {
      expect(calcLevel(40)).toBe(3);
    });

    it('should return level 4 for 90 XP', () => {
      expect(calcLevel(90)).toBe(4);
    });

    it('should return level 5 for 160 XP', () => {
      expect(calcLevel(160)).toBe(5);
    });

    it('should handle large XP values', () => {
      expect(calcLevel(10000)).toBe(32);
    });
  });
});

describe('ProofGuild - Visual State', () => {
  describe('getVisualState', () => {
    it('should return speaking if message within threshold', () => {
      const now = Date.now();
      const lastMessageAt = now - 5000; // 5 seconds ago
      const lastSeenAt = now - 1000;

      expect(getVisualState(lastMessageAt, lastSeenAt, now)).toBe('speaking');
    });

    it('should return speaking at exact threshold', () => {
      const now = Date.now();
      const lastMessageAt = now - SPEAKING_THRESHOLD_MS + 1;
      const lastSeenAt = now - 1000;

      expect(getVisualState(lastMessageAt, lastSeenAt, now)).toBe('speaking');
    });

    it('should return active if no recent message but recent event', () => {
      const now = Date.now();
      const lastMessageAt = now - 30000; // 30 seconds ago
      const lastSeenAt = now - 5000;

      expect(getVisualState(lastMessageAt, lastSeenAt, now)).toBe('active');
    });

    it('should return active with no message but recent event', () => {
      const now = Date.now();
      const lastSeenAt = now - 30000;

      expect(getVisualState(undefined, lastSeenAt, now)).toBe('active');
    });

    it('should return idle if no recent activity', () => {
      const now = Date.now();
      const lastMessageAt = now - 120000; // 2 minutes ago
      const lastSeenAt = now - 90000;

      expect(getVisualState(lastMessageAt, lastSeenAt, now)).toBe('idle');
    });

    it('should return idle at exact active threshold', () => {
      const now = Date.now();
      const lastSeenAt = now - ACTIVE_THRESHOLD_MS;

      expect(getVisualState(undefined, lastSeenAt, now)).toBe('idle');
    });
  });
});

describe('ProofGuild - Membership Status', () => {
  describe('getMembershipStatus', () => {
    it('should return active if recent event', () => {
      const now = Date.now();
      const agent: AgentState = {
        agentId: 'test-agent',
        traceIds: new Set(),
        spaceIds: new Set(['space-1']),
        eventCount: 5,
        lastSeenAt: now - 30000,
        experience: 0,
      };

      expect(getMembershipStatus(agent, now)).toBe('active');
    });

    it('should return joined if has space membership but not active', () => {
      const now = Date.now();
      const agent: AgentState = {
        agentId: 'test-agent',
        traceIds: new Set(),
        spaceIds: new Set(['space-1']),
        eventCount: 5,
        lastSeenAt: now - 120000, // 2 minutes ago
        experience: 0,
      };

      expect(getMembershipStatus(agent, now)).toBe('joined');
    });

    it('should return candidate if no space membership and not active', () => {
      const now = Date.now();
      const agent: AgentState = {
        agentId: 'test-agent',
        traceIds: new Set(),
        spaceIds: new Set(),
        eventCount: 1,
        lastSeenAt: now - 120000,
        experience: 0,
      };

      expect(getMembershipStatus(agent, now)).toBe('candidate');
    });
  });
});

describe('ProofGuild - Guild Role', () => {
  describe('getGuildRole', () => {
    it('should return visitor if no space membership', () => {
      const agent: AgentState = {
        agentId: 'test-agent',
        traceIds: new Set(),
        spaceIds: new Set(),
        eventCount: 0,
        lastSeenAt: Date.now(),
        experience: 0,
      };

      expect(getGuildRole(agent)).toBe('visitor');
    });

    it('should return member if has space membership', () => {
      const agent: AgentState = {
        agentId: 'test-agent',
        traceIds: new Set(),
        spaceIds: new Set(['space-1']),
        eventCount: 1,
        lastSeenAt: Date.now(),
        experience: 0,
      };

      expect(getGuildRole(agent)).toBe('member');
    });
  });
});

describe('ProofGuild - Guild Member Derivation', () => {
  describe('toGuildMember', () => {
    it('should derive guild member from agent state', () => {
      const now = Date.now();
      const agent: AgentState = {
        agentId: 'test-agent-123',
        traceIds: new Set(['trace-1']),
        spaceIds: new Set(['space-1']),
        eventCount: 10,
        lastSeenAt: now - 5000,
        name: 'TestBot',
        experience: 45,
        currentSpaceId: 'space-1',
        currentSpaceName: 'Test Room',
        lastMessagePreview: 'Hello world',
        lastMessageAt: now - 2000,
      };

      const member = toGuildMember(agent, now);

      expect(member.agentId).toBe('test-agent-123');
      expect(member.name).toBe('TestBot');
      expect(member.level).toBe(3); // sqrt(45/10) + 1 = 3
      expect(member.experience).toBe(45);
      expect(member.role).toBe('member');
      expect(member.membershipStatus).toBe('active');
      expect(member.visualState).toBe('speaking');
      expect(member.currentSpaceId).toBe('space-1');
      expect(member.lastMessagePreview).toBe('Hello world');
      expect(member.eventCount).toBe(10);
    });

    it('should use agentId as name fallback', () => {
      const now = Date.now();
      const agent: AgentState = {
        agentId: 'agent-abc-123',
        traceIds: new Set(),
        spaceIds: new Set(),
        eventCount: 1,
        lastSeenAt: now - 1000,
        experience: 0,
      };

      const member = toGuildMember(agent, now);

      expect(member.name).toBe('agent-abc-123');
    });
  });
});

describe('ProofGuild - Guild State Derivation', () => {
  describe('deriveGuildState', () => {
    it('should derive empty guild state from empty portal state', () => {
      const state = createInitialState();
      const now = Date.now();

      const guild = deriveGuildState(state, now);

      expect(guild.members.size).toBe(0);
      expect(guild.rooms.size).toBe(0);
    });

    it('should derive guild members from agents', () => {
      const state = createInitialState();
      const now = Date.now();

      state.agents.set('agent-1', {
        agentId: 'agent-1',
        name: 'Bot1',
        traceIds: new Set(),
        spaceIds: new Set(['space-1']),
        eventCount: 5,
        lastSeenAt: now - 1000,
        experience: 20,
        currentSpaceId: 'space-1',
      });

      const guild = deriveGuildState(state, now);

      expect(guild.members.size).toBe(1);
      expect(guild.members.get('agent-1')?.name).toBe('Bot1');
    });

    it('should derive rooms from spaces with members', () => {
      const state = createInitialState();
      const now = Date.now();

      state.spaces.set('space-1', {
        spaceId: 'space-1',
        spaceName: 'Main Hall',
        members: new Set(['agent-1']),
        events: [],
        messageCount: 5,
        lastActivityAt: now,
      });

      state.agents.set('agent-1', {
        agentId: 'agent-1',
        traceIds: new Set(),
        spaceIds: new Set(['space-1']),
        eventCount: 5,
        lastSeenAt: now - 1000,
        experience: 10,
        currentSpaceId: 'space-1',
      });

      const guild = deriveGuildState(state, now);

      expect(guild.rooms.size).toBe(1);
      const room = guild.rooms.get('space-1');
      expect(room?.spaceName).toBe('Main Hall');
      expect(room?.memberIds).toContain('agent-1');
    });
  });
});

describe('ProofGuild - XP Calculation via Events', () => {
  it('should award XP for join event', () => {
    const state = createInitialState();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.experience).toBe(2);
  });

  it('should award XP for message event', () => {
    const state = createInitialState();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        message_preview: 'Hello',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.experience).toBe(5);
  });

  it('should award XP for skill match event', () => {
    const state = createInitialState();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_skill',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'match',
        agent_id: 'agent-1',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.experience).toBe(10);
  });

  it('should accumulate XP across multiple events', () => {
    const state = createInitialState();
    const now = Date.now();

    // Join event
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    // Message event
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 1000,
      request_id: 'req-2',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    // Another message
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 2000,
      request_id: 'req-3',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    const agent = state.agents.get('agent-1');
    expect(agent?.experience).toBe(2 + 5 + 5); // join + 2 messages
  });
});

describe('ProofGuild - currentSpaceId Tracking', () => {
  it('should set currentSpaceId on join', () => {
    const state = createInitialState();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        space_name: 'Main Room',
        agent_id: 'agent-1',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.currentSpaceId).toBe('space-1');
    expect(agent?.currentSpaceName).toBe('Main Room');
  });

  it('should update currentSpaceId on message', () => {
    const state = createInitialState();
    const now = Date.now();

    // Join space-1
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    // Message in space-2
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 1000,
      request_id: 'req-2',
      metadata: {
        action: 'message',
        space_id: 'space-2',
        space_name: 'Side Room',
        agent_id: 'agent-1',
      },
    });

    const agent = state.agents.get('agent-1');
    expect(agent?.currentSpaceId).toBe('space-2');
    expect(agent?.currentSpaceName).toBe('Side Room');
  });

  it('should clear currentSpaceId on leave from current space', () => {
    const state = createInitialState();
    const now = Date.now();

    // Join
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    // Leave
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 1000,
      request_id: 'req-2',
      metadata: {
        action: 'left',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    const agent = state.agents.get('agent-1');
    expect(agent?.currentSpaceId).toBeUndefined();
    expect(agent?.currentSpaceName).toBeUndefined();
  });

  it('should not clear currentSpaceId when leaving different space', () => {
    const state = createInitialState();
    const now = Date.now();

    // Join space-1
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'joined',
        space_id: 'space-1',
        agent_id: 'agent-1',
      },
    });

    // Leave space-2 (different space)
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 1000,
      request_id: 'req-2',
      metadata: {
        action: 'left',
        space_id: 'space-2',
        agent_id: 'agent-1',
      },
    });

    const agent = state.agents.get('agent-1');
    expect(agent?.currentSpaceId).toBe('space-1');
  });
});

describe('ProofGuild - Agent Name Tracking', () => {
  it('should extract agent_name from metadata', () => {
    const state = createInitialState();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        agent_name: 'CoolBot',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.name).toBe('CoolBot');
  });

  it('should update name if new agent_name provided', () => {
    const state = createInitialState();
    const now = Date.now();

    // First event with name
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'message',
        agent_id: 'agent-1',
        agent_name: 'OldName',
      },
    });

    // Second event with new name
    applyEvent(state, {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now + 1000,
      request_id: 'req-2',
      metadata: {
        action: 'message',
        agent_id: 'agent-1',
        agent_name: 'NewName',
      },
    });

    const agent = state.agents.get('agent-1');
    expect(agent?.name).toBe('NewName');
  });
});

describe('ProofGuild - Message Preview Tracking', () => {
  it('should truncate message preview to 40 chars', () => {
    const state = createInitialState();
    const longMessage = 'This is a very long message that exceeds 40 characters and should be truncated';
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        message_preview: longMessage,
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.lastMessagePreview?.length).toBeLessThanOrEqual(40);
  });

  it('should keep short messages intact', () => {
    const state = createInitialState();
    const shortMessage = 'Hello!';
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: Date.now(),
      request_id: 'req-1',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        message_preview: shortMessage,
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.lastMessagePreview).toBe('Hello!');
  });

  it('should track lastMessageAt timestamp', () => {
    const state = createInitialState();
    const now = Date.now();
    const event: PortalSseEvent = {
      event_kind: 'proofcomm_space',
      client_id: 'client-1',
      ts: now,
      request_id: 'req-1',
      metadata: {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        message_preview: 'Test',
      },
    };

    applyEvent(state, event);

    const agent = state.agents.get('agent-1');
    expect(agent?.lastMessageAt).toBe(now);
  });
});
