/**
 * A2A/MCP Event Normalizer
 *
 * Converts protocol-specific event formats to a normalized, protocol-agnostic format.
 * Used for unified analysis and reporting across MCP and A2A protocols.
 */

// ===== Normalized Event Types =====

/**
 * Protocol-agnostic normalized event format
 * Stored in events.normalized_json
 */
export interface NormalizedEvent {
  /** Event version for future schema evolution */
  version: 1;

  /** Source protocol */
  protocol: 'mcp' | 'a2a';

  /** Event type */
  type: 'message' | 'tool_call' | 'tool_result' | 'status' | 'artifact' | 'error';

  /** Timestamp (ISO8601) */
  timestamp: string;

  /** Actor (user/assistant/system) */
  actor: 'user' | 'assistant' | 'system';

  /** Content (type-specific) */
  content: NormalizedContent;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

type NormalizedContent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown; isError?: boolean }
  | { type: 'status'; status: string; message?: string }
  | { type: 'artifact'; name?: string; mimeType?: string; data?: string }
  | { type: 'error'; code: number; message: string };

// ===== Normalizer Functions =====

/**
 * Normalize MCP event to common format
 */
export function normalizeMcpEvent(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const method = obj.method as string | undefined;

  // tools/call request
  if (method === 'tools/call') {
    const params = obj.params as Record<string, unknown> | undefined;
    return {
      version: 1,
      protocol: 'mcp',
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      actor: 'assistant',
      content: {
        type: 'tool_call',
        name: params?.name as string || 'unknown',
        arguments: params?.arguments as Record<string, unknown> || {},
      },
    };
  }

  // tools/call response
  if (obj.result && typeof obj.id !== 'undefined') {
    const result = obj.result as Record<string, unknown>;
    if (result.content || result.isError !== undefined) {
      return {
        version: 1,
        protocol: 'mcp',
        type: 'tool_result',
        timestamp: new Date().toISOString(),
        actor: 'system',
        content: {
          type: 'tool_result',
          name: 'tool', // Name not available in response
          result: result.content,
          isError: result.isError as boolean | undefined,
        },
      };
    }
  }

  return null;
}

/**
 * Normalize A2A event to common format
 *
 * Handles both:
 * - Response format: { jsonrpc, id, result: { role, parts, ... } }
 * - Request format: { role, parts, ... } (direct message object)
 */
export function normalizeA2aEvent(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  // Try to extract the message object from response format or use directly
  const result = (obj.result as Record<string, unknown>) ?? obj;

  // Status event
  if ('status' in result && 'taskId' in result) {
    return {
      version: 1,
      protocol: 'a2a',
      type: 'status',
      timestamp: new Date().toISOString(),
      actor: 'system',
      content: {
        type: 'status',
        status: result.status as string,
        message: extractMessageText(result.message),
      },
    };
  }

  // Artifact event
  if ('artifact' in result) {
    const artifact = result.artifact as Record<string, unknown>;
    return {
      version: 1,
      protocol: 'a2a',
      type: 'artifact',
      timestamp: new Date().toISOString(),
      actor: 'assistant',
      content: {
        type: 'artifact',
        name: artifact.name as string | undefined,
        mimeType: extractMimeType(artifact.parts),
        data: extractData(artifact.parts),
      },
    };
  }

  // Message event (response or request format)
  if ('role' in result && 'parts' in result) {
    return {
      version: 1,
      protocol: 'a2a',
      type: 'message',
      timestamp: new Date().toISOString(),
      actor: result.role === 'assistant' ? 'assistant' : 'user',
      content: {
        type: 'text',
        text: extractMessageText(result),
      },
    };
  }

  return null;
}

function extractMessageText(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as Record<string, unknown>;
  const parts = m.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(p => 'text' in p)
    .map(p => p.text as string)
    .join('');
}

function extractMimeType(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (part && typeof part === 'object' && 'mimeType' in part) {
      return part.mimeType as string;
    }
  }
  return undefined;
}

function extractData(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (part && typeof part === 'object' && 'data' in part) {
      return part.data as string;
    }
  }
  return undefined;
}
