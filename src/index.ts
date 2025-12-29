/**
 * proofscan - MCP Server scanner
 * Programmatic API exports
 */

// Types
export type {
  TransportType,
  StdioTransport,
  HttpTransport,
  SseTransport,
  Transport,
  ConnectorPlugins,
  Connector,
  RetentionConfig,
  Config,
} from './types/config.js';
export { DEFAULT_CONFIG, DEFAULT_RETENTION } from './types/config.js';

// DB types (Phase2)
export type {
  ExitReason,
  EventDirection,
  EventKind,
  Session,
  RpcCall,
  Event,
  Proof,
  SessionWithStats,
  PruneCandidate,
  ArchivePlan,
} from './db/types.js';

// Config
export { ConfigManager, parseConfig, validateConfig } from './config/index.js';
export { parseMcpServers, readStdin } from './config/import.js';

// Transports
export { StdioConnection } from './transports/stdio.js';
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, JsonRpcMessage } from './transports/stdio.js';

// Database (Phase2)
export { EventsStore } from './db/events-store.js';
export { ProofsStore } from './db/proofs-store.js';
export { getEventsDb, getProofsDb, closeAllDbs, getDbSizes } from './db/connection.js';

// Scanner
export { Scanner } from './scanner/index.js';
export type { ScanResult, ScanOptions } from './scanner/index.js';

// Utils
export { resolveConfigPath, getDefaultConfigDir, getDefaultConfigPath, getEventsDir } from './utils/config-path.js';
export { atomicWriteFile, readFileSafe, fileExists, appendLine, readLastLines } from './utils/fs.js';
