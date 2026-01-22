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
 */

import { EventEmitter } from 'events';
import { join } from 'path';
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
} from './types.js';
import { IpcServer } from './ipc-server.js';
import { getSocketPath, type ReloadResult } from './ipc-types.js';
import { ConfigManager } from '../config/manager.js';
import type { Connector } from '../types/config.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'proofscan-proxy';
const SERVER_VERSION = '0.7.0';

/** Maximum buffer size in bytes (1MB) - prevents memory exhaustion attacks */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Maximum log lines in ring buffer */
const MAX_LOG_LINES = 1000;

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

  constructor(options: ProxyOptions, configPath?: string) {
    super();
    this.options = options;
    this.configPath = configPath || join(options.configDir, 'config.json');
    this.aggregator = new ToolAggregator(options);
    this.router = new RequestRouter(options, this.aggregator);
    this.stateManager = new RuntimeStateManager(options.configDir);
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

      const result: ToolsListResult = {
        tools: tools.map((t) => ({
          name: t.namespacedName,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

      logger.info(`Returning ${tools.length} tool(s)`);
      this.sendResult(id, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`tools/list failed: ${errorMessage}`);
      this.sendError(id, MCP_ERROR.INTERNAL_ERROR, errorMessage);
    }
  }

  /**
   * Handle tools/call request
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

    const { name, arguments: args = {} } = params;
    logger.info(`tools/call name=${name}`);

    // Record tool call for client tracking
    if (this.currentClient) {
      await this.stateManager.recordToolCall(this.currentClient.name);
    }

    const result = await this.router.routeToolCall(name, args as Record<string, unknown>);

    if (!result.success) {
      // Routing or backend error
      this.sendError(id, MCP_ERROR.INTERNAL_ERROR, result.error || 'Unknown error');
      return;
    }

    const callResult: ToolsCallResult = {
      content: result.content,
      isError: result.isError,
    };

    this.sendResult(id, callResult);
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
