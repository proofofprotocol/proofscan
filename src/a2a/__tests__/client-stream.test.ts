/**
 * A2A Client Streaming Tests
 *
 * Tests for the streamMessage() method which handles SSE responses
 * from the message/stream endpoint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { A2AClient } from '../client.js';
import type { AgentCard } from '../types.js';

describe('A2AClient.streamMessage', () => {
  const validAgentCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com',
    version: '1.0.0',
    description: 'A test agent',
  };

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create a mock SSE stream from an array of events
   */
  function createSSEStream(events: Array<{ type: string; data: unknown }>): ReadableStream {
    const sseLines = events.map(event => {
      const dataLine = `data: ${JSON.stringify(event)}`;
      return dataLine;
    }).join('\n\n');

    const sseData = sseLines + '\n\n'; // Double newline at end

    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });
  }

  /**
   * Helper to create a chunked SSE stream (simulates real streaming)
   */
  function createChunkedSSEStream(chunks: string[]): ReadableStream {
    return new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
          // Small delay to simulate network
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        controller.close();
      },
    });
  }

  describe('status events', () => {
    it('should receive status events in order', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-123',
            status: 'pending',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-123',
            status: 'working',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-123',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];
      const finalStatuses: Array<{ taskId: string; final: boolean }> = [];

      const result = await client.streamMessage('test message', {
        onStatus: (event) => {
          statuses.push(event.status);
          finalStatuses.push({ taskId: event.taskId, final: event.final || false });
        },
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-123');
      expect(statuses).toEqual(['pending', 'working', 'completed']);
      expect(finalStatuses).toEqual([
        { taskId: 'task-123', final: false },
        { taskId: 'task-123', final: false },
        { taskId: 'task-123', final: true },
      ]);
    });

    it('should receive status with contextId', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-456',
            contextId: 'ctx-abc',
            status: 'working',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-456',
            contextId: 'ctx-abc',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const contextIds: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => {
          if (event.contextId) {
            contextIds.push(event.contextId);
          }
        },
      });

      expect(result.ok).toBe(true);
      expect(contextIds).toEqual(['ctx-abc', 'ctx-abc']);
    });

    it('should receive status with message', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-789',
            status: 'working',
            message: {
              role: 'assistant',
              parts: [{ text: 'Processing your request...' }],
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-789',
            status: 'completed',
            message: {
              role: 'assistant',
              parts: [{ text: 'Done!' }],
            },
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const messages: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => {
          if (event.message) {
            const text = event.message.parts.find(p => 'text' in p)?.text;
            if (text) messages.push(text);
          }
        },
      });

      expect(result.ok).toBe(true);
      expect(messages).toEqual(['Processing your request...', 'Done!']);
    });

    it('should parse all valid status values', async () => {
      const validStatuses = [
        'pending',
        'working',
        'input_required',
        'completed',
        'failed',
        'canceled',
        'rejected',
      ] as const;

      for (const status of validStatuses) {
        const events = [
          {
            jsonrpc: '2.0',
            id: 'req-1',
            result: {
              taskId: 'task-test',
              status,
              final: true,
            },
          },
        ];

        const stream = createSSEStream(events);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: stream,
        } as Response);

        const client = new A2AClient(validAgentCard);

        const receivedStatuses: string[] = [];
        await client.streamMessage('test', {
          onStatus: (event) => {
            receivedStatuses.push(event.status);
          },
        });

        expect(receivedStatuses).toEqual([status]);
      }
    });
  });

  describe('artifact events', () => {
    it('should receive artifact events', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-artifact-1',
            status: 'working',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-artifact-1',
            artifact: {
              name: 'report.txt',
              description: 'Generated report',
              parts: [{ text: 'Report content here' }],
              index: 0,
              append: false,
              lastChunk: true,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-artifact-1',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const artifacts: Array<{
        name?: string;
        description?: string;
        text: string;
        index?: number;
        append: boolean;
        lastChunk: boolean;
      }> = [];

      const result = await client.streamMessage('test', {
        onArtifact: (event) => {
          const text = event.artifact.parts.find(p => 'text' in p)?.text || '';
          artifacts.push({
            name: event.artifact.name,
            description: event.artifact.description,
            text,
            index: event.artifact.index,
            append: event.artifact.append || false,
            lastChunk: event.artifact.lastChunk || false,
          });
        },
      });

      expect(result.ok).toBe(true);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toEqual({
        name: 'report.txt',
        description: 'Generated report',
        text: 'Report content here',
        index: 0,
        append: false,
        lastChunk: true,
      });
    });

    it('should receive artifact with binary data', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-binary',
            artifact: {
              name: 'image.png',
              parts: [
                {
                  data: 'base64encodeddata==',
                  mimeType: 'image/png',
                },
              ],
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-binary',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const binaryParts: Array<{ data: string; mimeType: string }> = [];

      await client.streamMessage('test', {
        onArtifact: (event) => {
          const dataPart = event.artifact.parts.find(p => 'data' in p);
          if (dataPart && 'data' in dataPart) {
            binaryParts.push({ data: dataPart.data, mimeType: dataPart.mimeType });
          }
        },
      });

      expect(binaryParts).toHaveLength(1);
      expect(binaryParts[0]).toEqual({
        data: 'base64encodeddata==',
        mimeType: 'image/png',
      });
    });

    it('should handle chunked artifacts', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-chunked',
            artifact: {
              name: 'large-file.txt',
              parts: [{ text: 'First chunk ' }],
              index: 0,
              append: false,
              lastChunk: false,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-chunked',
            artifact: {
              name: 'large-file.txt',
              parts: [{ text: 'second chunk ' }],
              index: 0,
              append: true,
              lastChunk: false,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-chunked',
            artifact: {
              name: 'large-file.txt',
              parts: [{ text: 'final chunk' }],
              index: 0,
              append: true,
              lastChunk: true,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-chunked',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const chunks: string[] = [];

      await client.streamMessage('test', {
        onArtifact: (event) => {
          const text = event.artifact.parts.find(p => 'text' in p)?.text || '';
          chunks.push(text);
        },
      });

      expect(chunks).toEqual(['First chunk ', 'second chunk ', 'final chunk']);
    });

    it('should receive artifact with contextId', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-with-ctx',
            contextId: 'ctx-artifact-123',
            artifact: {
              name: 'data.json',
              parts: [{ text: '{"data": "value"}' }],
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-with-ctx',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const contextIds: string[] = [];

      await client.streamMessage('test', {
        onArtifact: (event) => {
          if (event.contextId) {
            contextIds.push(event.contextId);
          }
        },
      });

      expect(contextIds).toEqual(['ctx-artifact-123']);
    });
  });

  describe('message events', () => {
    it('should receive standalone message events', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            role: 'assistant',
            parts: [{ text: 'Hello! How can I help you today?' }],
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-msg',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const messages: string[] = [];

      const result = await client.streamMessage('test', {
        onMessage: (msg) => {
          const text = msg.parts.find(p => 'text' in p)?.text;
          if (text) messages.push(text);
        },
      });

      expect(result.ok).toBe(true);
      expect(messages).toEqual(['Hello! How can I help you today?']);
    });

    it('should receive message with metadata', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            role: 'assistant',
            parts: [{ text: 'Response with metadata' }],
            metadata: {
              model: 'gpt-4',
              tokens: 42,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-meta',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const metadatas: Array<Record<string, unknown>> = [];

      await client.streamMessage('test', {
        onMessage: (msg) => {
          if (msg.metadata) {
            metadatas.push(msg.metadata);
          }
        },
      });

      expect(metadatas).toHaveLength(1);
      expect(metadatas[0]).toEqual({
        model: 'gpt-4',
        tokens: 42,
      });
    });

    it('should receive message with contextId', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            role: 'assistant',
            parts: [{ text: 'In context' }],
            contextId: 'ctx-message-456',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-msg-ctx',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const contextIds: string[] = [];

      await client.streamMessage('test', {
        onMessage: (msg) => {
          if (msg.contextId) {
            contextIds.push(msg.contextId);
          }
        },
      });

      expect(contextIds).toEqual(['ctx-message-456']);
    });

    it('should receive message with referenceTaskIds', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            role: 'assistant',
            parts: [{ text: 'Based on previous tasks' }],
            referenceTaskIds: ['task-1', 'task-2', 'task-3'],
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-ref',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const referenceIds: string[][] = [];

      await client.streamMessage('test', {
        onMessage: (msg) => {
          if (msg.referenceTaskIds) {
            referenceIds.push(msg.referenceTaskIds);
          }
        },
      });

      expect(referenceIds).toEqual([['task-1', 'task-2', 'task-3']]);
    });
  });

  describe('task events', () => {
    it('should receive complete task events', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            id: 'task-complete',
            status: 'completed',
            messages: [
              {
                role: 'user',
                parts: [{ text: 'User message' }],
              },
              {
                role: 'assistant',
                parts: [{ text: 'Assistant response' }],
              },
            ],
            artifacts: [
              {
                name: 'output.txt',
                parts: [{ text: 'Artifact content' }],
              },
            ],
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const tasks: Array<{ id: string; status: string; messageCount: number; artifactCount: number }> = [];

      await client.streamMessage('test', {
        onTask: (task) => {
          tasks.push({
            id: task.id,
            status: task.status,
            messageCount: task.messages.length,
            artifactCount: task.artifacts?.length || 0,
          });
        },
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: 'task-complete',
        status: 'completed',
        messageCount: 2,
        artifactCount: 1,
      });
    });
  });

  describe('mixed events', () => {
    it('should handle mixed event types', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-mixed',
            status: 'working',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            role: 'assistant',
            parts: [{ text: 'Progress update...' }],
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-mixed',
            artifact: {
              name: 'partial.txt',
              parts: [{ text: 'Partial result' }],
              index: 0,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-mixed',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statusEvents: string[] = [];
      const messageTexts: string[] = [];
      const artifactNames: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => {
          statusEvents.push(event.status);
        },
        onMessage: (msg) => {
          const text = msg.parts.find(p => 'text' in p)?.text;
          if (text) messageTexts.push(text);
        },
        onArtifact: (event) => {
          if (event.artifact.name) {
            artifactNames.push(event.artifact.name);
          }
        },
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('task-mixed');
      expect(statusEvents).toEqual(['working', 'completed']);
      expect(messageTexts).toEqual(['Progress update...']);
      expect(artifactNames).toEqual(['partial.txt']);
    });
  });

  describe('error handling', () => {
    it('should handle connection timeout', async () => {
      vi.useFakeTimers();

      const controller = new AbortController();
      vi.spyOn(global, 'AbortController').mockImplementation(() => controller);

      mockFetch.mockImplementationOnce(() => {
        return new Promise<Response>((_, reject) => {
          const timeout = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Aborted', 'AbortError'));
          }, 100);
          return timeout as any;
        });
      });

      const client = new A2AClient(validAgentCard);
      const fetchPromise = client.streamMessage('test', { timeout: 1000 });
      await vi.advanceTimersByTimeAsync(200);
      const result = await fetchPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Timeout');

      vi.useRealTimers();
    });

    it('should handle external abort signal', async () => {
      vi.useFakeTimers();

      const controller = new AbortController();
      vi.spyOn(global, 'AbortController').mockImplementation(() => controller);

      mockFetch.mockImplementationOnce(() => {
        return new Promise<Response>((_, reject) => {
          const timeout = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Aborted', 'AbortError'));
          }, 50);
          return timeout as any;
        });
      });

      const client = new A2AClient(validAgentCard);
      const fetchPromise = client.streamMessage('test', {
        timeout: 5000,
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(100);
      const result = await fetchPromise;

      expect(result.ok).toBe(false);

      vi.useRealTimers();
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
      } as Response);

      const client = new A2AClient(validAgentCard);

      const result = await client.streamMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('should handle non-SSE content-type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{}'));
            controller.close();
          },
        }),
      } as Response);

      const client = new A2AClient(validAgentCard);

      const result = await client.streamMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Expected SSE');
    });

    it('should handle empty response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: null,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const result = await client.streamMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No response body');
    });

    it('should handle invalid JSON in event data', async () => {
      const sseData = 'data: invalid json\n\ndata: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"completed","final":true}}\n\n';

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const errors: string[] = [];
      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
        onError: (err) => errors.push(err),
      });

      expect(result.ok).toBe(true);
      expect(result.taskId).toBe('t1');
      expect(statuses).toEqual(['completed']);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Parse error');
    });

    it('should handle [DONE] sentinel', async () => {
      const sseData = [
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"working"}}',
        'data: [DONE]',
      ].join('\n\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      expect(result.ok).toBe(true);
      expect(statuses).toEqual(['working']);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network connection lost'));

      const client = new A2AClient(validAgentCard);

      const result = await client.streamMessage('test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Network connection lost');
    });
  });

  describe('SSE format edge cases', () => {
    it('should handle chunked SSE data (split lines)', async () => {
      const chunks = [
        'data: {"jsonrpc":"2.0","id":"1","result":',
        '{"taskId":"t1","status":"working"}}\n\n',
        'data: {"jsonrpc":"2.0","id":"1","result":',
        '{"taskId":"t1","status":"completed","final":true}}\n\n',
      ];

      const stream = createChunkedSSEStream(chunks);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      expect(result.ok).toBe(true);
      expect(statuses).toEqual(['working', 'completed']);
    });

    it('should handle empty lines in SSE stream', async () => {
      const sseData = [
        '',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"working"}}',
        '',
        '',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"completed","final":true}}',
        '',
      ].join('\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      expect(result.ok).toBe(true);
      expect(statuses).toEqual(['working', 'completed']);
    });

    it('should handle non-data lines in SSE stream', async () => {
      const sseData = [
        'event: message',
        'id: 1',
        'retry: 1000',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"working"}}',
        '',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"completed","final":true}}',
        '',
      ].join('\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      expect(result.ok).toBe(true);
      expect(statuses).toEqual(['working', 'completed']);
    });

    it('should handle unknown event types gracefully', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-unknown',
            status: 'working',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            unknownField: 'value',
          },
        },
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-unknown',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      // Unknown events are silently ignored, but status events are processed
      expect(result.ok).toBe(true);
      expect(statuses).toEqual(['working', 'completed']);
    });
  });

  describe('SSRF protection', () => {
    it('should reject streaming to private URLs', async () => {
      const privateAgentCard: AgentCard = {
        ...validAgentCard,
        url: 'http://localhost:8080',
      };

      expect(() => {
        new A2AClient(privateAgentCard);
      }).toThrow('Private or local URLs are not allowed');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject streaming to 127.0.0.1', async () => {
      const privateAgentCard: AgentCard = {
        ...validAgentCard,
        url: 'http://127.0.0.1:8080',
      };

      expect(() => {
        new A2AClient(privateAgentCard);
      }).toThrow('Private or local URLs are not allowed');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('options', () => {
    it('should use custom headers', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-headers',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      await client.streamMessage('test', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    it('should use custom timeout', async () => {
      vi.useFakeTimers();

      const controller = new AbortController();
      vi.spyOn(global, 'AbortController').mockImplementation(() => controller);

      mockFetch.mockImplementationOnce(() => {
        return new Promise<Response>((_, reject) => {
          const timeout = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Aborted', 'AbortError'));
          }, 50);
          return timeout as any;
        });
      });

      const client = new A2AClient(validAgentCard);
      const fetchPromise = client.streamMessage('test', { timeout: 50 });
      await vi.advanceTimersByTimeAsync(100);
      const result = await fetchPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Timeout');

      vi.useRealTimers();
    });

    it('should send A2AMessage object instead of string', async () => {
      const events = [
        {
          jsonrpc: '2.0',
          id: 'req-1',
          result: {
            taskId: 'task-msg-obj',
            status: 'completed',
            final: true,
          },
        },
      ];

      const stream = createSSEStream(events);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const messageObj = {
        role: 'user' as const,
        parts: [
          { text: 'Hello' },
          { data: 'base64data', mimeType: 'text/plain' },
        ],
      };

      await client.streamMessage(messageObj);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      expect(requestBody.params.message).toEqual(messageObj);
    });

    it('should end stream on final: true without waiting for close', async () => {
      const sseData = [
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"working"}}',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"completed","final":true}}',
        'data: {"jsonrpc":"2.0","id":"1","result":{"taskId":"t1","status":"working"}}',
      ].join('\n\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      } as Response);

      const client = new A2AClient(validAgentCard);

      const statuses: string[] = [];

      const result = await client.streamMessage('test', {
        onStatus: (event) => statuses.push(event.status),
      });

      expect(result.ok).toBe(true);
      // Should stop at final: true, ignoring subsequent events
      expect(statuses).toEqual(['working', 'completed']);
    });
  });
});
