/**
 * Proxy Type Definitions (Phase 5.0)
 */

import type { Connector } from '../types/index.js';
import type { ToolInfo } from '../tools/adapter.js';

/** Namespace separator for tool names */
export const NAMESPACE_SEPARATOR = '__';

/** Default timeout in seconds for backend calls */
export const DEFAULT_TIMEOUT = 30;

/** Proxy startup options */
export interface ProxyOptions {
  /** Connectors to expose through the proxy */
  connectors: Connector[];
  /** Config directory path */
  configDir: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Timeout in seconds for backend calls (default: 30) */
  timeout?: number;
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
    resources?: Record<string, unknown>;
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
  structuredContent?: unknown;
  _meta?: {
    ui?: {
      resourceUri?: string;
    };
    outputSchemaVersion?: string;
    [key: string]: unknown;
  };
}

/** MCP resources/list result */
export interface ResourcesListResult {
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>;
}

/** MCP resources/read params */
export interface ResourcesReadParams {
  uri: string;
}

/** MCP resources/read result */
export interface ResourcesReadResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string; // base64
  }>;
}

/** MCP ui/initialize params */
export interface UiInitializeParams {
  protocolVersion?: string;
}

/** MCP ui/initialize result */
export interface UiInitializeResult {
  protocolVersion: string;
  sessionToken: string;
}

// ==================== BridgeEnvelope (Phase 6.2) ====================

/** Bridge envelope for UI tool calls (token is stripped before forwarding to server) */
export interface BridgeEnvelope {
  sessionToken: string;
}

/** Extended tool call params with bridge envelope */
export interface ToolsCallParamsWithBridge extends ToolsCallParams {
  _bridge?: BridgeEnvelope;
}

/** Clean tool call params (without _bridge) */
export type CleanToolCallParams = Omit<ToolsCallParamsWithBridge, '_bridge'>;

/** Result of sanitizing tool call params */
export interface SanitizeToolCallResult {
  /** Clean params without _bridge (safe to forward to server) */
  clean: CleanToolCallParams;
  /** Extracted bridge token for audit logging only */
  bridgeToken?: string;
}

/** Correlation IDs for UI tool request tracking */
export interface CorrelationIds {
  /** UI session identifier (derived from sessionToken) */
  ui_session_id: string;
  /** Individual RPC call identifier */
  ui_rpc_id: string;
  /** Request → response tracking ID */
  correlation_id: string;
  /** Tool call fingerprint (name + args hash) */
  tool_call_fingerprint: string;
}

/** UI event types for audit logging */
export type UiEventType =
  | 'ui_tool_request'
  | 'ui_tool_result'
  | 'ui_tool_delivered';

/** Base UI event for audit logging */
export interface UiEventBase {
  type: UiEventType;
  correlationIds: CorrelationIds;
  timestamp: number;
}

/** UI tool request event */
export interface UiToolRequestEvent extends UiEventBase {
  type: 'ui_tool_request';
  toolName: string;
  arguments: Record<string, unknown>;
  /** Token is recorded here for audit, but never forwarded to server */
  sessionToken?: string;
}

/** UI tool result event */
export interface UiToolResultEvent extends UiEventBase {
  type: 'ui_tool_result';
  result: unknown;
  duration_ms: number;
}

/** UI tool delivered event (sent to UI) */
export interface UiToolDeliveredEvent extends UiEventBase {
  type: 'ui_tool_delivered';
  result: unknown;
}
