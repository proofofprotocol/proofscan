/**
 * SSE (Server-Sent Events) for Protocol Gateway
 * Phase 8.6: Real-time event streaming
 *
 * Provides SSE endpoint for streaming audit events to connected clients.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { type GatewayEventKind, type GatewayEvent } from '../db/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    auth?: {
      client_id: string;
      permissions: string[];
    };
  }
}

/**
 * SSE client connection
 */
interface SseClient {
  /** Unique client ID */
  id: string;
  /** Response object for writing events */
  response: FastifyReply;
  /** Connected timestamp */
  connectedAt: number;
  /** Filter: event kinds to receive (empty = all) */
  kinds: GatewayEventKind[];
  /** Filter: client_id to filter events (empty = all) */
  clientIdFilter: string;
  /** Whether the client is still connected */
  isConnected: boolean;
}

/**
 * SSE event data format
 */
export interface SseEventData {
  event_kind: GatewayEventKind;
  client_id: string;
  ts: number;
  request_id: string;
  trace_id?: string | null;
  target_id?: string | null;
  method?: string | null;
  latency_ms?: number | null;
  upstream_latency_ms?: number | null;
  decision?: string | null;
  deny_reason?: string | null;
  error?: string | null;
  status_code?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * SSE connection manager
 */
export class SseManager {
  /** Connected clients */
  private clients: Map<string, SseClient> = new Map();
  /** Client ID counter */
  private nextClientId: number = 0;

  /**
   * Add a new SSE client
   */
  addClient(client: SseClient): void {
    this.clients.set(client.id, client);
  }

  /**
   * Remove an SSE client
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.isConnected = false;
      this.clients.delete(clientId);
    }
  }

  /**
   * Broadcast an event to all matching clients
   */
  broadcast(event: SseEventData): void {
    // Copy entries to avoid race condition when modifying map during iteration
    const entries = Array.from(this.clients.entries());
    const toDelete: string[] = [];

    for (const [clientId, client] of entries) {
      if (!client.isConnected) {
        toDelete.push(clientId);
        continue;
      }

      // Apply filters
      if (client.kinds.length > 0 && !client.kinds.includes(event.event_kind)) {
        continue;
      }
      if (client.clientIdFilter && event.client_id !== client.clientIdFilter) {
        continue;
      }

      // Send event to client
      try {
        const data = JSON.stringify(event);
        client.response.raw.write(`event: gateway_event\ndata: ${data}\n\n`);
      } catch {
        // Client disconnected
        client.isConnected = false;
        toDelete.push(clientId);
      }
    }

    // Delete disconnected clients after iteration completes
    for (const clientId of toDelete) {
      this.clients.delete(clientId);
    }
  }

  /**
   * Send an event to a specific client
   */
  public sendEvent(client: SseClient, event: SseEventData): void {
    try {
      const data = JSON.stringify(event);
      client.response.raw.write(`event: gateway_event\ndata: ${data}\n\n`);
    } catch {
      // Client disconnected - mark but don't delete from map
      // (caller should handle cleanup to avoid race conditions)
      client.isConnected = false;
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    // Clean up disconnected clients (avoid modifying map during iteration)
    const toDelete: string[] = [];
    for (const [clientId, client] of this.clients.entries()) {
      if (!client.isConnected) {
        toDelete.push(clientId);
      }
    }
    for (const clientId of toDelete) {
      this.clients.delete(clientId);
    }
    return this.clients.size;
  }

  /**
   * Generate a unique client ID
   */
  generateClientId(): string {
    return `sse-${++this.nextClientId}-${Date.now()}`;
  }

  /**
   * Disconnect all clients
   */
  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.isConnected = false;
      try {
        client.response.raw.end();
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.clients.clear();
  }
}

/**
 * Global SSE manager instance
 */
let sseManagerInstance: SseManager | null = null;

/**
 * Get or create the SSE manager instance
 */
export function getSseManager(): SseManager {
  if (!sseManagerInstance) {
    sseManagerInstance = new SseManager();
  }
  return sseManagerInstance;
}

/**
 * SSE endpoint handler
 *
 * Query parameters:
 * - kinds: Comma-separated list of event kinds to receive (optional)
 * - client_id: Filter events by client_id (optional)
 */
export interface SseRequestQuery {
  kinds?: string;
  client_id?: string;
}

export async function sseStreamHandler(
  request: FastifyRequest<{ Querystring: SseRequestQuery }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const auth = request.auth;
    if (!auth) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const manager = getSseManager();
    const clientId = manager.generateClientId();

    // Parse filters
    const kindsParam = request.query.kinds?.split(',').filter(Boolean) ?? [];
    const clientIdFilter = request.query.client_id ?? '';

    // Validate event kinds
    const validKinds: GatewayEventKind[] = [
      'gateway_auth_success',
      'gateway_auth_failure',
      'gateway_mcp_request',
      'gateway_mcp_response',
      'gateway_a2a_request',
      'gateway_a2a_response',
      'gateway_error',
    ];

    const kinds = kindsParam.filter((kind) =>
      validKinds.includes(kind as GatewayEventKind)
    ) as GatewayEventKind[];

    // Set SSE headers
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Check if reply.raw is writable
    if (!reply.raw || !reply.raw.writable) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Response stream is not writable',
        },
      });
    }

    // Send SSE headers
    try {
      reply.raw.write(': connected\n\n');
    } catch (error) {
      console.error('Failed to write SSE headers:', error);
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }

    // Create client
    const client: SseClient = {
      id: clientId,
      response: reply,
      connectedAt: Date.now(),
      kinds,
      clientIdFilter,
      isConnected: true,
    };

    // Add client to manager
    manager.addClient(client);

    // Send initial welcome event
    try {
      manager.sendEvent(client, {
        event_kind: 'gateway_auth_success',
        client_id: auth.client_id,
        ts: Date.now(),
        request_id: request.requestId,
      });
    } catch (error) {
      console.error('Failed to send welcome event:', error);
      // Continue anyway, the connection is established
    }

    // Handle client disconnect
    let resolvePromise: () => void;
    const closeHandler = () => {
      manager.removeClient(clientId);
      resolvePromise();
    };

    request.raw.on('close', closeHandler);
    request.raw.on('error', closeHandler);

    // Keep connection alive until client disconnects
    return new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
  } catch (error) {
    // Log error and send 500 response
    console.error('SSE handler error:', error);
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Convert a GatewayEvent to SseEventData
 */
export function gatewayEventToSseData(event: GatewayEvent): SseEventData {
  return {
    event_kind: event.event_kind,
    client_id: event.client_id,
    ts: new Date(event.ts).getTime(),
    request_id: event.request_id,
    trace_id: event.trace_id,
    target_id: event.target_id,
    method: event.method,
    latency_ms: event.latency_ms,
    upstream_latency_ms: event.upstream_latency_ms,
    decision: event.decision,
    deny_reason: event.deny_reason,
    error: event.error,
    status_code: event.status_code,
    metadata: event.metadata_json ? JSON.parse(event.metadata_json) : null,
  };
}
