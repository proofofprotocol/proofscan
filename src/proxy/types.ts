/**
 * Proxy Type Definitions (Phase 5.0)
 */

import type { Connector } from '../types/index.js';
import type { ToolInfo } from '../tools/adapter.js';

/** Namespace separator for tool names */
export const NAMESPACE_SEPARATOR = '__';

/** Proxy startup options */
export interface ProxyOptions {
  /** Connectors to expose through the proxy */
  connectors: Connector[];
  /** Config directory path */
  configDir: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/** MCP JSON-RPC error codes */
export const MCP_ERROR = {
  /** Invalid JSON was received */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not available */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameters */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR: -32603,
} as const;

export type McpErrorCode = typeof MCP_ERROR[keyof typeof MCP_ERROR];

/** Tool with namespace prefix */
export interface NamespacedTool extends ToolInfo {
  /** Original connector ID */
  connectorId: string;
  /** Namespaced name (connectorId__toolName) */
  namespacedName: string;
}

/** Parsed namespace result */
export interface ParsedNamespace {
  connectorId: string;
  toolName: string;
}

/** Result of routing a tool call */
export interface RouteResult {
  success: boolean;
  content?: unknown[];
  isError?: boolean;
  error?: string;
  sessionId?: string;
}

/** JSON-RPC 2.0 request */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 response */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** JSON-RPC 2.0 notification (no id) */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** MCP initialize params */
export interface InitializeParams {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  clientInfo?: {
    name: string;
    version?: string;
  };
}

/** MCP initialize result */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

/** MCP tools/list result */
export interface ToolsListResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
}

/** MCP tools/call params */
export interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** MCP tools/call result */
export interface ToolsCallResult {
  content?: unknown[];
  isError?: boolean;
}
