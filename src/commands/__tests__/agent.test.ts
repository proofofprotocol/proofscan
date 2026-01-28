/**
 * Agent Commands Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createAgentCommand } from '../agent.js';
import { TargetsStore } from '../../db/targets-store.js';
import { AgentCacheStore } from '../../db/agent-cache-store.js';
import { fetchAgentCard } from '../../a2a/agent-card.js';
import type { AgentConfigV1 } from '../../a2a/types.js';

// Mock dependencies
vi.mock('../../db/targets-store.js');
vi.mock('../../db/agent-cache-store.js');
vi.mock('../../a2a/agent-card.js');

describe('agent command', () => {
  let program: Command;
  let mockConfigPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigPath = '/test/config';
    program = new Command();
    program.addCommand(createAgentCommand(() => mockConfigPath));
  });

  describe('agent add', () => {
    it('should add a new agent successfully', async () => {
      const mockStore = {
        add: vi.fn(),
        get: vi.fn().mockReturnValue(undefined),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'add', 'test-agent', '--url', 'https://example.com']);

      expect(mockStore.get).toHaveBeenCalledWith('test-agent');
      expect(mockStore.add).toHaveBeenCalledWith({
        type: 'agent',
        protocol: 'a2a',
        name: undefined,
        enabled: true,
        config: {
          schema_version: 1,
          url: 'https://example.com',
          ttl_seconds: 3600,
        },
      }, { id: 'test-agent' });
    });

    it('should fail on duplicate ID', async () => {
      const mockStore = {
        get: vi.fn().mockReturnValue({ id: 'test-agent' }),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'add', 'test-agent', '--url', 'https://example.com'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });

    it('should fail on invalid URL', async () => {
      const mockStore = {
        get: vi.fn().mockReturnValue(undefined),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'add', 'test-agent', '--url', 'not-a-url'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });

    it('should accept custom name and TTL', async () => {
      const mockStore = {
        add: vi.fn(),
        get: vi.fn().mockReturnValue(undefined),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync([
        'node', 'test', 'agent', 'add', 'test-agent',
        '--url', 'https://example.com',
        '--name', 'My Test Agent',
        '--ttl', '7200',
      ]);

      expect(mockStore.add).toHaveBeenCalledWith({
        type: 'agent',
        protocol: 'a2a',
        name: 'My Test Agent',
        enabled: true,
        config: {
          schema_version: 1,
          url: 'https://example.com',
          ttl_seconds: 7200,
        },
      }, { id: 'test-agent' });
    });
  });

  describe('agent list', () => {
    it('should list enabled agents', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com' } as AgentConfigV1,
        },
        {
          id: 'agent-2',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent Two',
          enabled: false,
          createdAt: '2024-01-02T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent2.example.com' } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'list']);

      expect(mockStore.list).toHaveBeenCalledWith({ type: 'agent', enabled: true });
    });

    it('should list all agents with --all flag', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com' } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'list', '--all']);

      expect(mockStore.list).toHaveBeenCalledWith({ type: 'agent' });
    });

    it('should handle empty agent list', async () => {
      const mockStore = {
        list: vi.fn().mockReturnValue([]),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'agent', 'list']);

      expect(mockStore.list).toHaveBeenCalledWith({ type: 'agent', enabled: true });
      consoleSpy.mockRestore();
    });
  });

  describe('agent show', () => {
    it('should show agent details', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com', ttl_seconds: 3600 } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };

      const mockCache = {
        agentCard: { name: 'Agent One', version: '1.0.0', url: 'https://agent1.example.com' },
        fetchedAt: '2024-01-01T01:00:00.000Z',
        expiresAt: '2024-01-01T02:00:00.000Z',
        hash: 'abc123',
      };

      const mockCacheStore = {
        get: vi.fn().mockReturnValue(mockCache),
      };

      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);
      vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'agent', 'show', 'agent-1']);

      expect(mockCacheStore.get).toHaveBeenCalledWith('agent-1');
      consoleSpy.mockRestore();
    });

    it('should handle non-existent agent', async () => {
      const mockStore = {
        list: vi.fn().mockReturnValue([]),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'show', 'non-existent'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });

  describe('agent remove', () => {
    it('should remove an existing agent', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com' } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
        remove: vi.fn().mockReturnValue(true),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'remove', 'agent-1']);

      expect(mockStore.remove).toHaveBeenCalledWith('agent-1');
    });

    it('should handle non-existent agent on remove', async () => {
      const mockStore = {
        list: vi.fn().mockReturnValue([]),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called');
      });

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'remove', 'non-existent'])
      ).rejects.toThrow('exit called');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      processExitSpy.mockRestore();
    });
  });

  describe('agent enable/disable', () => {
    it('should enable an agent', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: false,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com' } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
        updateEnabled: vi.fn().mockReturnValue(true),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'enable', 'agent-1']);

      expect(mockStore.updateEnabled).toHaveBeenCalledWith('agent-1', true);
    });

    it('should disable an agent', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com' } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
        updateEnabled: vi.fn().mockReturnValue(true),
      };
      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

      await program.parseAsync(['node', 'test', 'agent', 'disable', 'agent-1']);

      expect(mockStore.updateEnabled).toHaveBeenCalledWith('agent-1', false);
    });
  });

  describe('agent scan', () => {
    it('should fetch and cache agent card', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com', ttl_seconds: 3600 } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };

      const mockCacheStore = {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
      };

      const mockAgentCard = {
        name: 'Agent One',
        url: 'https://agent1.example.com',
        version: '1.0.0',
      };

      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);
      vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: mockAgentCard,
        hash: 'abc123',
      });

      await program.parseAsync(['node', 'test', 'agent', 'scan', 'agent-1']);

      expect(fetchAgentCard).toHaveBeenCalledWith('https://agent1.example.com', expect.any(Object));
      expect(mockCacheStore.set).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'agent-1',
          agentCard: mockAgentCard,
        })
      );
    });

    it('should use cached agent card if valid', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com', ttl_seconds: 3600 } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };

      const futureDate = new Date(Date.now() + 3600000).toISOString();

      const mockCacheStore = {
        get: vi.fn().mockReturnValue({
          agentCard: { name: 'Agent One', version: '1.0.0', url: 'https://agent1.example.com' },
          fetchedAt: '2024-01-01T01:00:00.000Z',
          expiresAt: futureDate,
          hash: 'abc123',
        }),
      };

      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);
      vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

      await program.parseAsync(['node', 'test', 'agent', 'scan', 'agent-1']);

      expect(fetchAgentCard).not.toHaveBeenCalled();
    });

    it('should refresh with --refresh flag', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          type: 'agent' as const,
          protocol: 'a2a' as const,
          name: 'Agent One',
          enabled: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          config: { schema_version: 1, url: 'https://agent1.example.com', ttl_seconds: 3600 } as AgentConfigV1,
        },
      ];

      const mockStore = {
        list: vi.fn().mockReturnValue(mockAgents),
      };

      const mockCacheStore = {
        get: vi.fn().mockReturnValue({
          agentCard: { name: 'Agent One', version: '1.0.0', url: 'https://agent1.example.com' },
          fetchedAt: '2024-01-01T01:00:00.000Z',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          hash: 'abc123',
        }),
        set: vi.fn(),
      };

      const mockAgentCard = {
        name: 'Agent One',
        url: 'https://agent1.example.com',
        version: '1.0.0',
      };

      vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);
      vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: mockAgentCard,
        hash: 'abc123',
      });

      await program.parseAsync(['node', 'test', 'agent', 'scan', 'agent-1', '--refresh']);

      expect(fetchAgentCard).toHaveBeenCalledWith('https://agent1.example.com', expect.any(Object));
    });
  });
});
