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

  // ===== 正常系テスト =====

  describe('正常系', () => {
    it('1. ステータスイベント受信: onStatus コールバックが呼ばれる', async () => {
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

    it('2. メッセージイベント受信: onMessage コールバックが呼ばれる', async () => {
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

    it('3. final=true で終了: ストリームが正常終了し ok=true を返す', async () => {
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

    it('4. [DONE] マーカーを受信してもエラーにならない', async () => {
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
      // [DONE] はスキップされるので2つのイベントのみ
      expect(statusEvents).toHaveLength(2);
    });

    it('複数のイベントタイプが混在しても正しく処理される', async () => {
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

    it('文字列メッセージと A2AMessage オブジェクト両方で動作する', async () => {
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

    it('A2ATask イベントも受信できる', async () => {
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
  });

  // ===== 異常系テスト =====

  describe('異常系', () => {
    it('5. 非SSEレスポンス: Content-Type が text/event-stream でない場合エラーを返す', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse(['data: {}\n\n'], 'application/json')
      );

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Non-SSE test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Expected SSE');
      expect(result.error).toContain('application/json');
    });

    it('6. タイムアウト: AbortSignal が渡される', async () => {
      // タイムアウト時にAbortControllerが作成されることを確認
      // Note: fetch モックが AbortSignal を尊重しないため、実際のタイムアウト動作は統合テストで検証
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

      // fetch が呼ばれ、signal が渡されていることを確認
      expect(fetch).toHaveBeenCalled();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.signal).toBeDefined();
      expect(result.ok).toBe(true);
    });

    it('7. パースエラー: 不正なJSONの場合 onError コールバックが呼ばれる', async () => {
      const errors: string[] = [];

      vi.mocked(fetch).mockResolvedValueOnce(
        createSSEResponse([
          sseEvent({
            result: {
              taskId: 'task-parse',
              status: 'working',
            },
          }),
          'data: {invalid json}\n\n', // 不正なJSON
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

      // エラーがあってもストリームは続く
      expect(result.ok).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Parse error');
    });

    it('HTTP エラー応答を処理できる', async () => {
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

    it('ネットワークエラーを処理できる', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Network error test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Error: Network error');
    });

    it('レスポンスボディがない場合エラーを返す', async () => {
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

    it('外部 AbortSignal を受け入れられる', async () => {
      const controller = new AbortController();

      vi.mocked(fetch).mockImplementationOnce(() => {
        // シグナルで中止されるまで待つ
        return new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const client = new A2AClient(validAgentCard);
      const resultPromise = client.streamMessage('Abort test', {
        signal: controller.signal,
        timeout: 60000, // デフォルトのタイムアウト
      });

      // 外部から中止
      controller.abort();

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Timeout after 60000ms');
    });

    it('カスタムヘッダーを送信できる', async () => {
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
      expect(fetchCall[1].headers).toMatchObject({
        'X-Default-Header': 'default-value',
        'X-Custom-Header': 'custom-value',
      });
    });
  });

  // ===== プライベートURL保護 =====

  describe('SSRF Protection', () => {
    it('プライベートURLをブロックする', async () => {
      const privateAgent: AgentCard = {
        ...validAgentCard,
        url: 'http://localhost:8080',
      };

      vi.mocked(fetch).mockResolvedValueOnce(createSSEResponse([]));

      // コンストラクタでエラーになるはず
      expect(() => new A2AClient(privateAgent)).toThrow(
        'Private or local URLs are not allowed'
      );
    });

    it('127.0.0.1 URLをブロックする', async () => {
      const privateAgent: AgentCard = {
        ...validAgentCard,
        url: 'http://127.0.0.1:8080',
      };

      expect(() => new A2AClient(privateAgent)).toThrow(
        'Private or local URLs are not allowed'
      );
    });
  });

  // ===== エッジケース =====

  describe('エッジケース', () => {
    it('空のストリームも正常終了する', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(createSSEResponse([]));

      const client = new A2AClient(validAgentCard);
      const result = await client.streamMessage('Empty stream test');

      expect(result.ok).toBe(true);
      expect(result.taskId).toBeUndefined();
    });

    // Note: チャンク分割処理、複数行バッファ、unknown eventスキップは統合テストで検証
    // モックのReadableStream実装の制限により、ユニットテストでは安定しない
  });
});
