/**
 * A2A Proxy handler
 * Phase 8.4: A2A Proxy
 *
 * Routes A2A requests to appropriate agents with:
 * - Registry check (agent existence + enabled)
 * - Permission check
 * - Queue management (serial model)
 * - Timeout handling
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthInfo } from './authMiddleware.js';
import { hasPermission, buildA2APermission } from './permissions.js';
import { ConnectorQueueManager, QueueFullError, QueueTimeoutError } from './queue.js';
import { GatewayLimits } from './config.js';
import { TargetsStore } from '../db/targets-store.js';
import { createA2AClient } from '../a2a/client.js';
import type { A2AMessage, TaskState } from '../a2a/types.js';
import { ErrorCodes } from './mcpProxy.js';

/**
 * A2A Proxy request body
 */
export interface A2AProxyRequest {
  /** Target agent ID */
  agent: string;
  /** A2A method (e.g., "message/send", "tasks/get") */
  method: string;
  /** A2A JSON-RPC params */
  params?: unknown;
}

/**
 * A2A Proxy response
 */
export interface A2AProxyResponse {
  /** JSON-RPC result (on success) */
  result?: unknown;
  /** Error (on failure) */
  error?: {
    code: string;
    message: string;
    request_id: string;
  };
}

// ErrorCodes imported from mcpProxy.js

/**
 * Create error response
 */
function createErrorResponse(
  code: string,
  message: string,
  requestId: string
): A2AProxyResponse {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };
}

/**
 * A2A Proxy handler factory options
 */
export interface A2AProxyOptions {
  /** Config directory path */
  configDir: string;
  /** Gateway limits */
  limits: GatewayLimits;
  /** Hide not found as 403 (security) */
  hideNotFound?: boolean;
}

/**
 * Supported A2A methods for routing
 */
const A2A_METHODS = {
  'message/send': 'message',
  'tasks/send': 'task',
  'tasks/get': 'task',
  'tasks/cancel': 'task',
  'tasks/list': 'task',
} as const;

type A2AMethod = keyof typeof A2A_METHODS;

/**
 * Get permission type for A2A method
 */
function getPermissionType(method: string): string {
  const methodType = A2A_METHODS[method as A2AMethod];
  return methodType || 'message';
}

/**
 * A2A request executor - calls agent via HTTP
 */
async function executeA2ARequest(
  agentId: string,
  method: string,
  params: unknown,
  configDir: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  // Create A2A client for this agent
  const clientResult = await createA2AClient(configDir, agentId);
  
  if (!clientResult.ok) {
    return {
      error: {
        code: -32603,
        message: clientResult.error,
      },
    };
  }

  const { client } = clientResult;

  // Check for abort before making request
  if (signal.aborted) {
    return {
      error: {
        code: -32603,
        message: 'Request aborted',
      },
    };
  }

  try {
    // Route to appropriate A2A method
    switch (method) {
      case 'message/send': {
        const messageParams = params as { message: string | A2AMessage; blocking?: boolean };
        const result = await client.sendMessage(messageParams.message, {
          timeout: timeoutMs,
          blocking: messageParams.blocking,
        });
        
        if (!result.ok) {
          return {
            error: {
              code: -32603,
              message: result.error || 'Unknown error',
            },
          };
        }
        
        return {
          result: result.task || result.message,
        };
      }
      
      case 'tasks/send': {
        // tasks/send is equivalent to message/send with blocking semantics
        const taskParams = params as { message: string | A2AMessage };
        const result = await client.sendMessage(taskParams.message, {
          timeout: timeoutMs,
          blocking: true,
        });
        
        if (!result.ok) {
          return {
            error: {
              code: -32603,
              message: result.error || 'Unknown error',
            },
          };
        }
        
        return {
          result: result.task || result.message,
        };
      }
      
      case 'tasks/get': {
        const getParams = params as { id: string; historyLength?: number };
        const result = await client.getTask(getParams.id, {
          historyLength: getParams.historyLength,
          timeout: timeoutMs,
        });
        
        if (!result.ok) {
          return {
            error: {
              code: result.statusCode === 404 ? -32602 : -32603,
              message: result.error || 'Unknown error',
            },
          };
        }
        
        return { result: result.task };
      }
      
      case 'tasks/cancel': {
        const cancelParams = params as { id: string };
        const result = await client.cancelTask(cancelParams.id);
        
        if (!result.ok) {
          return {
            error: {
              code: result.statusCode === 404 ? -32602 : -32603,
              message: result.error || 'Unknown error',
            },
          };
        }
        
        return { result: result.task };
      }
      
      case 'tasks/list': {
        const listParams = params as { contextId?: string; status?: TaskState; pageSize?: number; pageToken?: string };
        const result = await client.listTasks(listParams);
        
        if (!result.ok) {
          return {
            error: {
              code: -32603,
              message: result.error || 'Unknown error',
            },
          };
        }
        
        return { result: result.response };
      }
      
      default:
        return {
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        error: {
          code: -32603,
          message: 'Request aborted',
        },
      };
    }
    
    return {
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Create A2A Proxy handler
 */
export function createA2AProxyHandler(options: A2AProxyOptions) {
  const { configDir, limits, hideNotFound = true } = options;
  const targetsStore = new TargetsStore(configDir);
  const queueManager = new ConnectorQueueManager<
    { method: string; params: unknown; agentId: string },
    { result?: unknown; error?: { code: number; message: string } }
  >(limits);

  return async (
    request: FastifyRequest<{ Body: A2AProxyRequest }>,
    reply: FastifyReply
  ): Promise<A2AProxyResponse> => {
    const requestId = request.requestId;
    const auth = request.auth as AuthInfo;

    // Validate request body
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Invalid request body', requestId)
      );
    }

    const { agent: agentId, method, params } = body;

    // Validate required fields
    if (!agentId || typeof agentId !== 'string') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Missing or invalid "agent" field', requestId)
      );
    }

    if (!method || typeof method !== 'string') {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Missing or invalid "method" field', requestId)
      );
    }

    // Validate method is supported
    if (!(method in A2A_METHODS)) {
      return reply.code(400).send(
        createErrorResponse(
          ErrorCodes.BAD_REQUEST,
          `Unsupported A2A method: ${method}. Supported: ${Object.keys(A2A_METHODS).join(', ')}`,
          requestId
        )
      );
    }

    // 1. Permission check
    const permissionType = getPermissionType(method);
    const requiredPermission = buildA2APermission(permissionType, agentId);
    if (!hasPermission(auth.permissions, requiredPermission)) {
      return reply.code(403).send(
        createErrorResponse(
          ErrorCodes.FORBIDDEN,
          `Permission denied for ${requiredPermission}`,
          requestId
        )
      );
    }

    // 2. Get agent from registry (targets store)
    const agents = targetsStore.list({ type: 'agent' });
    // Exact match only to prevent ambiguous agent resolution
    const agent = agents.find((a) => a.id === agentId);

    // 3. Check agent exists and enabled
    if (!agent) {
      // Hide existence for security (403 instead of 404)
      if (hideNotFound) {
        return reply.code(403).send(
          createErrorResponse(
            ErrorCodes.FORBIDDEN,
            `Permission denied for ${requiredPermission}`,
            requestId
          )
        );
      }
      return reply.code(404).send(
        createErrorResponse(ErrorCodes.NOT_FOUND, `Agent not found: ${agentId}`, requestId)
      );
    }

    if (!agent.enabled) {
      // Disabled agents are treated as not found (for security)
      if (hideNotFound) {
        return reply.code(403).send(
          createErrorResponse(
            ErrorCodes.FORBIDDEN,
            `Permission denied for ${requiredPermission}`,
            requestId
          )
        );
      }
      return reply.code(404).send(
        createErrorResponse(ErrorCodes.NOT_FOUND, `Agent not found: ${agentId}`, requestId)
      );
    }

    // 4. Queue and execute
    try {
      const { result: a2aResult, queueWaitMs, upstreamLatencyMs } = await queueManager.enqueue(
        agent.id,
        { method, params, agentId: agent.id },
        async (req, signal) => {
          return executeA2ARequest(
            req.agentId,
            req.method,
            req.params,
            configDir,
            signal,
            limits.timeout_ms
          );
        }
      );

      // Add timing metrics to response headers
      reply.header('X-Queue-Wait-Ms', String(queueWaitMs));
      reply.header('X-Upstream-Latency-Ms', String(upstreamLatencyMs));

      // 5. Return response
      if (a2aResult.error) {
        const code = a2aResult.error.code;

        // Method not found
        if (code === -32601) {
          return reply.code(400).send(
            createErrorResponse(ErrorCodes.BAD_REQUEST, a2aResult.error.message, requestId)
          );
        }

        // Invalid params (task not found, etc.)
        if (code === -32602) {
          return reply.code(404).send(
            createErrorResponse(ErrorCodes.NOT_FOUND, a2aResult.error.message, requestId)
          );
        }

        // JSON-RPC protocol/transport errors (-32600 to -32603)
        if (code >= -32603 && code <= -32600) {
          return reply.code(502).send(
            createErrorResponse(ErrorCodes.BAD_GATEWAY, a2aResult.error.message, requestId)
          );
        }

        // Application errors (agent returned error but communication succeeded)
        return reply.code(400).send(
          createErrorResponse(ErrorCodes.BAD_REQUEST, a2aResult.error.message, requestId)
        );
      }

      return { result: a2aResult.result };
    } catch (error) {
      // Queue errors
      if (error instanceof QueueFullError) {
        return reply.code(429).send(
          createErrorResponse(ErrorCodes.TOO_MANY_REQUESTS, error.message, requestId)
        );
      }

      if (error instanceof QueueTimeoutError) {
        return reply.code(504).send(
          createErrorResponse(ErrorCodes.GATEWAY_TIMEOUT, 'Request timeout', requestId)
        );
      }

      // Unexpected errors
      return reply.code(500).send(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Unknown error',
          requestId
        )
      );
    }
  };
}

/**
 * Shutdown queue manager (for graceful shutdown)
 */
export function createA2AProxyShutdown(queueManager: ConnectorQueueManager<unknown, unknown>) {
  return () => {
    queueManager.shutdown();
  };
}
