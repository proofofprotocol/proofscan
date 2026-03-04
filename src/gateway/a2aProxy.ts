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
import { DocumentsStore } from '../db/documents-store.js';
import { SkillsStore } from '../db/skills-store.js';
import { SpacesStore } from '../db/spaces-store.js';
import { SkillRegistry } from '../proofcomm/skill-registry.js';
import { SpaceManager, type SpaceBroadcastRequest } from '../proofcomm/spaces/index.js';
import { createA2AClient } from '../a2a/client.js';
import type { A2AMessage, TaskState } from '../a2a/types.js';
import { ErrorCodes } from './mcpProxy.js';
import { parseAgentField, isDocumentTarget, isSpaceTarget, isSkillTarget, VALID_ID_PATTERN } from '../proofcomm/routing.js';
import { DocumentResponder, type DocumentMessage } from '../proofcomm/document/index.js';
import { createAuditLogger, type AuditLogger } from './audit.js';

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
 * Note: Caller must validate method exists in A2A_METHODS before calling
 */
function getPermissionType(method: A2AMethod): string {
  return A2A_METHODS[method];
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
  // Note: A2A client methods use internal timeout (timeoutMs) for request cancellation.
  // The AbortSignal is checked before/after calls but not passed through to HTTP requests.
  // TODO: Add signal support to A2A client methods for immediate cancellation.
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
        // Validate params structure
        if (!params || typeof params !== 'object' || !('message' in params)) {
          return {
            error: {
              code: -32602,
              message: 'Invalid params: message field required',
            },
          };
        }
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
        // Validate params structure
        if (!params || typeof params !== 'object' || !('message' in params)) {
          return {
            error: {
              code: -32602,
              message: 'Invalid params: message field required',
            },
          };
        }
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
        // Validate params structure
        if (!params || typeof params !== 'object' || !('id' in params) || typeof (params as { id: unknown }).id !== 'string') {
          return {
            error: {
              code: -32602,
              message: 'Invalid params: id field (string) required',
            },
          };
        }
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
        // Validate params structure
        if (!params || typeof params !== 'object' || !('id' in params) || typeof (params as { id: unknown }).id !== 'string') {
          return {
            error: {
              code: -32602,
              message: 'Invalid params: id field (string) required',
            },
          };
        }
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
 * Handle document request (doc/ prefix routing)
 */
async function handleDocumentRequest(
  docId: string,
  method: string,
  params: unknown,
  documentsStore: DocumentsStore,
  requestId: string,
  clientId: string,
  reply: FastifyReply
): Promise<A2AProxyResponse> {

  // Check document exists
  const doc = documentsStore.get(docId);
  if (!doc) {
    return reply.code(404).send(
      createErrorResponse(ErrorCodes.NOT_FOUND, `Document not found: ${docId}`, requestId)
    );
  }

  // Only message/send is supported for documents
  if (method !== 'message/send') {
    return reply.code(400).send(
      createErrorResponse(
        ErrorCodes.BAD_REQUEST,
        `Method not supported for documents: ${method}. Use message/send.`,
        requestId
      )
    );
  }

  // Validate params
  if (!params || typeof params !== 'object' || !('message' in params)) {
    return reply.code(400).send(
      createErrorResponse(ErrorCodes.BAD_REQUEST, 'Invalid params: message field required', requestId)
    );
  }

  const messageParams = params as { message: string | A2AMessage };
  const message = messageParams.message;

  // Build DocumentMessage from A2A message
  let docMessage: DocumentMessage;
  if (typeof message === 'string') {
    docMessage = {
      from: clientId,
      parts: [{ text: message }],
    };
  } else {
    docMessage = {
      from: clientId,
      parts: message.parts as Array<{ text: string } | { data: string; mimeType: string }>,
      messageId: message.messageId,
      metadata: message.metadata,
    };
  }

  // Process message with DocumentResponder
  const responder = new DocumentResponder(documentsStore);

  try {
    const response = await responder.processMessage(docId, docMessage);

    // Convert response to A2A format
    return {
      result: {
        role: 'assistant',
        parts: response.parts,
        metadata: {
          docId,
          memoryUpdated: response.memoryUpdated,
        },
      },
    };
  } catch (error) {
    return reply.code(500).send(
      createErrorResponse(
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Document processing error',
        requestId
      )
    );
  }
}

/**
 * Handle space request (space/ prefix routing)
 *
 * Space routing implements G3 (Representative Event) pattern:
 * - Single event emitted for the broadcast operation
 * - Individual deliveries to agents have no audit
 *
 * Request format (pure A2A Message, no method/params):
 * { agent: "space/<space_id>", message: { role: "user", parts: [...] } }
 *
 * NOTE: The gateway client_id is used as the senderAgentId for membership validation.
 * This conflates gateway client identity with A2A agent identity. For broadcast to work,
 * the client_id must be enrolled as a member of the target space (via the join API).
 */
async function handleSpaceRequest(
  spaceId: string,
  method: string,
  params: unknown,
  spaceManager: SpaceManager,
  requestId: string,
  clientId: string,
  traceId: string | undefined,
  reply: FastifyReply
): Promise<A2AProxyResponse> {

  // Only message/send is supported for spaces
  if (method !== 'message/send') {
    return reply.code(400).send(
      createErrorResponse(
        ErrorCodes.BAD_REQUEST,
        `Method not supported for spaces: ${method}. Use message/send.`,
        requestId
      )
    );
  }

  // Validate params structure (space existence and membership validated by broadcastToSpace)
  if (!params || typeof params !== 'object' || !('message' in params)) {
    return reply.code(400).send(
      createErrorResponse(ErrorCodes.BAD_REQUEST, 'Invalid params: message field required', requestId)
    );
  }

  const messageParams = params as { message: string | A2AMessage };
  const message = messageParams.message;

  // Build broadcast request
  const broadcastRequest: SpaceBroadcastRequest = {
    spaceId,
    senderAgentId: clientId,
    message: typeof message === 'string'
      ? { role: 'user', parts: [{ text: message }] }
      : message,
  };

  // Dispatch function for broadcasting to individual agents
  // Phase 9.3 MVP: Records intent but doesn't actually send (future: real A2A dispatch)
  const dispatchToAgent: (agentId: string, message: A2AMessage) => Promise<{ success: boolean; error?: string }> =
    async (_agentId, _message) => {
      // TODO: Phase 9.4 - Implement actual A2A message delivery to agents
      // For now, we consider all deliveries successful (intent recorded)
      return { success: true };
    };

  // Broadcast to space (validates space existence and sender membership internally)
  const result = await spaceManager.broadcastToSpace(
    broadcastRequest,
    dispatchToAgent,
    {
      requestId,
      traceId,
      clientId,
    },
  );

  if (!result.ok) {
    const statusCode = result.error.code === 'SPACE_NOT_FOUND' ? 404
      : result.error.code === 'NOT_MEMBER' ? 403
      : 400;
    return reply.code(statusCode).send(
      createErrorResponse(result.error.code, result.error.message, requestId)
    );
  }

  // Return broadcast result
  // Phase 9.3 MVP: Intent is recorded but messages are not actually delivered yet
  // Phase 9.4 will implement actual A2A message delivery (status will change to "delivered")
  return {
    result: {
      space_id: spaceId,
      status: 'intent_recorded',
      recipients: result.value.recipientCount,
      // Note: delivered/failed counts are 0 in intent_recorded mode
      // They will reflect actual delivery results in Phase 9.4
      delivered: 0,
      failed: 0,
    },
  };
}

/**
 * A2A Proxy handler result
 */
export interface A2AProxyHandlerResult {
  handler: (request: FastifyRequest<{ Body: A2AProxyRequest }>, reply: FastifyReply) => Promise<A2AProxyResponse>;
  shutdown: () => void;
}

/**
 * Create A2A Proxy handler
 */
export function createA2AProxyHandler(options: A2AProxyOptions): A2AProxyHandlerResult {
  const { configDir, limits, hideNotFound = true } = options;
  const targetsStore = new TargetsStore(configDir);
  const documentsStore = new DocumentsStore(configDir);
  const skillsStore = new SkillsStore(configDir);
  const skillRegistry = new SkillRegistry(skillsStore);
  const spacesStore = new SpacesStore(configDir);
  const auditLogger = createAuditLogger(configDir);
  const spaceManager = new SpaceManager(spacesStore, auditLogger);
  const queueManager = new ConnectorQueueManager<
    { method: string; params: unknown; agentId: string },
    { result?: unknown; error?: { code: number; message: string } }
  >(limits);

  const handler = async (
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

    // Parse agent field to determine routing target (G2: Reserved Namespace)
    let routingTarget;
    try {
      routingTarget = parseAgentField(agentId);
    } catch (err) {
      return reply.code(400).send(
        createErrorResponse(
          ErrorCodes.BAD_REQUEST,
          err instanceof Error ? err.message : 'Invalid agent field',
          requestId
        )
      );
    }

    // 0a. Resolve @skill: targets early (Phase 9.2: Skill Routing)
    // Must happen before permission check to use the resolved agent ID
    if (isSkillTarget(routingTarget)) {
      const resolved = skillRegistry.resolveSkill(routingTarget.id);
      if (!resolved) {
        return reply.code(404).send(
          createErrorResponse(
            ErrorCodes.NOT_FOUND,
            `No agent found with skill: ${routingTarget.id}`,
            requestId
          )
        );
      }
      // Replace routing target with resolved agent and continue normal flow
      routingTarget = { type: 'agent' as const, id: resolved.agentId, original: routingTarget.original };
    }

    // Effective agent ID: resolved from @skill:, doc/, space/, or original agentId
    const effectiveAgentId = routingTarget.id;

    // For regular agents (non-URL), validate ID format (security: prevent path traversal, injection)
    // doc/ and space/ targets are validated by parseAgentField
    // URL-based agents (containing ://) are forwarded directly and don't need local ID validation
    // Note: Use effectiveAgentId (not original agentId) for URL check after @skill: resolution
    const isUrlAgent = effectiveAgentId.includes('://');
    if (routingTarget.type === 'agent' && !isUrlAgent && !VALID_ID_PATTERN.test(effectiveAgentId)) {
      return reply.code(400).send(
        createErrorResponse(ErrorCodes.BAD_REQUEST, 'Invalid agent ID format', requestId)
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

    // 1. Permission check (method is validated above, safe to cast)
    // For document targets, use the doc ID for permission check
    const permissionTargetId = routingTarget.type === 'document' ? routingTarget.id : effectiveAgentId;
    const permissionType = getPermissionType(method as A2AMethod);
    const requiredPermission = buildA2APermission(permissionType, permissionTargetId);
    if (!hasPermission(auth.permissions, requiredPermission)) {
      return reply.code(403).send(
        createErrorResponse(
          ErrorCodes.FORBIDDEN,
          `Permission denied for ${requiredPermission}`,
          requestId
        )
      );
    }

    // 2a. Handle document targets (G2: doc/ prefix routing)
    if (isDocumentTarget(routingTarget)) {
      return handleDocumentRequest(
        routingTarget.id,
        method,
        params,
        documentsStore,
        requestId,
        auth.client_id,
        reply
      );
    }

    // 2b. Handle space targets (G2: space/ prefix routing)
    if (isSpaceTarget(routingTarget)) {
      return handleSpaceRequest(
        routingTarget.id,
        method,
        params,
        spaceManager,
        requestId,
        auth.client_id,
        request.headers['x-trace-id'] as string | undefined,
        reply
      );
    }

    // 2c. Get agent from registry (targets store) - O(1) lookup by ID
    const target = targetsStore.get(effectiveAgentId);
    // Validate it's an A2A agent (not an MCP connector)
    const agent = target?.type === 'agent' && target?.protocol === 'a2a' ? target : undefined;

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
        createErrorResponse(ErrorCodes.NOT_FOUND, `Agent not found: ${effectiveAgentId}`, requestId)
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
        createErrorResponse(ErrorCodes.NOT_FOUND, `Agent not found: ${effectiveAgentId}`, requestId)
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

        // JSON-RPC protocol/transport errors (-32600, -32601, -32603)
        // Note: -32602 (Invalid params) is handled above as 404, not included here
        const JSON_RPC_PROTOCOL_ERRORS = new Set([-32600, -32601, -32603]);
        if (JSON_RPC_PROTOCOL_ERRORS.has(code)) {
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

  return {
    handler,
    shutdown: () => queueManager.shutdown(),
  };
}
