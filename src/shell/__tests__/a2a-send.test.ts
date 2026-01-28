/**
 * Tests for A2A send command (handleA2ASend)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock modules before importing the function
vi.mock('../../db/targets-store.js', () => ({
  TargetsStore: vi.fn(),
}));

vi.mock('../../db/agent-cache-store.js', () => ({
  AgentCacheStore: vi.fn(),
}));

vi.mock('../../a2a/client.js', () => ({
  A2AClient: vi.fn(),
}));

import { handleA2ASend } from '../router-commands.js';
import { TargetsStore } from '../../db/targets-store.js';
import { AgentCacheStore } from '../../db/agent-cache-store.js';
import { A2AClient } from '../../a2a/client.js';
import type { ShellContext } from '../types.js';

describe('handleA2ASend', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should error when not in connector context', async () => {
    const context: ShellContext = {};
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Not in a target context')
    );
  });

  it('should error when no message provided', async () => {
    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend([], context, '/tmp/config.json');
    
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Usage: send <message>')
    );
  });

  it('should error when target is not an A2A agent', async () => {
    const mockStore = {
      list: vi.fn().mockReturnValue([]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockStore as unknown as TargetsStore);

    const context: ShellContext = { connector: 'mcp-connector' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('is not an A2A agent')
    );
  });

  it('should error when agent card not cached', async () => {
    const mockTargetsStore = {
      list: vi.fn().mockReturnValue([
        { id: 'test-agent', type: 'agent', config: {} },
      ]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);

    const mockCacheStore = {
      get: vi.fn().mockReturnValue(null),
    };
    vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('No Agent Card cached')
    );
  });

  it('should send message successfully', async () => {
    const mockTargetsStore = {
      list: vi.fn().mockReturnValue([
        { id: 'test-agent', type: 'agent', config: { allow_local: true } },
      ]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);

    const mockCacheStore = {
      get: vi.fn().mockReturnValue({
        agentCard: { url: 'http://localhost:9999', name: 'Test Agent' },
      }),
    };
    vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: true,
        message: {
          role: 'assistant',
          parts: [{ text: 'Hello World' }],
        },
      }),
    };
    vi.mocked(A2AClient).mockImplementation(() => mockClient as unknown as A2AClient);

    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    expect(mockClient.sendMessage).toHaveBeenCalledWith('hello');
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Hello World')
    );
  });

  it('should respect allow_local from agent config', async () => {
    const mockTargetsStore = {
      list: vi.fn().mockReturnValue([
        { id: 'test-agent', type: 'agent', config: { allow_local: true } },
      ]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);

    const mockCacheStore = {
      get: vi.fn().mockReturnValue({
        agentCard: { url: 'http://localhost:9999', name: 'Test Agent' },
      }),
    };
    vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, message: { role: 'assistant', parts: [] } }),
    };
    vi.mocked(A2AClient).mockImplementation(() => mockClient as unknown as A2AClient);

    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    // Verify A2AClient was constructed with allowLocal: true
    expect(A2AClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ allowLocal: true })
    );
  });

  it('should not allow local by default', async () => {
    const mockTargetsStore = {
      list: vi.fn().mockReturnValue([
        { id: 'test-agent', type: 'agent', config: {} }, // No allow_local
      ]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);

    const mockCacheStore = {
      get: vi.fn().mockReturnValue({
        agentCard: { url: 'https://example.com', name: 'Test Agent' },
      }),
    };
    vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, message: { role: 'assistant', parts: [] } }),
    };
    vi.mocked(A2AClient).mockImplementation(() => mockClient as unknown as A2AClient);

    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    // Verify A2AClient was constructed with allowLocal: false
    expect(A2AClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ allowLocal: false })
    );
  });

  it('should handle A2A error response', async () => {
    const mockTargetsStore = {
      list: vi.fn().mockReturnValue([
        { id: 'test-agent', type: 'agent', config: {} },
      ]),
    };
    vi.mocked(TargetsStore).mockImplementation(() => mockTargetsStore as unknown as TargetsStore);

    const mockCacheStore = {
      get: vi.fn().mockReturnValue({
        agentCard: { url: 'https://example.com', name: 'Test Agent' },
      }),
    };
    vi.mocked(AgentCacheStore).mockImplementation(() => mockCacheStore as unknown as AgentCacheStore);

    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Connection refused',
      }),
    };
    vi.mocked(A2AClient).mockImplementation(() => mockClient as unknown as A2AClient);

    const context: ShellContext = { connector: 'test-agent' };
    await handleA2ASend(['hello'], context, '/tmp/config.json');
    
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('A2A error: Connection refused')
    );
  });
});
