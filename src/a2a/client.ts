/**
 * A2A Client
 *
 * Client for sending messages to A2A agents via JSON-RPC 2.0.
 * Implements message/send, tasks/get, tasks/list, and tasks/cancel operations.
 *
 * Phase 4 - Client Implementation
 * Phase 2 - Task Management (getTask, listTasks, cancelTask)
 */

import { randomUUID } from 'crypto';
import type { AgentCard, StreamEvent, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, StreamMessageResult, A2AMessage, A2ATask, Task, ListTasksParams, ListTasksResponse } from './types.js';
import { isPrivateUrl } from './agent-card.js';

// Maximum response size (1MB) to prevent DoS
const MAX_RESPONSE_SIZE = 1024 * 1024;

// Re-export types from types.ts for backward compatibility
export type { A2AMessage, A2ATask, Task, ListTasksParams, ListTasksResponse } from './types.js';

// ===== JSON-RPC Types =====

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ===== Client Options =====

export interface SendMessageOptions {
  timeout?: number;  // default: 30000ms
  headers?: Record<string, string>;
  blocking?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  task?: A2ATask;
  message?: A2AMessage;
  error?: string;
  statusCode?: number;
}

export interface StreamMessageOptions {
  timeout?: number; // default: 60000ms
  headers?: Record<string, string>;
  onStatus?: (event: TaskStatusUpdateEvent) => void;
  onArtifact?: (event: TaskArtifactUpdateEvent) => void;
  onMessage?: (message: A2AMessage) => void;
  onTask?: (task: A2ATask) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal; // External abort signal
}

// ===== Task Management Options (Phase 2) =====

export interface GetTaskOptions {
  historyLength?: number;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface GetTaskResult {
  ok: boolean;
  task?: Task;
  error?: string;
  statusCode?: number;
}

export interface CancelTaskResult {
  ok: boolean;
  task?: Task;
  error?: string;
  statusCode?: number;
}

export interface ListTasksResult {
  ok: boolean;
  response?: ListTasksResponse;
  error?: string;
  statusCode?: number;
}

// ===== A2A Client =====

/**
 * A2A Client for sending messages to agents
 */
export class A2AClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private agentCard: AgentCard;

  private allowLocal: boolean;

  constructor(agentCard: AgentCard, options?: { headers?: Record<string, string>; allowLocal?: boolean }) {
    this.agentCard = agentCard;
    this.baseUrl = agentCard.url.replace(/\/$/, '');
    this.allowLocal = options?.allowLocal ?? false;

    // SSRF protection: Block private URLs in constructor
    if (isPrivateUrl(this.baseUrl) && !this.allowLocal) {
      throw new Error('Private or local URLs are not allowed');
    }

    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options?.headers,
    };
  }

  /**
   * Send a message to the agent
   * POST /message/send (JSON-RPC 2.0)
   */
  async sendMessage(
    message: string | A2AMessage,
    options: SendMessageOptions = {}
  ): Promise<SendMessageResult> {
    const { timeout = 30000, headers = {}, blocking = false } = options;

    // Convert string message to A2AMessage with unique messageId
    const messageId = randomUUID();
    const a2aMessage: A2AMessage =
      typeof message === 'string'
        ? { role: 'user', parts: [{ text: message }], messageId }
        : { ...message, messageId: message.messageId ?? messageId };

    // Build JSON-RPC request with unique ID
    const requestId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/send',
      params: {
        message: a2aMessage,
        configuration: blocking ? { blocking: true } : undefined,
      },
    };

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // SSRF protection (defense-in-depth): Double-check URL even though constructor validates
      if (isPrivateUrl(this.baseUrl) && !this.allowLocal) {
        return {
          ok: false,
          error: 'Private or local URLs are not allowed',
        };
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { ...this.defaultHeaders, ...headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      // Validate Content-Type
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Expected JSON response, got ${contentType || 'unknown'}`,
        };
      }

      // Check Content-Length for size limit
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      const responseText = await response.text();

      // Validate actual response size
      if (responseText.length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${responseText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      let responseData: JsonRpcResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          error: `Invalid JSON response: ${responseText.slice(0, 200)}`,
        };
      }

      // Handle JSON-RPC error
      if (responseData.error) {
        return {
          ok: false,
          statusCode: response.status,
          error: `${responseData.error.code}: ${responseData.error.message}`,
        };
      }

      // Parse result - can be Task or Message
      if (!responseData.result) {
        return {
          ok: false,
          statusCode: response.status,
          error: 'No result in response',
        };
      }

      const result = responseData.result as Record<string, unknown>;

      // Check if result is a Task (has 'status' field)
      if ('status' in result) {
        const task = this.parseTask(result);
        return { ok: true, task };
      }

      // Check if result is a Message (has 'role' field)
      if ('role' in result) {
        const msg = this.parseMessage(result);
        return { ok: true, message: msg };
      }

      return {
        ok: false,
        statusCode: response.status,
        error: `Unknown response type: ${JSON.stringify(result).slice(0, 200)}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            ok: false,
            error: `Request timeout after ${timeout}ms`,
          };
        }
        return {
          ok: false,
          error: error.message,
        };
      }
      return {
        ok: false,
        error: String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get task by ID (Phase 2 - A2A Protocol Compliant)
   * POST /a2a (JSON-RPC 2.0)
   *
   * @param taskId - The task ID to retrieve
   * @param options - Optional: historyLength, headers, timeout
   * @returns Promise<GetTaskResult> with task or error
   */
  async getTask(taskId: string, options: GetTaskOptions = {}): Promise<GetTaskResult> {
    const { historyLength, headers = {}, timeout = 30000 } = options;

    const requestId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tasks/get',
      params: {
        id: taskId,
        ...(historyLength !== undefined && { historyLength }),
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { ...this.defaultHeaders, ...headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Expected JSON response, got ${contentType || 'unknown'}`,
        };
      }

      const responseText = await response.text();

      if (responseText.length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${responseText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      let responseData: JsonRpcResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          error: `Invalid JSON response: ${responseText.slice(0, 200)}`,
        };
      }

      if (responseData.error) {
        return {
          ok: false,
          statusCode: response.status,
          error: `${responseData.error.code}: ${responseData.error.message}`,
        };
      }

      if (!responseData.result) {
        return {
          ok: false,
          statusCode: response.status,
          error: 'No result in response',
        };
      }

      const task = this.parseTask(responseData.result as Record<string, unknown>);
      return { ok: true, task };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            ok: false,
            error: `Request timeout after ${timeout}ms`,
          };
        }
        return {
          ok: false,
          error: error.message,
        };
      }
      return {
        ok: false,
        error: String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * List tasks with optional filters (Phase 2)
   * POST /a2a (JSON-RPC 2.0)
   *
   * @param params - Optional: contextId, status, pageSize, pageToken, includeArtifacts
   * @returns Promise<ListTasksResult> with tasks list or error
   */
  async listTasks(params?: ListTasksParams): Promise<ListTasksResult> {
    const requestId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tasks/list',
      params: (params || {}) as Record<string, unknown>,
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(request),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Expected JSON response, got ${contentType || 'unknown'}`,
        };
      }

      const responseText = await response.text();

      if (responseText.length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${responseText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      let responseData: JsonRpcResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          error: `Invalid JSON response: ${responseText.slice(0, 200)}`,
        };
      }

      if (responseData.error) {
        return {
          ok: false,
          statusCode: response.status,
          error: `${responseData.error.code}: ${responseData.error.message}`,
        };
      }

      if (!responseData.result) {
        return {
          ok: false,
          statusCode: response.status,
          error: 'No result in response',
        };
      }

      const result = responseData.result as Record<string, unknown>;
      const tasks: Task[] = [];

      if (Array.isArray(result.tasks)) {
        for (const taskData of result.tasks) {
          tasks.push(this.parseTask(taskData as Record<string, unknown>));
        }
      }

      const listResponse: ListTasksResponse = {
        tasks,
        nextPageToken: result.nextPageToken ? String(result.nextPageToken) : '',
        pageSize: typeof result.pageSize === 'number' ? result.pageSize : 50,
        totalSize: typeof result.totalSize === 'number' ? result.totalSize : undefined,
      };

      return { ok: true, response: listResponse };
    } catch (error) {
      if (error instanceof Error) {
        return {
          ok: false,
          error: error.message,
        };
      }
      return {
        ok: false,
        error: String(error),
      };
    }
  }

  /**
   * Cancel a task (Phase 2 - A2A Protocol Compliant)
   * POST /a2a (JSON-RPC 2.0)
   *
   * @param taskId - The task ID to cancel
   * @returns Promise<CancelTaskResult> with canceled task or error
   */
  async cancelTask(taskId: string): Promise<CancelTaskResult> {
    const requestId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tasks/cancel',
      params: {
        id: taskId,
      },
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(request),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Expected JSON response, got ${contentType || 'unknown'}`,
        };
      }

      const responseText = await response.text();

      if (responseText.length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${responseText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      let responseData: JsonRpcResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          error: `Invalid JSON response: ${responseText.slice(0, 200)}`,
        };
      }

      if (responseData.error) {
        return {
          ok: false,
          statusCode: response.status,
          error: `${responseData.error.code}: ${responseData.error.message}`,
        };
      }

      // Parse the canceled task from response
      if (responseData.result) {
        const task = this.parseTask(responseData.result as Record<string, unknown>);
        return { ok: true, task };
      }

      return { ok: true };
    } catch (error) {
      if (error instanceof Error) {
        return {
          ok: false,
          error: error.message,
        };
      }
      return {
        ok: false,
        error: String(error),
      };
    }
  }

  /**
   * Stream message to agent
   * POST /message/stream (JSON-RPC 2.0 + SSE response)
   */
  async streamMessage(
    message: string | A2AMessage,
    options: StreamMessageOptions = {}
  ): Promise<StreamMessageResult> {
    const {
      timeout = 60000,
      headers = {},
      onStatus,
      onArtifact,
      onMessage,
      onTask,
      onError,
      signal,
    } = options;

    // Build JSON-RPC request
    const a2aMessage: A2AMessage =
      typeof message === 'string'
        ? { role: 'user', parts: [{ text: message }] }
        : message;

    const requestId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/stream',
      params: { message: a2aMessage },
    };

    // Abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine with external signal if provided
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      // SSRF protection (defense-in-depth)
      if (isPrivateUrl(this.baseUrl)) {
        return {
          ok: false,
          error: 'Private or local URLs are not allowed',
        };
      }

      const response = await fetch(`${this.baseUrl}/message/stream`, {
        method: 'POST',
        headers: { ...this.defaultHeaders, ...headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        return {
          ok: false,
          error: `Expected SSE, got ${contentType}`,
        };
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        return { ok: false, error: 'No response body' };
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let taskId: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const event = this.parseStreamEvent(json);

              if (event) {
                switch (event.type) {
                  case 'status':
                    taskId = event.event.taskId;
                    onStatus?.(event.event);
                    if (event.event.final) {
                      return { ok: true, taskId };
                    }
                    break;
                  case 'artifact':
                    onArtifact?.(event.event);
                    break;
                  case 'message':
                    onMessage?.(event.message);
                    break;
                  case 'task':
                    taskId = event.task.id;
                    onTask?.(event.task);
                    break;
                }
              }
            } catch (e) {
              onError?.(`Parse error: ${e}`);
            }
          }
        }
      }

      return { ok: true, taskId };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, error: `Timeout after ${timeout}ms` };
      }
      return { ok: false, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse Task from JSON-RPC response
   */
  private parseTask(data: Record<string, unknown>): A2ATask {
    const task: A2ATask = {
      id: String(data.id || ''),
      status: this.parseTaskStatus(data.status),
      messages: [],
      artifacts: undefined,
      createdAt: data.createdAt ? String(data.createdAt) : undefined,
      updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
      contextId: data.contextId ? String(data.contextId) : undefined,
    };

    // Parse messages (A2A uses 'history' field, some agents use 'messages')
    const messageList = Array.isArray(data.history) ? data.history : 
                        Array.isArray(data.messages) ? data.messages : [];
    if (messageList.length > 0) {
      task.messages = messageList.map(msg => this.parseMessage(msg));
    }

    // Parse artifacts
    if (Array.isArray(data.artifacts)) {
      task.artifacts = data.artifacts.map(art => ({
        name: art.name ? String(art.name) : undefined,
        description: art.description ? String(art.description) : undefined,
        parts: Array.isArray(art.parts)
          ? art.parts.map((part: unknown) => this.parsePart(part))
          : [],
      }));
    }

    return task;
  }

  /**
   * Parse Message from JSON-RPC response
   */
  private parseMessage(data: unknown): A2AMessage {
    if (!data || typeof data !== 'object') {
      return { role: 'user', parts: [] };
    }

    const obj = data as Record<string, unknown>;
    const message: A2AMessage = {
      // A2A protocol uses 'agent' for assistant responses
      role: (obj.role === 'assistant' || obj.role === 'agent') ? 'assistant' : 'user',
      parts: [],
      metadata: obj.metadata as Record<string, unknown> | undefined,
      contextId: obj.contextId ? String(obj.contextId) : undefined,
      referenceTaskIds: Array.isArray(obj.referenceTaskIds)
        ? obj.referenceTaskIds.map(String)
        : undefined,
    };

    if (Array.isArray(obj.parts)) {
      message.parts = obj.parts.map(part => this.parsePart(part));
    }

    return message;
  }

  /**
   * Parse Message Part from JSON-RPC response
   */
  private parsePart(data: unknown): { text: string } | { data: string; mimeType: string } {
    if (!data || typeof data !== 'object') {
      return { text: '' };
    }

    const obj = data as Record<string, unknown>;

    // TextPart
    if ('text' in obj && typeof obj.text === 'string') {
      return { text: obj.text };
    }

    // DataPart (file data)
    if ('data' in obj && 'mimeType' in obj) {
      return {
        data: String(obj.data),
        mimeType: String(obj.mimeType),
      };
    }

    // Fallback: if 'text' exists but not a string, convert
    if ('text' in obj) {
      return { text: String(obj.text) };
    }

    return { text: '' };
  }

  /**
   * Parse task status string
   */
  private parseTaskStatus(status: unknown): A2ATask['status'] {
    if (typeof status !== 'string') {
      return 'pending';
    }

    const validStatuses: A2ATask['status'][] = [
      'pending',
      'working',
      'input_required',
      'completed',
      'failed',
      'canceled',
      'rejected',
    ];

    if (validStatuses.includes(status as A2ATask['status'])) {
      return status as A2ATask['status'];
    }

    return 'pending';
  }

  /**
   * Parse SSE event data
   */
  private parseStreamEvent(data: unknown): StreamEvent | null {
    if (!data || typeof data !== 'object') return null;

    const obj = data as Record<string, unknown>;

    // JSON-RPC response wrapper
    const result = obj.result as Record<string, unknown> | undefined;
    if (!result) return null;

    // Check event type
    if ('status' in result && 'taskId' in result) {
      return {
        type: 'status',
        event: this.parseStatusEvent(result),
      };
    }

    if ('artifact' in result && 'taskId' in result) {
      return {
        type: 'artifact',
        event: this.parseArtifactEvent(result),
      };
    }

    if ('id' in result && 'status' in result && 'messages' in result) {
      return {
        type: 'task',
        task: this.parseTask(result),
      };
    }

    if ('role' in result && 'parts' in result) {
      return {
        type: 'message',
        message: this.parseMessage(result),
      };
    }

    return null;
  }

  /**
   * Parse status event
   */
  private parseStatusEvent(data: Record<string, unknown>): TaskStatusUpdateEvent {
    return {
      taskId: String(data.taskId || ''),
      contextId: data.contextId ? String(data.contextId) : undefined,
      status: this.parseTaskStatus(data.status),
      message: data.message ? this.parseMessage(data.message) : undefined,
      final: Boolean(data.final),
    };
  }

  /**
   * Parse artifact event
   */
  private parseArtifactEvent(data: Record<string, unknown>): TaskArtifactUpdateEvent {
    const artifact = data.artifact as Record<string, unknown> || {};
    return {
      taskId: String(data.taskId || ''),
      contextId: data.contextId ? String(data.contextId) : undefined,
      artifact: {
        name: artifact.name ? String(artifact.name) : undefined,
        description: artifact.description ? String(artifact.description) : undefined,
        parts: Array.isArray(artifact.parts)
          ? artifact.parts.map((p: unknown) => this.parsePart(p))
          : [],
        index: typeof artifact.index === 'number' ? artifact.index : undefined,
        append: Boolean(artifact.append),
        lastChunk: Boolean(artifact.lastChunk),
      },
    };
  }
}

// ===== Helper Functions =====

import { TargetsStore } from '../db/targets-store.js';
import { AgentCacheStore } from '../db/agent-cache-store.js';
import { fetchAgentCard } from './agent-card.js';

/**
 * Create A2A client from agent ID
 * Fetches Agent Card from cache or remote endpoint
 */
export async function createA2AClient(
  configDir: string,
  agentId: string
): Promise<
  | { ok: true; client: A2AClient; agentCard: AgentCard }
  | { ok: false; error: string }
> {
  const targetsStore = new TargetsStore(configDir);
  const cacheStore = new AgentCacheStore(configDir);

  // Find agent by ID or prefix
  const agents = targetsStore.list({ type: 'agent' });
  const agent = agents.find(a => a.id === agentId || a.id.startsWith(agentId));

  if (!agent) {
    return { ok: false, error: `Agent '${agentId}' not found` };
  }

  if (!agent.enabled) {
    return { ok: false, error: `Agent '${agentId}' is disabled` };
  }

  // Get agent config
  const config = agent.config as { url?: string; ttl_seconds?: number; allow_local?: boolean };
  if (!config.url) {
    return { ok: false, error: `Agent '${agentId}' has no URL configured` };
  }

  // Check cache
  const cached = cacheStore.get(agent.id);
  const now = new Date();

  let agentCard: AgentCard | null = null;

  if (cached?.agentCard && cached.expiresAt && new Date(cached.expiresAt) > now) {
    // Use cached card
    agentCard = cached.agentCard as AgentCard;
  } else if (cached?.agentCard && !cached.expiresAt) {
    // Use cached card (no expiration)
    agentCard = cached.agentCard as AgentCard;
  } else {
    // Fetch fresh agent card
    const fetchResult = await fetchAgentCard(config.url, { allowLocal: config.allow_local ?? false });
    if (!fetchResult.ok || !fetchResult.agentCard) {
      return {
        ok: false,
        error: `Failed to fetch agent card: ${fetchResult.error}`,
      };
    }
    agentCard = fetchResult.agentCard;

    // Update cache
    const ttl = config.ttl_seconds || 3600;
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

    cacheStore.set({
      targetId: agent.id,
      agentCard,
      agentCardHash: fetchResult.hash,
      fetchedAt: now.toISOString(),
      expiresAt,
    });
  }

  // Create client with allowLocal from config
  const client = new A2AClient(agentCard, { allowLocal: config.allow_local ?? false });
  return { ok: true, client, agentCard };
}
