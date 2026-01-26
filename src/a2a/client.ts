/**
 * A2A Client
 *
 * Client for sending messages to A2A agents via JSON-RPC 2.0.
 * Implements message/send, tasks/get, and tasks/cancel operations.
 *
 * Phase 4 - Client Implementation
 */

import type { AgentCard } from './types.js';
import { isPrivateUrl } from './agent-card.js';

// Maximum response size (1MB) to prevent DoS
const MAX_RESPONSE_SIZE = 1024 * 1024;

// ===== A2A Protocol Types =====

export interface A2AMessage {
  role: 'user' | 'assistant';
  parts: Array<{ text: string } | { data: string; mimeType: string }>;
  metadata?: Record<string, unknown>;
  contextId?: string;
  referenceTaskIds?: string[];
}

export interface A2ATask {
  id: string;
  status: 'pending' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'rejected';
  messages: A2AMessage[];
  artifacts?: Array<{
    name?: string;
    description?: string;
    parts: Array<{ text: string } | { data: string; mimeType: string }>;
  }>;
  createdAt?: string;
  updatedAt?: string;
  contextId?: string;
}

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

// ===== A2A Client =====

/**
 * A2A Client for sending messages to agents
 */
export class A2AClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private agentCard: AgentCard;
  private requestCounter = 0;

  constructor(agentCard: AgentCard, options?: { headers?: Record<string, string> }) {
    this.agentCard = agentCard;
    this.baseUrl = agentCard.url.replace(/\/$/, '');

    // SSRF protection: Block private URLs in constructor
    if (isPrivateUrl(this.baseUrl)) {
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

    // Convert string message to A2AMessage
    const a2aMessage: A2AMessage =
      typeof message === 'string'
        ? { role: 'user', parts: [{ text: message }] }
        : message;

    // Build JSON-RPC request with unique ID
    const requestId = `req-${Date.now()}-${++this.requestCounter}-${Math.random().toString(36).slice(2, 9)}`;
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
      if (isPrivateUrl(this.baseUrl)) {
        return {
          ok: false,
          error: 'Private or local URLs are not allowed',
        };
      }

      const response = await fetch(`${this.baseUrl}/message/send`, {
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
   * Get task status
   * POST /tasks/get (JSON-RPC 2.0)
   */
  async getTask(taskId: string): Promise<SendMessageResult> {
    const requestId = `req-${Date.now()}-${++this.requestCounter}-${Math.random().toString(36).slice(2, 9)}`;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tasks/get',
      params: {
        name: `tasks/${taskId}`,
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/tasks/get`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(request),
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

      const responseText = await response.text();

      // Validate response size
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
   * Cancel a task
   * POST /tasks/cancel (JSON-RPC 2.0)
   */
  async cancelTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
    const requestId = `req-${Date.now()}-${++this.requestCounter}-${Math.random().toString(36).slice(2, 9)}`;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tasks/cancel',
      params: {
        name: `tasks/${taskId}`,
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/tasks/cancel`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(request),
      });

      // Validate Content-Type
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return {
          ok: false,
          error: `Expected JSON response, got ${contentType || 'unknown'}`,
        };
      }

      const responseText = await response.text();

      // Validate response size
      if (responseText.length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          error: `Response too large: ${responseText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }

      let responseData: JsonRpcResponse;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          error: `Invalid JSON response: ${responseText.slice(0, 200)}`,
        };
      }

      if (responseData.error) {
        return {
          ok: false,
          error: `${responseData.error.code}: ${responseData.error.message}`,
        };
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

    // Parse messages
    if (Array.isArray(data.messages)) {
      task.messages = data.messages.map(msg => this.parseMessage(msg));
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
      role: obj.role === 'assistant' ? 'assistant' : 'user',
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
  const config = agent.config as { url?: string; ttl_seconds?: number };
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
    const fetchResult = await fetchAgentCard(config.url);
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

  // Create client
  const client = new A2AClient(agentCard);
  return { ok: true, client, agentCard };
}
