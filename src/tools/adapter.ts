/**
 * Tool Adapter for MCP protocol (Phase 4.0)
 *
 * Provides a clean interface for interacting with MCP server tools:
 * - listTools: Get available tools from a connector
 * - getTool: Get detailed tool info including schema
 * - callTool: Execute a tool with arguments
 *
 * Design notes:
 * - Currently MCP-only, but interface is generic for future A2A support
 * - Spawns a fresh MCP server connection for each operation
 * - Records all RPC calls to events.db for observability
 * - Resolves secret refs (dpapi:xxx) before spawning
 */

import type { Connector, StdioTransport } from '../types/index.js';
import { StdioConnection, JsonRpcResponse } from '../transports/stdio.js';
import { EventsStore } from '../db/events-store.js';
import { ConfigManager } from '../config/index.js';
import { resolveEnvSecrets } from '../secrets/resolve.js';
import type { EventDirection, EventKind } from '../db/types.js';

/** Tool information from tools/list */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: ToolInputSchema;
}

/** JSON Schema for tool input */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Property schema in inputSchema */
export interface PropertySchema {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

/** Tool call result */
export interface ToolCallResult {
  success: boolean;
  content?: unknown[];
  isError?: boolean;
  error?: string;
  /** Session ID for the call (for events.db lookup) */
  sessionId: string;
}

/** Context for tool operations */
export interface ToolContext {
  connectorId: string;
  configDir: string;
}

/**
 * Get connector config by ID
 */
export async function getConnector(configPath: string, connectorId: string): Promise<Connector | null> {
  const manager = new ConfigManager(configPath);
  const config = await manager.load();
  return config.connectors.find((c: Connector) => c.id === connectorId) || null;
}

/**
 * List tools available on a connector
 *
 * Spawns MCP server, performs handshake, calls tools/list, then closes.
 * All RPC calls are recorded to events.db.
 */
export async function listTools(
  ctx: ToolContext,
  connector: Connector,
  options: { timeout?: number } = {}
): Promise<{ tools: ToolInfo[]; sessionId: string; error?: string }> {
  const timeout = (options.timeout || 30) * 1000;

  if (connector.transport.type !== 'stdio') {
    return {
      tools: [],
      sessionId: '',
      error: `Unsupported transport type: ${connector.transport.type}`,
    };
  }

  const transport = connector.transport as StdioTransport;
  const eventsStore = new EventsStore(ctx.configDir);

  // Resolve secret refs in env vars
  const resolveResult = await resolveEnvSecrets(
    transport.env,
    connector.id,
    ctx.configDir
  );

  if (!resolveResult.success) {
    const errMsgs = resolveResult.errors.map(e => `${e.key}: ${e.message}`).join('; ');
    return {
      tools: [],
      sessionId: '',
      error: `Failed to resolve secrets: ${errMsgs}`,
    };
  }

  // Create transport with resolved env
  const resolvedTransport: StdioTransport = {
    ...transport,
    env: { ...transport.env, ...resolveResult.envResolved },
  };

  const connection = new StdioConnection(resolvedTransport);
  const session = eventsStore.createSession(connector.id);
  const sessionId = session.session_id;

  // Track RPC calls for event correlation
  const rpcIdMap = new Map<string | number, string>();

  try {
    // Set up message logging
    connection.on('message', (msg, raw) => {
      const isRequest = 'method' in msg && 'id' in msg && msg.id !== null;
      const isResponse = 'id' in msg && !('method' in msg);

      const direction: EventDirection = isResponse ? 'server_to_client' : 'client_to_server';
      let kind: EventKind;
      if (isRequest) kind = 'request';
      else if ('method' in msg) kind = 'notification';
      else if (isResponse) kind = 'response';
      else kind = 'transport_event';

      let rpcId: string | undefined;

      if (isRequest && 'method' in msg) {
        const rpcCall = eventsStore.saveRpcCall(sessionId, String(msg.id), msg.method);
        rpcIdMap.set(msg.id as string | number, rpcCall.rpc_id);
        rpcId = rpcCall.rpc_id;
      } else if (isResponse && 'id' in msg && msg.id !== null) {
        rpcId = rpcIdMap.get(msg.id as string | number);
        if (rpcId) {
          const resp = msg as JsonRpcResponse;
          eventsStore.completeRpcCall(sessionId, String(msg.id), !resp.error, resp.error?.code);
        }
      }

      eventsStore.saveEvent(sessionId, direction, kind, {
        rpcId: rpcId || (('id' in msg && msg.id !== null) ? String(msg.id) : undefined),
        rawJson: raw,
      });
    });

    // Connect
    await connection.connect();

    eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
      rawJson: JSON.stringify({ type: 'connected' }),
    });

    // MCP handshake
    await connection.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'proofscan',
        version: '0.7.0',
      },
    }, timeout);

    connection.sendNotification('notifications/initialized', {});

    // Call tools/list
    const toolsListResponse = await connection.sendRequest('tools/list', {}, timeout);

    eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
      rawJson: JSON.stringify({ type: 'disconnected' }),
    });
    eventsStore.endSession(sessionId, 'normal');

    // Extract tools
    const tools: ToolInfo[] = [];
    if (toolsListResponse.result && typeof toolsListResponse.result === 'object') {
      const result = toolsListResponse.result as { tools?: unknown[] };
      if (Array.isArray(result.tools)) {
        for (const t of result.tools) {
          if (typeof t === 'object' && t !== null && 'name' in t) {
            tools.push({
              name: String((t as Record<string, unknown>).name),
              description: (t as Record<string, unknown>).description
                ? String((t as Record<string, unknown>).description)
                : undefined,
              inputSchema: (t as Record<string, unknown>).inputSchema as ToolInputSchema | undefined,
            });
          }
        }
      }
    }

    return { tools, sessionId };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
      rawJson: JSON.stringify({ type: 'error', error: errMsg }),
    });
    eventsStore.endSession(sessionId, 'error');

    return {
      tools: [],
      sessionId,
      error: errMsg,
    };
  } finally {
    // Guarantee connection cleanup to prevent zombie processes
    connection.close();
  }
}

/**
 * Get detailed tool information by name
 */
export async function getTool(
  ctx: ToolContext,
  connector: Connector,
  toolName: string,
  options: { timeout?: number } = {}
): Promise<{ tool: ToolInfo | null; sessionId: string; error?: string }> {
  const result = await listTools(ctx, connector, options);

  if (result.error) {
    return { tool: null, sessionId: result.sessionId, error: result.error };
  }

  const tool = result.tools.find(t => t.name === toolName);
  if (!tool) {
    return {
      tool: null,
      sessionId: result.sessionId,
      error: `Tool not found: ${toolName}`,
    };
  }

  return { tool, sessionId: result.sessionId };
}

/**
 * Call a tool with arguments
 *
 * Spawns MCP server, performs handshake, calls tools/call, then closes.
 * All RPC calls are recorded to events.db.
 */
export async function callTool(
  ctx: ToolContext,
  connector: Connector,
  toolName: string,
  args: Record<string, unknown>,
  options: { timeout?: number } = {}
): Promise<ToolCallResult> {
  const timeout = (options.timeout || 30) * 1000;

  if (connector.transport.type !== 'stdio') {
    return {
      success: false,
      sessionId: '',
      error: `Unsupported transport type: ${connector.transport.type}`,
    };
  }

  const transport = connector.transport as StdioTransport;
  const eventsStore = new EventsStore(ctx.configDir);

  // Resolve secret refs in env vars
  const resolveResult = await resolveEnvSecrets(
    transport.env,
    connector.id,
    ctx.configDir
  );

  if (!resolveResult.success) {
    const errMsgs = resolveResult.errors.map(e => `${e.key}: ${e.message}`).join('; ');
    return {
      success: false,
      sessionId: '',
      error: `Failed to resolve secrets: ${errMsgs}`,
    };
  }

  // Create transport with resolved env
  const resolvedTransport: StdioTransport = {
    ...transport,
    env: { ...transport.env, ...resolveResult.envResolved },
  };

  const connection = new StdioConnection(resolvedTransport);
  const session = eventsStore.createSession(connector.id);
  const sessionId = session.session_id;

  // Track RPC calls
  const rpcIdMap = new Map<string | number, string>();

  try {
    // Set up message logging
    connection.on('message', (msg, raw) => {
      const isRequest = 'method' in msg && 'id' in msg && msg.id !== null;
      const isResponse = 'id' in msg && !('method' in msg);

      const direction: EventDirection = isResponse ? 'server_to_client' : 'client_to_server';
      let kind: EventKind;
      if (isRequest) kind = 'request';
      else if ('method' in msg) kind = 'notification';
      else if (isResponse) kind = 'response';
      else kind = 'transport_event';

      let rpcId: string | undefined;

      if (isRequest && 'method' in msg) {
        const rpcCall = eventsStore.saveRpcCall(sessionId, String(msg.id), msg.method);
        rpcIdMap.set(msg.id as string | number, rpcCall.rpc_id);
        rpcId = rpcCall.rpc_id;
      } else if (isResponse && 'id' in msg && msg.id !== null) {
        rpcId = rpcIdMap.get(msg.id as string | number);
        if (rpcId) {
          const resp = msg as JsonRpcResponse;
          eventsStore.completeRpcCall(sessionId, String(msg.id), !resp.error, resp.error?.code);
        }
      }

      eventsStore.saveEvent(sessionId, direction, kind, {
        rpcId: rpcId || (('id' in msg && msg.id !== null) ? String(msg.id) : undefined),
        rawJson: raw,
      });
    });

    // Connect
    await connection.connect();

    eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
      rawJson: JSON.stringify({ type: 'connected' }),
    });

    // MCP handshake
    await connection.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'proofscan',
        version: '0.7.0',
      },
    }, timeout);

    connection.sendNotification('notifications/initialized', {});

    // Call tools/call
    const callResponse = await connection.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    }, timeout);

    eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
      rawJson: JSON.stringify({ type: 'disconnected' }),
    });
    eventsStore.endSession(sessionId, 'normal');

    // Process response
    if (callResponse.error) {
      return {
        success: false,
        sessionId,
        error: callResponse.error.message,
      };
    }

    const result = callResponse.result as { content?: unknown[]; isError?: boolean } | undefined;

    return {
      success: true,
      sessionId,
      content: result?.content,
      isError: result?.isError,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
      rawJson: JSON.stringify({ type: 'error', error: errMsg }),
    });
    eventsStore.endSession(sessionId, 'error');

    return {
      success: false,
      sessionId,
      error: errMsg,
    };
  } finally {
    // Guarantee connection cleanup to prevent zombie processes
    connection.close();
  }
}

/**
 * Format tool input schema for display
 */
export function formatInputSchema(schema: ToolInputSchema | undefined): {
  required: Array<{ name: string; type?: string; description?: string }>;
  optional: Array<{ name: string; type?: string; description?: string; default?: unknown }>;
} {
  if (!schema || !schema.properties) {
    return { required: [], optional: [] };
  }

  const requiredKeys = new Set(schema.required || []);
  const required: Array<{ name: string; type?: string; description?: string }> = [];
  const optional: Array<{ name: string; type?: string; description?: string; default?: unknown }> = [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    const item = {
      name,
      type: prop.type,
      description: prop.description,
      default: prop.default,
    };

    if (requiredKeys.has(name)) {
      required.push(item);
    } else {
      optional.push(item);
    }
  }

  return { required, optional };
}
