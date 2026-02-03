/**
 * A2A Client Streaming Tests
 *
 * Tests for streamMessage() method (SSE-based streaming).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { A2AClient } from '../client.js';
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
    fetchAgentCard: vi.fn(),
  };
});

/**
 * Helper to create a mock SSE response
 */
function createSSEResponse(chunks: string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder();
  const chunksEncoded = chunks.map((chunk) => encoder.encode(chunk));

  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunksEncoded) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    body: stream,
    url: 'https://test.example.com/message/stream',
  } as Response;
}

/**
 * Helper to create SSE event line
 */
function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

describe('A2AClient - streamMessage', () => {
  const validAgentCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com',
    version: '1.0.0',
    description: 'A test agent',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== Normal Cases =====

  describe('Normal cases', () => {
    it('1. Status events: onStatus callback is called', async () => {
      const statusEvents: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-123',
              status: 'working',
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-123',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Hello', {
        onStatus: (event) => statusEvents.push(event),
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-123');
      expect(statusEvents).toHaveLength(2);
      expect(statusEvents[0]).toEqual({
        taskId: 'task-123',
        status: 'working',
        final: false,
      });
      expect(statusEvents[1]).toEqual({
        taskId: 'task-123',
        status: 'completed',
        final: true,
      });
    });

    it('2. Message events: onMessage callback is called', async () => {
      const messages: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              role: 'assistant',
              parts: [{ text: 'Hello there!' }],
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-456',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Test', {
        onMessage: (message) => messages.push(message),
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-456');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: 'assistant',
        parts: [{ text: 'Hello there!' }],
      });
    });

    it('3. Final flag: stream terminates normally with ok=true', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-final',
              status: 'working',
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-final',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Final test');

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-final');
      expect(result.error).toBeUndefined();
    });

    it('4. [DONE] marker: no error when received', async () => {
      const statusEvents: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-done',
              status: 'working',
            },
          }),
          'data: [DONE]\n\n',
          sseEvent({
            result: {
              taskId: 'task-done',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Done test', {
        onStatus: (event) => statusEvents.push(event),
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-done');
      // [DONE] is skipped, so only 2 events
      expect(statusEvents).toHaveLength(2);
    });

    it('handles multiple event types correctly', async () => {
      const statusEvents: Array<unknown> = [];
      const messages: Array<unknown> = [];
      const artifacts: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-multi',
              status: 'working',
            },
          }),
          sseEvent({
            result: {
              role: 'assistant',
              parts: [{ text: 'Processing...' }],
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-multi',
              artifact: {
                name: 'report.txt',
                parts: [{ text: 'Report content' }],
              },
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-multi',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Multi event test', {
        onStatus: (e) => statusEvents.push(e),
        onMessage: (m) => messages.push(m),
        onArtifact: (a) => artifacts.push(a),
      });

      expect(result.ok).toBe(true);
      expect(statusEvents).toHaveLength(2);
      expect(messages).toHaveLength(1);
      expect(artifacts).toHaveLength(1);
    });

    it('works with both string and A2AMessage object', async () => {
      const client = new A2AClient(validAgentCard);

      // String message
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-string',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const result1 = await client.streamMessage('String message');
      expect(result1.ok).toBe(true);

      // A2AMessage object (clear mocks first)
      vi.clearAllMocks();
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-object',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const result2 = await client.streamMessage({
        role: 'user',
        parts: [{ text: 'Object message' }],
      });
      expect(result2.ok).toBe(true);
    });

    it('receives A2ATask events via onTask callback', async () => {
      const tasks: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              id: 'task-789',
              status: 'completed',
              messages: [
                {
                  role: 'user',
                  parts: [{ text: 'Task message' }],
                },
              ],
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Task event test', {
        onTask: (task) => tasks.push(task),
      });

      expect(result.ok).toBe(true);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: 'task-789',
        status: 'completed',
        messages: [{ role: 'user', parts: [{ text: 'Task message' }] }],
      });
    });

    it('handles message with contextId and metadata', async () => {
      const messages: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              role: 'assistant',
              parts: [{ text: 'Hello' }],
              contextId: 'ctx-123',
              metadata: { source: 'test', version: 1 },
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-meta',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Metadata test', {
        onMessage: (m) => messages.push(m),
      });

      expect(result.ok).toBe(true);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        parts: [{ text: 'Hello' }],
        contextId: 'ctx-123',
        metadata: { source: 'test', version: 1 },
      });
    });

    it('handles message with referenceTaskIds', async () => {
      const messages: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              role: 'assistant',
              parts: [{ text: 'Reference message' }],
              referenceTaskIds: ['task-1', 'task-2'],
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-ref',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Reference test', {
        onMessage: (m) => messages.push(m),
      });

      expect(result.ok).toBe(true);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        parts: [{ text: 'Reference message' }],
        referenceTaskIds: ['task-1', 'task-2'],
      });
    });

    it('handles artifact with chunking fields (index, append, lastChunk)', async () => {
      const artifacts: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-chunk',
              artifact: {
                name: 'large-file.txt',
                parts: [{ text: 'First chunk' }],
                index: 0,
                append: false,
                lastChunk: false,
              },
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-chunk',
              artifact: {
                name: 'large-file.txt',
                parts: [{ text: 'Second chunk' }],
                index: 0,
                append: true,
                lastChunk: true,
              },
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-chunk',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Chunked artifact test', {
        onArtifact: (a) => artifacts.push(a),
      });

      expect(result.ok).toBe(true);
      expect(artifacts).toHaveLength(2);
      expect(artifacts[0]).toMatchObject({
        taskId: 'task-chunk',
        artifact: {
          name: 'large-file.txt',
          parts: [{ text: 'First chunk' }],
          index: 0,
          append: false,
          lastChunk: false,
        },
      });
      expect(artifacts[1]).toMatchObject({
        taskId: 'task-chunk',
        artifact: {
          name: 'large-file.txt',
          parts: [{ text: 'Second chunk' }],
          index: 0,
          append: true,
          lastChunk: true,
        },
      });
    });

    it('handles status event with contextId', async () => {
      const statusEvents: Array<unknown> = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-ctx',
              contextId: 'session-456',
              status: 'working',
            },
          }),
          sseEvent({
            result: {
              taskId: 'task-ctx',
              contextId: 'session-456',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Context test', {
        onStatus: (e) => statusEvents.push(e),
      });

      expect(result.ok).toBe(true);
      expect(statusEvents).toHaveLength(2);
      expect(statusEvents[0]).toMatchObject({
        taskId: 'task-ctx',
        contextId: 'session-456',
        status: 'working',
      });
      expect(statusEvents[1]).toMatchObject({
        taskId: 'task-ctx',
        contextId: 'session-456',
        status: 'completed',
        final: true,
      });
    });
  });

  // ===== Error Cases =====

  describe('Error cases', () => {
    it('5. Non-SSE response: returns error when Content-Type is not text/event-stream', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse(['data: {}\n\n'], 'application/json')
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Non-SSE test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Expected SSE');
      expect(result.error).toContain('application/json');
    });

    it('6. Timeout: AbortSignal is passed to fetch', async () => {
      // Verify AbortController is created for timeout
      // Note: fetch mock doesn't respect AbortSignal, so actual timeout behavior is deferred to integration tests
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-timeout-check',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Timeout test', { timeout: 1000 });

      // Verify fetch was called with signal
      expect(fetch).toHaveBeenCalled();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.signal).toBeDefined();
      expect(result.ok).toBe(true);
    });

    it('7. Parse error: onError callback is called for invalid JSON', async () => {
      const errors: string[] = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-parse',
              status: 'working',
            },
          }),
          'data: {invalid json}\n\n', // Invalid JSON
          sseEvent({
            result: {
              taskId: 'task-parse',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Parse error test', {
        onError: (error) => errors.push(error),
      });

      // Stream continues even with errors
      expect(result.ok).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Parse error');
    });

    it('handles HTTP error responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        url: 'https://test.example.com/message/stream',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('HTTP error test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('500');
      expect(result.error).toContain('Internal Server Error');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Network error test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Error: Network error');
    });

    it('returns error when response body is missing', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: null,
        url: 'https://test.example.com/message/stream',
      } as Response);

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('No body test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('No response body');
    });

    it('accepts external AbortSignal', async () => {
      const controller = new AbortController();

      vi.mocked(fetch).mockImplementationOnce(() => {
        // Wait until aborted by signal
        return new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const client = new A2AClient(validAgentCard);
      const resultPromise = client.streamMessage('Abort test', {
        signal: controller.signal,
        timeout: 60000, // Default timeout
      });

      // Abort from external signal
      controller.abort();

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Timeout after 60000ms');
    });

    it('sends custom headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-headers',
              status: 'completed',
              final: true,
            },
          }),
        ])
      );

      const client = new A2AClient(validAgentCard, {
        headers: { 'X-Default-Header': 'default-value' },
      });

      await client.streamMessage('Headers test', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1].headers).toEqual({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Default-Header': 'default-value',
        'X-Custom-Header': 'custom-value',
      });
    });
  });

  // ===== SSRF Protection =====

  describe('SSRF Protection', () => {
    it('blocks localhost URLs', async () => {
      const privateAgent: AgentCard = {
        ...validAgentCard,
        url: 'http://localhost:8080',
      };

      vi.mocked(fetch).mockResolvedValueOnce(createSSEResponse([]));

      // Should throw error in constructor
      expect(() => new A2AClient(privateAgent)).toThrow(
        'Private or local URLs are not allowed'
      );
    });

    it('blocks 127.0.0.1 URLs', async () => {
      const privateAgent: AgentCard = {
        ...validAgentCard,
        url: 'http://127.0.0.1:8080',
      };

      expect(() => new A2AClient(privateAgent)).toThrow(
        'Private or local URLs are not allowed'
      );
    });
  });

  // ===== Edge Cases =====

  describe('Edge cases', () => {
    it('empty stream terminates normally', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createSSEResponse([]));

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Empty stream test');

      expect(result.ok).toBe(true);
      expect(result.taskId).toBeUndefined();
    });

    // Note: Chunk splitting, multi-line buffer, and unknown event skip are deferred to integration tests
    // Due to limitations in mocking ReadableStream behavior in unit tests
  });
});
