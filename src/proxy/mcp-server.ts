/**
 * MCP Proxy Server (Phase 5.0+)
 *
 * A stdio-based MCP server that aggregates tools from multiple backend
 * connectors and routes requests accordingly.
 *
 * Supported methods:
 * - initialize
 * - notifications/initialized
 * - tools/list
 * - tools/call
 * - resources/list (Phase 6.1+)
 * - resources/read (Phase 6.1+)
 * - ui/initialize (Phase 6.1+)
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { dirname } from 'path';
import { logger, initializeRingBuffer, isVerbose } from './logger.js';
import { ToolAggregator } from './tool-aggregator.js';
import { RequestRouter } from './request-router.js';
import {
  RuntimeStateManager,
  type ConnectorSummary,
} from './runtime-state.js';
import {
  MCP_ERROR,
  type ProxyOptions,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type InitializeParams,
  type InitializeResult,
  type ToolsListResult,
  type ToolsCallParams,
  type ToolsCallResult,
  type ResourcesListResult,
  type ResourcesReadParams,
  type ResourcesReadResult,
  type UiInitializeParams,
  type UiInitializeResult,
} from './types.js';
import { IpcServer } from './ipc-server.js';
import { getSocketPath, type ReloadResult } from './ipc-types.js';
import { ConfigManager } from '../config/manager.js';
import type { Connector } from '../types/config.js';
import { EventsStore } from '../db/events-store.js';
import { sanitizeToolCall, generateCorrelationIds, uiSessionIdFromToken } from './bridge-utils.js';
import type {
  ToolsCallParamsWithBridge,
  CorrelationIds,
} from './types.js';

const PROTOCOL_VERSION = '2024-11-05';
const UI_PROTOCOL_VERSION = '2025-11-21';
const SERVER_NAME = 'proofscan-proxy';
const SERVER_VERSION = '0.7.0';

/** Maximum buffer size in bytes (1MB) - prevents memory exhaustion attacks */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** UI Resource URI for trace viewer */
const TRACE_VIEWER_URI = 'ui://proofscan/trace-viewer';

/** Maximum URI length to prevent buffer overflow attacks */
const MAX_URI_LENGTH = 2048;

/** Get the trace-viewer HTML content */
function getTraceViewerHtml(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const htmlPath = join(__dirname, '../html/trace-viewer.html');
    return readFileSync(htmlPath, 'utf-8');
  } catch (error) {
    logger.error(`Failed to load trace-viewer.html: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('UI resource unavailable');
  }
}

/** Maximum log lines in ring buffer */
const MAX_LOG_LINES = 1000;

/** Maximum events to return in a single page */
const MAX_EVENTS_LIMIT = 200;

/** Maximum payload size before truncation (10KB) */
const MAX_PAYLOAD_BYTES = 10240;

/** Truncate a payload if it exceeds the max size */
function truncatePayload(payload: unknown, maxBytes: number = MAX_PAYLOAD_BYTES): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  const str = JSON.stringify(payload, null, 2);
  if (str.length <= maxBytes) {
    return payload;
  }

  return {
    _truncated: true,
    preview: str.slice(0, 500) + '...',
    _originalSize: str.length,
  };
}

/** Redact secrets from an object (recursively) */
function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Don't redact string values - only redact based on object keys
    return obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      // Redact keys that look like secrets
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('bearer')
      ) {
        result[key] = '***';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * MCP Proxy Server
 *
 * Reads JSON-RPC from stdin, writes responses to stdout.
 * All logging goes to stderr.
 */
export class McpProxyServer extends EventEmitter {
  private readonly options: ProxyOptions;
  private aggregator: ToolAggregator;
  private router: RequestRouter;
  private readonly stateManager: RuntimeStateManager;
  private readonly configPath: string;
  private ipcServer: IpcServer | null = null;
  private buffer = '';
  private initialized = false;
  private running = false;

  /** Current client info (extracted from initialize) */
  private currentClient: {
    name: string;
    protocolVersion: string;
  } | null = null;

  /** Session tokens for UI validation */
  private sessionTokens: Set<string> = new Set();

  /** Events store for UI audit logging (Phase 6.2) */
  private readonly eventsStore: EventsStore;

  constructor(options: ProxyOptions, configPath?: string) {
    super();
    this.options = options;
    this.configPath = configPath || join(options.configDir, 'config.json');
    this.aggregator = new ToolAggregator(options);
    this.router = new RequestRouter(options, this.aggregator);
    this.stateManager = new RuntimeStateManager(options.configDir);
    this.eventsStore = new EventsStore(options.configDir);
  }

  /**
   * Start the proxy server
   *
   * Begins reading from stdin and processing JSON-RPC messages.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running');
    }

    this.running = true;
    logger.info('MCP proxy server starting...', 'server');

    // Initialize ring buffer for log viewing
    initializeRingBuffer({
      maxLines: MAX_LOG_LINES,
      logPath: join(this.options.configDir, 'proxy-logs.jsonl'),
      onCountChange: (count) => {
        this.stateManager.updateLogCount(count);
      },
    });

    // Build connector summaries for status display
    const connectorSummaries = await this.buildConnectorSummaries();

    // Initialize runtime state
    const logLevel = isVerbose() ? 'INFO' : 'WARN';
    await this.stateManager.initialize(connectorSummaries, logLevel);
    this.stateManager.startHeartbeat();

    // Preload tools from all connectors (eager loading)
    // This prevents cold start delays when the first tools/list arrives
    await this.aggregator.preloadTools();

    // Update connector summaries with actual tool counts
    await this.updateConnectorSummaries();

    // Set up stdin
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => this.handleData(chunk));
    process.stdin.on('end', () => this.handleEnd());
    process.stdin.on('error', (err) => this.handleError(err));

    // Resume stdin
    process.stdin.resume();

    // Start IPC server for control commands (reload, stop, status)
    await this.startIpcServer();

    logger.info(`Proxy started with ${this.options.connectors.length} connector(s)`, 'server');
  }

  /**
   * Start the IPC server for control commands
   */
  private async startIpcServer(): Promise<void> {
    const socketPath = getSocketPath(this.options.configDir);

    this.ipcServer = new IpcServer(socketPath, {
      onReload: () => this.handleReload(),
      onStop: () => this.handleIpcStop(),
      onStatus: () => this.stateManager.getState(),
    });

    try {
      await this.ipcServer.start();
      logger.info(`IPC server listening on ${socketPath}`, 'server');
    } catch (err) {
      logger.warn(`Failed to start IPC server: ${err instanceof Error ? err.message : err}`, 'server');
      // Continue without IPC - proxy still works, just no reload support
    }
  }

  /**
   * Handle reload command from IPC
   */
  private async handleReload(): Promise<ReloadResult> {
    logger.info('Reloading configuration...', 'server');

    const result: ReloadResult = {
      success: true,
      reloadedConnectors: [],
      failedConnectors: [],
    };

    try {
      // Load fresh config
      const configManager = new ConfigManager(this.configPath);
      const newConfig = await configManager.load();

      // Get connector IDs that are currently enabled
      const newConnectorIds = new Set(
        newConfig.connectors.filter((c: Connector) => c.enabled).map((c: Connector) => c.id)
      );
      const currentConnectorIds = new Set(this.options.connectors.map((c) => c.id));

      // Find changed connectors
      const addedIds = [...newConnectorIds].filter((id) => !currentConnectorIds.has(id));
      const removedIds = [...currentConnectorIds].filter((id) => !newConnectorIds.has(id));

      // Check for modified connectors (simple hash comparison would be better, but this works)
      const modifiedIds: string[] = [];
      for (const newConn of newConfig.connectors.filter((c: Connector) => c.enabled)) {
        const oldConn = this.options.connectors.find((c) => c.id === newConn.id);
        if (oldConn && JSON.stringify(oldConn) !== JSON.stringify(newConn)) {
          modifiedIds.push(newConn.id);
        }
      }

      const changedIds = [...new Set([...addedIds, ...removedIds, ...modifiedIds])];

      if (changedIds.length === 0) {
        logger.info('No configuration changes detected', 'server');
        result.message = 'No changes detected';
        return result;
      }

      logger.info(`Configuration changes: added=${addedIds.length}, removed=${removedIds.length}, modified=${modifiedIds.length}`, 'server');

      // Update options with new connectors
      this.options.connectors = newConfig.connectors.filter((c: Connector) => c.enabled);

      // Recreate aggregator and router with new config
      this.aggregator.invalidateCache();
      this.aggregator = new ToolAggregator(this.options);
      this.router = new RequestRouter(this.options, this.aggregator);

      // Preload tools from all connectors
      await this.aggregator.preloadTools();

      // Update connector summaries
      await this.updateConnectorSummaries();

      result.reloadedConnectors = changedIds;
      result.message = `Reloaded ${changedIds.length} connector(s)`;

      logger.info(`Reload complete: ${changedIds.join(', ')}`, 'server');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Reload failed: ${errorMessage}`, 'server');
      result.success = false;
      result.message = errorMessage;
    }

    return result;
  }

  /**
   * Handle stop command from IPC
   */
  private handleIpcStop(): void {
    logger.info('Stop command received via IPC', 'server');
    // Give time for IPC response to be sent
    setTimeout(() => {
      this.stop();
      process.exit(0);
    }, 200);
  }

  /**
   * Build connector summaries for status display
   */
  private async buildConnectorSummaries(): Promise<ConnectorSummary[]> {
    const summaries: ConnectorSummary[] = [];

    for (const connector of this.options.connectors) {
      try {
        // Try to get tool count - this doesn't actually connect yet
        // The actual connection happens when tools/list is called
        summaries.push({
          id: connector.id,
          toolCount: 0, // Will be updated on first tools/list
          healthy: true,
        });
      } catch (error) {
        summaries.push({
          id: connector.id,
          toolCount: 0,
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summaries;
  }

  /**
   * Update connector summaries with actual tool counts after preloading
   */
  private async updateConnectorSummaries(): Promise<void> {
    try {
      const tools = await this.aggregator.getAggregatedTools();

      // Group tools by connector
      const toolsByConnector = new Map<string, number>();
      for (const tool of tools) {
        const count = toolsByConnector.get(tool.connectorId) ?? 0;
        toolsByConnector.set(tool.connectorId, count + 1);
      }

      // Build updated summaries
      const updatedSummaries: ConnectorSummary[] = [];
      for (const connector of this.options.connectors) {
        const toolCount = toolsByConnector.get(connector.id) ?? 0;
        updatedSummaries.push({
          id: connector.id,
          toolCount,
          healthy: toolCount > 0,
          error: toolCount === 0 ? 'No tools loaded' : undefined,
        });
      }

      // Re-initialize state with updated summaries
      const logLevel = isVerbose() ? 'INFO' : 'WARN';
      await this.stateManager.initialize(updatedSummaries, logLevel);
    } catch (error) {
      logger.warn(`Failed to update connector summaries: ${error instanceof Error ? error.message : error}`, 'server');
    }
  }

  /**
   * Stop the proxy server
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    logger.info('MCP proxy server stopping...', 'server');

    // Stop IPC server
    if (this.ipcServer) {
      this.ipcServer.stop();
      this.ipcServer = null;
    }

    // Stop heartbeat
    this.stateManager.stopHeartbeat();

    // Mark proxy as stopped (async but we don't wait)
    this.stateManager.markStopped().catch(() => {
      // Ignore errors during shutdown
    });

    // Clean up stdin
    process.stdin.pause();
    process.stdin.removeAllListeners();

    this.emit('stopped');
  }

  /**
   * Handle incoming data from stdin
   */
  private handleData(chunk: string): void {
    this.buffer += chunk;

    // Prevent memory exhaustion from large messages without newlines
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      logger.error(`Buffer overflow: ${this.buffer.length} bytes exceeds ${MAX_BUFFER_SIZE}`, 'server');
      this.sendError(null, MCP_ERROR.INVALID_REQUEST, 'Message too large');
      this.buffer = '';
      return;
    }

    this.processBuffer();
  }

  /**
   * Handle stdin end
   */
  private handleEnd(): void {
    logger.info('stdin closed', 'server');

    // Mark current client as gone
    if (this.currentClient) {
      this.stateManager
        .updateClient(this.currentClient.name, { state: 'gone' })
        .catch(() => {
          // Ignore errors during shutdown
        });
    }

    this.stop();
  }

  /**
   * Handle stdin error
   */
  private handleError(err: Error): void {
    logger.error(`stdin error: ${err.message}`);
    this.stop();
  }

  /**
   * Process buffered data and extract complete JSON-RPC messages
   *
   * Messages are newline-delimited JSON.
   */
  private processBuffer(): void {
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        this.processMessage(line).catch((err) => {
          logger.error(`Message processing error: ${err instanceof Error ? err.message : err}`);
        });
      }
    }
  }

  /**
   * Process a single JSON-RPC message
   */
  private async processMessage(line: string): Promise<void> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      logger.error('JSON parse error');
      this.sendError(null, MCP_ERROR.PARSE_ERROR, 'Parse error');
      return;
    }

    // Validate JSON-RPC structure
    if (typeof parsed !== 'object' || parsed === null) {
      logger.error('Invalid request: not an object');
      this.sendError(null, MCP_ERROR.INVALID_REQUEST, 'Invalid Request');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if (msg.jsonrpc !== '2.0') {
      logger.error('Invalid request: not JSON-RPC 2.0');
      this.sendError(null, MCP_ERROR.INVALID_REQUEST, 'Invalid Request');
      return;
    }

    // Check if it's a request (has id) or notification (no id)
    const hasId = 'id' in msg && msg.id !== undefined;
    const method = msg.method as string | undefined;

    if (!method || typeof method !== 'string') {
      logger.error('Invalid request: missing method');
      if (hasId) {
        this.sendError(msg.id as string | number | null, MCP_ERROR.INVALID_REQUEST, 'Invalid Request');
      }
      return;
    }

    if (hasId) {
      // It's a request - needs response
      await this.handleRequest(msg as unknown as JsonRpcRequest);
    } else {
      // It's a notification - no response needed
      this.handleNotification(msg as unknown as JsonRpcNotification);
    }
  }

  /**
   * Handle a JSON-RPC request (requires response)
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    // Check if server is still running (prevents race condition on shutdown)
    if (!this.running) {
      return;
    }

    const { id, method, params } = request;

    logger.info(`Request: ${method}`);

    switch (method) {
      case 'initialize':
        await this.handleInitialize(id, params as InitializeParams | undefined);
        break;

      case 'tools/list':
        await this.handleToolsList(id);
        break;

      case 'tools/call':
        await this.handleToolsCall(id, params as ToolsCallParams | undefined);
        break;

      case 'resources/list':
        await this.handleResourcesList(id);
        break;

      case 'resources/read':
        await this.handleResourcesRead(id, params as ResourcesReadParams | undefined);
        break;

      case 'ui/initialize':
        await this.handleUiInitialize(id, params as UiInitializeParams | undefined);
        break;

      default:
        logger.warn(`Unknown method: ${method}`);
        this.sendError(id, MCP_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  /**
   * Handle a JSON-RPC notification (no response)
   */
  private handleNotification(notification: JsonRpcNotification): void {
    const { method } = notification;

    logger.info(`Notification: ${method}`);

    switch (method) {
      case 'notifications/initialized':
        // Client acknowledged initialization
        logger.info('Client initialized');
        break;

      default:
        // Unknown notifications are silently ignored per MCP spec
        logger.info(`Ignoring notification: ${method}`);
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(
    id: string | number | null,
    params: InitializeParams | undefined
  ): Promise<void> {
    if (this.initialized) {
      logger.warn('Already initialized', 'init');
    }

    const clientVersion = params?.protocolVersion || 'unknown';
    const clientName = params?.clientInfo?.name || 'unknown';
    logger.info(`Client: ${clientName} (protocol=${clientVersion})`, 'init');

    // Track client
    this.currentClient = {
      name: clientName,
      protocolVersion: clientVersion,
    };

    // Update client state
    await this.stateManager.updateClient(clientName, {
      name: clientName,
      protocolVersion: clientVersion,
      state: 'active',
    });

    this.initialized = true;

    const result: InitializeResult = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    };

    this.sendResult(id, result);
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(id: string | number | null): Promise<void> {
    if (!this.initialized) {
      logger.warn('tools/list before initialize');
    }

    try {
      const tools = await this.aggregator.getAggregatedTools();

      // Add proofscan_getEvents tool (Phase 6.1)
      const toolsList = [
        ...tools.map((t) => ({
          name: t.namespacedName,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        {
          name: 'proofscan_getEvents',
          description: 'Get protocol events (paginated). Returns text summary + structured data.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              limit: { type: 'number', default: 50 },
              before: { type: 'string', description: 'Event ID for pagination' },
            },
            required: ['sessionId'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    type: { type: 'string' },
                    rpcId: { type: 'string' },
                    timestamp: { type: 'number' },
                    duration_ms: { type: 'number' },
                  },
                },
              },
              sessionId: { type: 'string' },
              hasMore: { type: 'boolean' },
            },
          },
          _meta: {
            ui: { resourceUri: TRACE_VIEWER_URI },
            outputSchemaVersion: '1',
          },
        },
      ];

      const result: ToolsListResult = {
        tools: toolsList,
      };

      logger.info(`Returning ${toolsList.length} tool(s)`);
      this.sendResult(id, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`tools/list failed: ${errorMessage}`);
      this.sendError(id, MCP_ERROR.INTERNAL_ERROR, errorMessage);
    }
  }

  /**
   * Handle tools/call request
   *
   * Phase 6.2: Handles BridgeEnvelope (_bridge.sessionToken) stripping,
   * correlation ID generation, and UI audit logging.
   */
  private async handleToolsCall(
    id: string | number | null,
    params: ToolsCallParams | undefined
  ): Promise<void> {
    if (!this.initialized) {
      logger.warn('tools/call before initialize');
    }

    if (!params || typeof params.name !== 'string') {
      logger.error('tools/call: missing or invalid name');
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'Missing required parameter: name');
      return;
    }

    const rpcId = typeof id === 'number' ? id : parseInt(String(id) || '0', 10);

    // Sanitize params: extract bridge token, strip _bridge envelope
    const { clean, bridgeToken } = sanitizeToolCall(
      params as ToolsCallParamsWithBridge
    );

    const { name, arguments: args = {} } = clean;
    logger.info(`tools/call name=${name}`);

    // Generate correlation IDs for tracking
    const correlationIds: CorrelationIds = generateCorrelationIds(
      bridgeToken,
      rpcId
    );
    const uiSessionId = correlationIds.ui_session_id;

    // Record tool call for client tracking
    if (this.currentClient) {
      await this.stateManager.recordToolCall(this.currentClient.name);
    }

    // Record ui_tool_request event (Phase 6.2)
    // Token is recorded here for audit, but never forwarded to server
    this.eventsStore.saveUiToolRequestEvent(
      uiSessionId,
      correlationIds.ui_rpc_id,
      correlationIds.correlation_id,
      correlationIds.tool_call_fingerprint,
      name,
      {
        arguments: args,
        sessionToken: bridgeToken, // Recorded for audit only
      }
    );

    const startTime = Date.now();

    // Handle proofscan_getEvents (Phase 6.2: pagination + 3-layer result)
    if (name === 'proofscan_getEvents') {
      const sessionId = args.sessionId as string | undefined;
      if (!sessionId) {
        logger.error('proofscan_getEvents: missing sessionId');
        this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'Missing required parameter: sessionId');
        return;
      }

      const limit = Math.min(
        (args.limit as number | undefined) ?? 50,
        MAX_EVENTS_LIMIT
      );
      const before = args.before as string | undefined;

      // Get events from EventsStore with pagination
      const events = this.eventsStore.getEvents(sessionId, { limit, before });

      // Build response map for O(n) duration calculation (instead of O(n²))
      const responseMap = new Map(
        events
          .filter((e) => e.kind === 'response' && e.rpc_id)
          .map((e) => [e.rpc_id, e])
      );

      // Calculate duration for events with rpc_id
      const eventsWithDuration = events.map((e) => {
        let duration_ms: number | null = null;

        // For request events, look up matching response from map
        if (e.kind === 'request' && e.rpc_id) {
          const response = responseMap.get(e.rpc_id);
          if (response) {
            const requestTime = new Date(e.ts).getTime();
            const responseTime = new Date(response.ts).getTime();
            duration_ms = responseTime - requestTime;
          }
        }

        return { ...e, duration_ms };
      });

      // Prepare human-readable summary (content layer)
      const summaryLines = eventsWithDuration.slice(0, 5).map(
        (e) => `- ${e.kind} (${e.direction}${e.duration_ms !== null ? `, ${e.duration_ms}ms` : ''})`
      );
      const moreCount = eventsWithDuration.length - 5;
      const textSummary = `Found ${eventsWithDuration.length} events in session ${sessionId}.\n` +
        summaryLines.join('\n') +
        (moreCount > 0 ? `\n... and ${moreCount} more` : '');

      // Prepare structured content (structuredContent layer) - matches outputSchema
      const structuredEvents = eventsWithDuration.map((e) => ({
        id: e.event_id,
        type: e.kind,
        rpcId: e.rpc_id ?? null,
        timestamp: new Date(e.ts).getTime(),
        duration_ms: e.duration_ms ?? 0,
      }));

      // Prepare full events for UI (_meta layer) - with truncation and redaction
      const truncatedEvents = eventsWithDuration.map((e) => {
        const fullEvent: Record<string, unknown> = {
          id: e.event_id,
          session_id: e.session_id,
          rpc_id: e.rpc_id,
          direction: e.direction,
          kind: e.kind,
          ts: e.ts,
          seq: e.seq,
          summary: e.summary,
          payload_hash: e.payload_hash,
        };

        // Parse and redact raw_json if present
        if (e.raw_json) {
          try {
            const raw = JSON.parse(e.raw_json);
            const redacted = redactSecrets(raw);
            fullEvent.payload = truncatePayload(redacted);
          } catch {
            // If parsing fails, just truncate the raw string
            fullEvent.raw_json = truncatePayload(e.raw_json);
          }
        }

        // Parse and redact normalized_json if present
        if (e.normalized_json) {
          try {
            const normalized = JSON.parse(e.normalized_json);
            const redacted = redactSecrets(normalized);
            fullEvent.normalized = truncatePayload(redacted);
          } catch {
            fullEvent.normalized_json = truncatePayload(e.normalized_json);
          }
        }

        return fullEvent;
      });

      const callResult: ToolsCallResult = {
        content: [
          {
            type: 'text',
            text: textSummary,
          },
        ],
        structuredContent: {
          events: structuredEvents,
          sessionId,
          hasMore: eventsWithDuration.length === limit,
        },
        _meta: {
          ui: { resourceUri: TRACE_VIEWER_URI },
          fullEvents: truncatedEvents,
          outputSchemaVersion: '1',
        },
      };

      // Record ui_tool_result event
      const durationMs = Date.now() - startTime;
      this.eventsStore.saveUiToolResultEvent(
        uiSessionId,
        correlationIds.ui_rpc_id,
        correlationIds.correlation_id,
        correlationIds.tool_call_fingerprint,
        {
          result: callResult,
          duration_ms: durationMs,
        }
      );

      // Record ui_tool_delivered event
      this.eventsStore.saveUiToolDeliveredEvent(
        uiSessionId,
        correlationIds.ui_rpc_id,
        correlationIds.correlation_id,
        correlationIds.tool_call_fingerprint,
        {
          result: callResult,
        }
      );

      this.sendResult(id, callResult);
      return;
    }

    const result = await this.router.routeToolCall(name, args as Record<string, unknown>);

    if (!result.success) {
      // Routing or backend error
      const errorResult = { error: result.error || 'Unknown error' };

      // Record ui_tool_result event (error case)
      const durationMs = Date.now() - startTime;
      this.eventsStore.saveUiToolResultEvent(
        uiSessionId,
        correlationIds.ui_rpc_id,
        correlationIds.correlation_id,
        correlationIds.tool_call_fingerprint,
        {
          result: errorResult,
          duration_ms: durationMs,
        }
      );

      // Record ui_tool_delivered event (error case)
      this.eventsStore.saveUiToolDeliveredEvent(
        uiSessionId,
        correlationIds.ui_rpc_id,
        correlationIds.correlation_id,
        correlationIds.tool_call_fingerprint,
        {
          result: errorResult,
        }
      );

      this.sendError(id, MCP_ERROR.INTERNAL_ERROR, result.error || 'Unknown error');
      return;
    }

    const callResult: ToolsCallResult = {
      content: result.content,
      isError: result.isError,
    };

    // Record ui_tool_result event
    const durationMs = Date.now() - startTime;
    this.eventsStore.saveUiToolResultEvent(
      uiSessionId,
      correlationIds.ui_rpc_id,
      correlationIds.correlation_id,
      correlationIds.tool_call_fingerprint,
      {
        result: callResult,
        duration_ms: durationMs,
      }
    );

    // Record ui_tool_delivered event
    this.eventsStore.saveUiToolDeliveredEvent(
      uiSessionId,
      correlationIds.ui_rpc_id,
      correlationIds.correlation_id,
      correlationIds.tool_call_fingerprint,
      {
        result: callResult,
      }
    );

    this.sendResult(id, callResult);
  }

  /**
   * Handle resources/list request
   */
  private async handleResourcesList(id: string | number | null): Promise<void> {
    if (!this.initialized) {
      logger.warn('resources/list before initialize');
    }

    const result: ResourcesListResult = {
      resources: [
        {
          uri: TRACE_VIEWER_URI,
          name: 'Protocol Trace Viewer',
          description: 'Interactive timeline of MCP/A2A events',
          mimeType: 'text/html;profile=mcp-app',
        },
      ],
    };

    logger.info(`Returning 1 resource(s)`);
    this.sendResult(id, result);
  }

  /**
   * Handle resources/read request
   */
  private async handleResourcesRead(
    id: string | number | null,
    params: ResourcesReadParams | undefined
  ): Promise<void> {
    if (!this.initialized) {
      logger.warn('resources/read before initialize');
    }

    if (!params || typeof params.uri !== 'string') {
      logger.error('resources/read: missing or invalid uri');
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'Missing required parameter: uri');
      return;
    }

    const { uri } = params;
    logger.info(`resources/read uri=${uri}`);

    // URI validation
    if (uri.length > MAX_URI_LENGTH) {
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'URI too long');
      return;
    }

    if (!uri.startsWith('ui://proofscan/')) {
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'Invalid URI scheme or host');
      return;
    }

    if (uri.includes('..')) {
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, 'Invalid URI path');
      return;
    }

    if (uri === TRACE_VIEWER_URI) {
      try {
        const html = getTraceViewerHtml();
        const result: ResourcesReadResult = {
          contents: [
            {
              uri,
              mimeType: 'text/html;profile=mcp-app',
              text: html,
            },
          ],
        };
        this.sendResult(id, result);
      } catch (error) {
        logger.error(`Failed to load UI resource: ${error instanceof Error ? error.message : String(error)}`);
        this.sendError(id, MCP_ERROR.INTERNAL_ERROR, 'Failed to load UI resource');
        return;
      }
    } else {
      this.sendError(id, MCP_ERROR.INVALID_PARAMS, `Resource not found: ${uri}`);
    }
  }

  /**
   * Handle ui/initialize request
   */
  private async handleUiInitialize(
    id: string | number | null,
    params: UiInitializeParams | undefined
  ): Promise<void> {
    logger.info('ui/initialize - generating session token');

    // Generate random session token
    const sessionToken = randomUUID();

    // Store token for validation
    this.sessionTokens.add(sessionToken);

    const result: UiInitializeResult = {
      protocolVersion: UI_PROTOCOL_VERSION,
      sessionToken,
    };

    logger.info(`Session token generated: ${sessionToken}`);
    this.sendResult(id, result);
  }

  /**
   * Validate a session token
   *
   * Used by future ui/call endpoints to verify requests from authenticated UI sessions.
   *
   * @param token - The session token to validate
   * @returns true if the token is valid and still stored, false otherwise
   */
  private isValidSessionToken(token: string): boolean {
    return this.sessionTokens.has(token);
  }

  /**
   * Send a JSON-RPC response with result
   */
  private sendResult(id: string | number | null, result: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    this.send(response);
  }

  /**
   * Send a JSON-RPC error response
   */
  private sendError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    };

    this.send(response);
  }

  /**
   * Send a message to stdout
   */
  private send(message: JsonRpcResponse): void {
    const json = JSON.stringify(message);
    process.stdout.write(json + '\n');
  }
}
