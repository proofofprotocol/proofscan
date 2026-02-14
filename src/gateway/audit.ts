/**
 * Audit logging for Protocol Gateway
 * Phase 8.5: Centralized audit logging with EventLineDB integration
 *
 * Records all gateway operations for:
 * - Security audit trail
 * - Performance monitoring
 * - Debugging and tracing
 *
 * Security: NEVER log actual tokens, only client_id (token name)
 */

import { EventsStore } from '../db/events-store.js';
import type { GatewayEventKind } from '../db/types.js';

/**
 * Options for logging an audit event
 */
export interface AuditLogOptions {
  /** Gateway-assigned request ID (ULID) */
  requestId: string;
  /** Distributed tracing ID (client-specified or auto-generated) */
  traceId?: string;
  /** Authenticated client ID (token name) */
  clientId: string;
  /** Event kind */
  event: GatewayEventKind;
  /** Target connector or agent ID */
  target?: string;
  /** MCP or A2A method */
  method?: string;
  /** Total processing latency in milliseconds */
  latencyMs?: number;
  /** Upstream (connector/agent) latency in milliseconds */
  upstreamLatencyMs?: number;
  /** Authorization decision: 'allow' or 'deny' */
  decision?: 'allow' | 'deny';
  /** Reason for denial (if decision is 'deny') */
  denyReason?: string;
  /** Error message (if any) */
  error?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Additional metadata (will be JSON stringified) */
  metadata?: Record<string, unknown>;
}

/**
 * Audit logger for gateway operations
 */
export class AuditLogger {
  private store: EventsStore;

  constructor(configDir: string) {
    this.store = new EventsStore(configDir);
  }

  /**
   * Log an audit event to EventLineDB
   *
   * @param options - Audit log options
   * @returns Event ID of the logged event
   */
  logEvent(options: AuditLogOptions): string {
    return this.store.saveGatewayEvent({
      requestId: options.requestId,
      traceId: options.traceId ?? null,
      clientId: options.clientId,
      eventKind: options.event,
      targetId: options.target ?? null,
      method: options.method ?? null,
      latencyMs: options.latencyMs ?? null,
      upstreamLatencyMs: options.upstreamLatencyMs ?? null,
      decision: options.decision ?? null,
      denyReason: options.denyReason ?? null,
      error: options.error ?? null,
      statusCode: options.statusCode ?? null,
      metadata: options.metadata ?? null,
    });
  }

  /**
   * Log authentication success
   */
  logAuthSuccess(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_auth_success',
      decision: 'allow',
    });
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    denyReason: string;
    statusCode?: number;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_auth_failure',
      decision: 'deny',
    });
  }

  /**
   * Log MCP request
   */
  logMcpRequest(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    target: string;
    method: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_mcp_request',
    });
  }

  /**
   * Log MCP response
   */
  logMcpResponse(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    target: string;
    method: string;
    latencyMs: number;
    upstreamLatencyMs?: number;
    statusCode: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_mcp_response',
      decision: options.statusCode < 400 ? 'allow' : undefined,
    });
  }

  /**
   * Log A2A request
   */
  logA2aRequest(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    target: string;
    method: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_a2a_request',
    });
  }

  /**
   * Log A2A response
   */
  logA2aResponse(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    target: string;
    method: string;
    latencyMs: number;
    upstreamLatencyMs?: number;
    statusCode: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_a2a_response',
      decision: options.statusCode < 400 ? 'allow' : undefined,
    });
  }

  /**
   * Log gateway error
   */
  logError(options: {
    requestId: string;
    traceId?: string;
    clientId: string;
    target?: string;
    method?: string;
    error: string;
    statusCode: number;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }): string {
    return this.logEvent({
      ...options,
      event: 'gateway_error',
    });
  }
}

/**
 * Create an audit logger instance
 *
 * @param configDir - Config directory path
 * @returns AuditLogger instance
 */
export function createAuditLogger(configDir: string): AuditLogger {
  return new AuditLogger(configDir);
}
