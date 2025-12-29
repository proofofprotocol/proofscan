/**
 * A2A Protocol Adapter (Stub)
 *
 * Placeholder for Agent-to-Agent protocol support
 * Phase 2.1: Stub only, full implementation in Phase 3
 */

import type {
  IProtocolAdapter,
  RawMessage,
  ParsedMessage,
  ProtocolType,
} from './IProtocolAdapter.js';

/**
 * A2A Protocol Adapter stub
 *
 * Currently returns null for all messages.
 * Will be implemented when A2A protocol specification is finalized.
 */
export class A2aAdapter implements IProtocolAdapter {
  readonly protocol: ProtocolType = 'a2a';

  /**
   * Check if message is A2A protocol
   *
   * A2A messages are expected to have specific structure:
   * - Different from JSON-RPC 2.0
   * - May have agent-specific headers
   *
   * Currently always returns false (stub)
   */
  canHandle(_raw: RawMessage): boolean {
    // TODO: Implement A2A detection in Phase 3
    // Expected format TBD
    return false;
  }

  /**
   * Parse A2A message
   *
   * Currently returns null (stub)
   */
  parse(_raw: RawMessage): ParsedMessage | null {
    // TODO: Implement A2A parsing in Phase 3
    return null;
  }

  /**
   * Generate summary for A2A message
   *
   * Currently returns empty string (stub)
   */
  summarize(_parsed: ParsedMessage, _raw: RawMessage): string {
    // TODO: Implement A2A summary in Phase 3
    return '';
  }
}
