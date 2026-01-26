/**
 * A2A Client Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { A2AClient, createA2AClient } from '../client.js';
import type { AgentCard } from '../types.js';

// Mock fetch
global.fetch = vi.fn();

// Mock database modules
vi.mock('../../db/targets-store.js');
vi.mock('../../db/agent-cache-store.js');
vi.mock('../agent-card.js', async () => {
  const actual = await vi.importActual('../agent-card.js') as Record<string, unknown>;
  return {
    ...actual,
    // Keep original isPrivateUrl for security tests
    fetchAgentCard: vi.fn(),
  };
});

import { TargetsStore } from '../../db/targets-store.js';
import { AgentCacheStore } from '../../db/agent-cache-store.js';
import { fetchAgentCard, isPrivateUrl } from '../agent-card.js';

describe('A2AClient', () => {
  const validAgentCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com',
    version: '1.0.0',
    description: 'A test agent',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with agent card', () => {
      const client = new A2AClient(validAgentCard);
      expect(client).toBeDefined();
    });

    it('should accept custom headers', () => {
      const client = new A2AClient(validAgentCard, {
        headers: { Authorization: 'Bearer token' },
      });
      expect(client).toBeDefined();
    });

    it('should reject private URLs', () => {
      expect(() => {
        new A2AClient({
          ...validAgentCard,
          url: 'http://localhost:8080',
        });
      }).toThrow('Private or local URLs are not allowed');
    });

    it('should reject 127.0.0.1 URLs', () => {
      expect(() => {
        new A2AClient({
          ...validAgentCard,
          url: 'http://127.0.0.1:8080',
        });
      }).toThrow('Private or local URLs are not allowed');
    });
  });

  describe('sendMessage', () => {
    it('should send string message and return task', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-123',
          status: 'completed',
          messages: [
            {
              role: 'user',
              parts: [{ text: 'Hello, agent!' }],
            },
            {
              role: 'assistant',
              parts: [{ text: 'Hello! How can I help?' }],
            },
          ],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('Hello, agent!');

      expect(result.ok).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe('task-123');
      expect(result.task?.status).toBe('completed');
      expect(result.task?.messages).toHaveLength(2);
    });

    it('should send A2AMessage object', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-456',
          status: 'completed',
          messages: [
            {
              role: 'user',
              parts: [{ text: 'Complex message' }],
            },
          ],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage({
        role: 'user',
        parts: [{ text: 'Complex message' }],
      });

      expect(result.ok).toBe(true);
      expect(result.task?.id).toBe('task-456');
    });

    it('should return direct message instead of task', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          role: 'assistant',
          parts: [{ text: 'Direct response!' }],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('Quick question');

      expect(result.ok).toBe(true);
      expect(result.task).toBeUndefined();
      expect(result.message).toBeDefined();
      expect(result.message?.role).toBe('assistant');
      expect(result.message?.parts[0]).toEqual({ text: 'Direct response!' });
    });

    it('should handle JSON-RPC errors', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        error: {
          code: -32602,
          message: 'Invalid params',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('-32602');
      expect(result.statusCode).toBe(400);
    });

    it('should handle timeout', async () => {
      vi.useFakeTimers();

      const controller = new AbortController();
      vi.spyOn(global, 'AbortController').mockImplementation(() => controller);

      vi.mocked(fetch).mockImplementationOnce(() => {
        return new Promise<Response>((_, reject) => {
          const timeout = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Aborted', 'AbortError'));
          }, 500);
          return timeout as any;
        });
      });

      const client = new A2AClient(validAgentCard);
      const fetchPromise = client.sendMessage('test', { timeout: 1000 });
      await vi.advanceTimersByTimeAsync(600);
      const result = await fetchPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain('timeout');

      vi.useRealTimers();
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle invalid JSON response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => 'not valid json',
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should include custom headers', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-123',
          status: 'completed',
          messages: [],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard, {
        headers: { 'X-Custom-Header': 'custom-value' },
      });
      await client.sendMessage('test');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/message/send',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    it('should send blocking parameter when specified', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-123',
          status: 'completed',
          messages: [],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      await client.sendMessage('test', { blocking: true });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      expect(requestBody.params.configuration).toEqual({ blocking: true });
    });

    it('should parse task with artifacts', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-789',
          status: 'completed',
          messages: [
            {
              role: 'assistant',
              parts: [{ text: 'Here is your document' }],
            },
          ],
          artifacts: [
            {
              name: 'report.pdf',
              description: 'Generated report',
              parts: [
                {
                  data: 'base64encodeddata...',
                  mimeType: 'application/pdf',
                },
              ],
            },
          ],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('Generate report');

      expect(result.ok).toBe(true);
      expect(result.task?.artifacts).toHaveLength(1);
      expect(result.task?.artifacts?.[0].name).toBe('report.pdf');
      expect(result.task?.artifacts?.[0].description).toBe('Generated report');
    });

    it('should parse task with contextId', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-abc',
          status: 'completed',
          contextId: 'ctx-123',
          messages: [],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/message/send',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.sendMessage('test');

      expect(result.ok).toBe(true);
      expect(result.task?.contextId).toBe('ctx-123');
    });

    it('should parse all valid task statuses', async () => {
      const statuses: Array<A2AClient['parseTask']> = [
        'pending',
        'working',
        'input_required',
        'completed',
        'failed',
        'canceled',
        'rejected',
      ];

      for (const status of statuses) {
        const mockResponse = {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            id: 'task-123',
            status,
            messages: [],
          },
        };

        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(mockResponse),
          url: 'https://test.example.com/message/send',
        } as Response);

        const client = new A2AClient(validAgentCard);
        const result = await client.sendMessage('test');

        expect(result.ok).toBe(true);
        expect(result.task?.status).toBe(status);
      }
    });
  });

  describe('getTask', () => {
    it('should get task by ID', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-existing',
          status: 'working',
          messages: [
            {
              role: 'assistant',
              parts: [{ text: 'Processing...' }],
            },
          ],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/tasks/get',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.getTask('task-existing');

      expect(result.ok).toBe(true);
      expect(result.task?.id).toBe('task-existing');
      expect(result.task?.status).toBe('working');

      // Verify request format
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      expect(requestBody.method).toBe('tasks/get');
      expect(requestBody.params.name).toBe('tasks/task-existing');
    });

    it('should handle task not found error', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        error: {
          code: 404,
          message: 'Task not found',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/tasks/get',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.getTask('non-existent');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('404');
      expect(result.error).toContain('Task not found');
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection failed'));

      const client = new A2AClient(validAgentCard);
      const result = await client.getTask('task-123');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('cancelTask', () => {
    it('should cancel a task', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          id: 'task-to-cancel',
          status: 'canceled',
          messages: [],
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/tasks/cancel',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.cancelTask('task-to-cancel');

      expect(result.ok).toBe(true);

      // Verify request format
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      expect(requestBody.method).toBe('tasks/cancel');
      expect(requestBody.params.name).toBe('tasks/task-to-cancel');
    });

    it('should handle already canceled task', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        error: {
          code: 409,
          message: 'Task is not cancelable',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
        url: 'https://test.example.com/tasks/cancel',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.cancelTask('already-canceled');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('409');
      expect(result.error).toContain('not cancelable');
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const client = new A2AClient(validAgentCard);
      const result = await client.cancelTask('task-123');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });
});

describe('createA2AClient', () => {
  // Mock TargetsStore
  const mockTargetsStore = {
    list: vi.fn(),
    get: vi.fn(),
  };

  // Mock AgentCacheStore
  const mockAgentCacheStore = {
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);
    vi.mocked(AgentCacheStore).mockImplementation(() => mockAgentCacheStore as unknown as AgentCacheStore);
  });

  it('should create client from cached agent card', async () => {
    const cachedAgentCard: AgentCard = {
      name: 'Cached Agent',
      url: 'https://cached.example.com',
      version: '1.0.0',
    };

    mockTargetsStore.list.mockReturnValue([
      {
        id: 'agent-123',
        type: 'agent',
        protocol: 'a2a',
        name: 'Test Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://cached.example.com',
          ttl_seconds: 3600,
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue({
      targetId: 'agent-123',
      agentCard: cachedAgentCard,
      agentCardHash: 'abc123',
      fetchedAt: '2024-01-01T00:00:00Z',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'agent-123');

    expect(result.ok).toBe(true);
    expect(result.client).toBeDefined();
    expect(result.agentCard).toEqual(cachedAgentCard);
    expect(vi.mocked(fetchAgentCard)).not.toHaveBeenCalled();
  });

  it('should fetch agent card when cache is expired', async () => {
    const freshAgentCard: AgentCard = {
      name: 'Fresh Agent',
      url: 'https://fresh.example.com',
      version: '2.0.0',
    };

    mockTargetsStore.list.mockReturnValue([
      {
        id: 'agent-456',
        type: 'agent',
        protocol: 'a2a',
        name: 'Test Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://fresh.example.com',
          ttl_seconds: 3600,
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue({
      targetId: 'agent-456',
      agentCard: {
        name: 'Old Agent',
        url: 'https://fresh.example.com',
        version: '1.0.0',
      },
      agentCardHash: 'old-hash',
      fetchedAt: '2024-01-01T00:00:00Z',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
    });

    vi.mocked(fetchAgentCard).mockResolvedValueOnce({
      ok: true,
      agentCard: freshAgentCard,
      hash: 'new-hash',
    });

    const result = await createA2AClient('/config/dir', 'agent-456');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toEqual(freshAgentCard);
    expect(vi.mocked(fetchAgentCard)).toHaveBeenCalledWith('https://fresh.example.com');
    expect(mockAgentCacheStore.set).toHaveBeenCalled();
  });

  it('should fetch agent card when cache is empty', async () => {
    const freshAgentCard: AgentCard = {
      name: 'New Agent',
      url: 'https://new.example.com',
      version: '1.0.0',
    };

    mockTargetsStore.list.mockReturnValue([
      {
        id: 'agent-789',
        type: 'agent',
        protocol: 'a2a',
        name: 'Test Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://new.example.com',
          ttl_seconds: 7200,
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue(undefined);

    vi.mocked(fetchAgentCard).mockResolvedValueOnce({
      ok: true,
      agentCard: freshAgentCard,
      hash: 'hash-789',
    });

    const result = await createA2AClient('/config/dir', 'agent-789');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toEqual(freshAgentCard);
    expect(vi.mocked(fetchAgentCard)).toHaveBeenCalledWith('https://new.example.com');
    expect(mockAgentCacheStore.set).toHaveBeenCalled();
  });

  it('should find agent by prefix', async () => {
    const cachedAgentCard: AgentCard = {
      name: 'Prefix Agent',
      url: 'https://prefix.example.com',
      version: '1.0.0',
    };

    mockTargetsStore.list.mockReturnValue([
      {
        id: 'agent-full-id-12345',
        type: 'agent',
        protocol: 'a2a',
        name: 'Test Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://prefix.example.com',
          ttl_seconds: 3600,
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue({
      targetId: 'agent-full-id-12345',
      agentCard: cachedAgentCard,
      agentCardHash: 'hash-123',
      fetchedAt: '2024-01-01T00:00:00Z',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'agent-full');

    expect(result.ok).toBe(true);
    expect(result.client).toBeDefined();
  });

  it('should return error when agent not found', async () => {
    mockTargetsStore.list.mockReturnValue([]);

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'non-existent');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error when agent is disabled', async () => {
    mockTargetsStore.list.mockReturnValue([
      {
        id: 'disabled-agent',
        type: 'agent',
        protocol: 'a2a',
        name: 'Disabled Agent',
        enabled: false, // Disabled
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://disabled.example.com',
        },
      },
    ]);

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'disabled-agent');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('should return error when agent has no URL configured', async () => {
    mockTargetsStore.list.mockReturnValue([
      {
        id: 'no-url-agent',
        type: 'agent',
        protocol: 'a2a',
        name: 'No URL Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {}, // No URL
      },
    ]);

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'no-url-agent');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('no URL configured');
  });

  it('should return error when fetch fails', async () => {
    mockTargetsStore.list.mockReturnValue([
      {
        id: 'fetch-fail-agent',
        type: 'agent',
        protocol: 'a2a',
        name: 'Fetch Fail Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://fetch-fail.example.com',
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue(undefined);

    vi.mocked(fetchAgentCard).mockResolvedValueOnce({
      ok: false,
      error: 'Network error',
    });

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'fetch-fail-agent');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to fetch agent card');
  });

  it('should use cached card with no expiration', async () => {
    const cachedAgentCard: AgentCard = {
      name: 'No Expiry Agent',
      url: 'https://no-expiry.example.com',
      version: '1.0.0',
    };

    mockTargetsStore.list.mockReturnValue([
      {
        id: 'no-expiry-agent',
        type: 'agent',
        protocol: 'a2a',
        name: 'No Expiry Agent',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        config: {
          url: 'https://no-expiry.example.com',
          ttl_seconds: 0, // No expiration
        },
      },
    ]);

    mockAgentCacheStore.get.mockReturnValue({
      targetId: 'no-expiry-agent',
      agentCard: cachedAgentCard,
      agentCardHash: 'hash-abc',
      fetchedAt: '2024-01-01T00:00:00Z',
      expiresAt: undefined, // No expiration
    });

    const { createA2AClient } = await import('../client.js');
    const result = await createA2AClient('/config/dir', 'no-expiry-agent');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toEqual(cachedAgentCard);
    expect(vi.mocked(fetchAgentCard)).not.toHaveBeenCalled();
  });
});
