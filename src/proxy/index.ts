/**
 * Proxy Module Exports (Phase 5.0+)
 */

export {
  logger,
  setVerbose,
  isVerbose,
  LogRingBuffer,
  getRingBuffer,
  type LogEntry,
  type RingBufferConfig,
} from './logger.js';
export { ToolAggregator } from './tool-aggregator.js';
export { RequestRouter } from './request-router.js';
export { McpProxyServer } from './mcp-server.js';
export {
  RuntimeStateManager,
  DEFAULT_RUNTIME_STATE,
  type ClientState,
  type ClientInfo,
  type ConnectorSummary,
  type ProxyRuntimeState,
} from './runtime-state.js';
export {
  NAMESPACE_SEPARATOR,
  MCP_ERROR,
  type ProxyOptions,
  type NamespacedTool,
  type ParsedNamespace,
  type RouteResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpErrorCode,
} from './types.js';
