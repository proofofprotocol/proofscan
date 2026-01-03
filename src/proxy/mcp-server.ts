/**
 * MCP Proxy Server (Phase 5.0)
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
import { logger } from './logger.js';
import { ToolAggregator } from './tool-aggregator.js';
import { RequestRouter } from './request-router.js';
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

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'proofscan-proxy';
const SERVER_VERSION = '0.7.0';

/**
 * MCP Proxy Server
 *
 * Reads JSON-RPC from stdin, writes responses to stdout.
 * All logging goes to stderr.
 */
export class McpProxyServer extends EventEmitter {
  private readonly aggregator: ToolAggregator;
  private readonly router: RequestRouter;
  private buffer = '';
  private initialized = false;
  private running = false;

  constructor(options: ProxyOptions) {
    super();
    this.aggregator = new ToolAggregator(options);
    this.router = new RequestRouter(options, this.aggregator);
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
    logger.info('MCP proxy server starting...');

    // Set up stdin
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => this.handleData(chunk));
    process.stdin.on('end', () => this.handleEnd());
    process.stdin.on('error', (err) => this.handleError(err));

    // Resume stdin
    process.stdin.resume();
  }

  /**
   * Stop the proxy server
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    logger.info('MCP proxy server stopping...');

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
    this.processBuffer();
  }

  /**
   * Handle stdin end
   */
  private handleEnd(): void {
    logger.info('stdin closed');
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
        this.processMessage(line);
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
      logger.warn('Already initialized');
    }

    const clientVersion = params?.protocolVersion || 'unknown';
    const clientName = params?.clientInfo?.name || 'unknown';
    logger.info(`Client: ${clientName} (protocol=${clientVersion})`);

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
