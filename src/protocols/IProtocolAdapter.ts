/**
 * Protocol Adapter Interface
 *
 * Abstraction layer for different protocols (MCP, A2A, etc.)
 * Phase 2.1: Skeleton implementation, full implementation in Phase 3
 */

import type { EventLine, EventLineKind, EventLineDirection, EventLineStatus } from '../eventline/types.js';

/**
 * Protocol type identifier
 */
export type ProtocolType = 'mcp' | 'a2a' | 'unknown';

/**
 * Raw message from transport layer
 */
export interface RawMessage {
  /** Raw JSON string */
  json: string;

  /** Timestamp when received */
  ts_ms: number;

  /** Direction: inbound (from server) or outbound (to server) */
  direction: 'inbound' | 'outbound';

  /** Size in bytes */
  size_bytes: number;
}

/**
 * Parsed message result
 */
export interface ParsedMessage {
  /** Detected protocol */
  protocol: ProtocolType;

  /** Event kind */
  kind: EventLineKind;

  /** Direction */
  direction: EventLineDirection;

  /** Label (method name or event type) */
  label: string;

  /** Human-readable summary */
  summary?: string;

  /** RPC ID if applicable */
  rpc_id?: string | number;

  /** Status */
  status: EventLineStatus;

  /** Error code if error */
  error_code?: number | string;

  /** Payload hash (SHA-256, first 16 chars) */
  payload_hash?: string;

  /** Parsed JSON object */
  parsed?: Record<string, unknown>;
}

/**
 * Protocol Adapter interface
 *
 * Implementations convert protocol-specific messages to EventLine format
 */
export interface IProtocolAdapter {
  /** Protocol identifier */
  readonly protocol: ProtocolType;

  /**
   * Check if this adapter can handle the given message
   * @param raw - Raw message
   * @returns true if this adapter should handle the message
   */
  canHandle(raw: RawMessage): boolean;

  /**
   * Parse a raw message into normalized format
   * @param raw - Raw message
   * @returns Parsed message or null if parsing fails
   */
  parse(raw: RawMessage): ParsedMessage | null;

  /**
   * Generate a summary string for the message
   * @param parsed - Parsed message
   * @param raw - Original raw message
   * @returns Human-readable summary
   */
  summarize(parsed: ParsedMessage, raw: RawMessage): string;
}

/**
 * Protocol Adapter Registry
 *
 * Manages adapters and routes messages to appropriate adapter
 */
export class ProtocolAdapterRegistry {
  private adapters: IProtocolAdapter[] = [];

  /**
   * Register an adapter
   */
  register(adapter: IProtocolAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Find adapter that can handle the message
   */
  findAdapter(raw: RawMessage): IProtocolAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(raw)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Parse a raw message using appropriate adapter
   */
  parse(raw: RawMessage): ParsedMessage | null {
    const adapter = this.findAdapter(raw);
    if (!adapter) {
      return null;
    }
    return adapter.parse(raw);
  }

  /**
   * Get all registered adapters
   */
  getAdapters(): IProtocolAdapter[] {
    return [...this.adapters];
  }
}

/**
 * Compute SHA-256 hash of payload (first 16 chars)
 */
export function computePayloadHash(json: string): string {
  // Use Node.js crypto
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  return hash.slice(0, 16);
}
