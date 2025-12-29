/**
 * MCP Protocol Adapter
 *
 * Handles MCP (Model Context Protocol) JSON-RPC messages
 */

import type {
  IProtocolAdapter,
  RawMessage,
  ParsedMessage,
  ProtocolType,
} from './IProtocolAdapter.js';
import { computePayloadHash } from './IProtocolAdapter.js';
import type { EventLineDirection, EventLineStatus } from '../eventline/types.js';

/**
 * JSON-RPC 2.0 message types
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * MCP Protocol Adapter implementation
 */
export class McpAdapter implements IProtocolAdapter {
  readonly protocol: ProtocolType = 'mcp';

  canHandle(raw: RawMessage): boolean {
    try {
      const parsed = JSON.parse(raw.json);
      // JSON-RPC 2.0 messages have jsonrpc field
      return parsed.jsonrpc === '2.0';
    } catch {
      return false;
    }
  }

  parse(raw: RawMessage): ParsedMessage | null {
    try {
      const parsed = JSON.parse(raw.json) as JsonRpcMessage;

      if (parsed.jsonrpc !== '2.0') {
        return null;
      }

      const payloadHash = computePayloadHash(raw.json);

      // Determine message type
      if (this.isResponse(parsed)) {
        return this.parseResponse(parsed, raw, payloadHash);
      } else if (this.isRequest(parsed)) {
        return this.parseRequest(parsed, raw, payloadHash);
      } else if (this.isNotification(parsed)) {
        return this.parseNotification(parsed, raw, payloadHash);
      }

      return null;
    } catch {
      return null;
    }
  }

  summarize(parsed: ParsedMessage, raw: RawMessage): string {
    try {
      const obj = JSON.parse(raw.json);

      // Request summary
      if (parsed.kind === 'req') {
        const params = obj.params;
        if (parsed.label === 'tools/call' && params?.name) {
          return `call ${params.name}`;
        }
        if (parsed.label === 'resources/read' && params?.uri) {
          return `read ${this.shortenUri(params.uri)}`;
        }
        if (parsed.label === 'prompts/get' && params?.name) {
          return `get ${params.name}`;
        }
        return parsed.label;
      }

      // Response summary
      if (parsed.kind === 'res') {
        const result = obj.result;
        if (result) {
          // tools/list response
          if (result.tools && Array.isArray(result.tools)) {
            return `${result.tools.length} tools`;
          }
          // resources/list response
          if (result.resources && Array.isArray(result.resources)) {
            return `${result.resources.length} resources`;
          }
          // prompts/list response
          if (result.prompts && Array.isArray(result.prompts)) {
            return `${result.prompts.length} prompts`;
          }
          // initialize response
          if (result.serverInfo?.name) {
            return `${result.serverInfo.name} v${result.serverInfo.version || '?'}`;
          }
          // tools/call response
          if (result.content && Array.isArray(result.content)) {
            return `${result.content.length} content`;
          }
        }

        // Error response
        if (obj.error) {
          return `error: ${obj.error.message || obj.error.code}`;
        }

        return 'OK';
      }

      // Notification summary
      if (parsed.kind === 'notify') {
        return parsed.label.replace('notifications/', '');
      }

      return parsed.label;
    } catch {
      return parsed.label;
    }
  }

  private isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
    return 'method' in msg && 'id' in msg && msg.id !== undefined;
  }

  private isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
    return !('method' in msg) && 'id' in msg;
  }

  private isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
    return 'method' in msg && !('id' in msg);
  }

  private parseRequest(
    msg: JsonRpcRequest,
    raw: RawMessage,
    payloadHash: string
  ): ParsedMessage {
    // Inbound request (from client) = outbound from our perspective (we're capturing)
    // Outbound request (to server) = client→server
    const direction: EventLineDirection = raw.direction === 'outbound' ? '→' : '←';

    return {
      protocol: 'mcp',
      kind: 'req',
      direction,
      label: msg.method,
      rpc_id: msg.id,
      status: '-',
      payload_hash: payloadHash,
      parsed: msg as unknown as Record<string, unknown>,
    };
  }

  private parseResponse(
    msg: JsonRpcResponse,
    raw: RawMessage,
    payloadHash: string
  ): ParsedMessage {
    // Response direction is opposite of request
    const direction: EventLineDirection = raw.direction === 'inbound' ? '←' : '→';
    const hasError = 'error' in msg && msg.error !== undefined;
    const status: EventLineStatus = hasError ? 'ERR' : 'OK';

    return {
      protocol: 'mcp',
      kind: 'res',
      direction,
      label: 'response',  // Will be correlated with request method later
      rpc_id: msg.id,
      status,
      error_code: hasError ? msg.error!.code : undefined,
      payload_hash: payloadHash,
      parsed: msg as unknown as Record<string, unknown>,
    };
  }

  private parseNotification(
    msg: JsonRpcNotification,
    raw: RawMessage,
    payloadHash: string
  ): ParsedMessage {
    const direction: EventLineDirection = raw.direction === 'outbound' ? '→' : '←';

    return {
      protocol: 'mcp',
      kind: 'notify',
      direction,
      label: msg.method,
      status: '-',
      payload_hash: payloadHash,
      parsed: msg as unknown as Record<string, unknown>,
    };
  }

  private shortenUri(uri: string): string {
    if (uri.length <= 30) return uri;
    return uri.slice(0, 15) + '...' + uri.slice(-12);
  }
}
