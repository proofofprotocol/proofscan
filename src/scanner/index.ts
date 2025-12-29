/**
 * Scanner - orchestrates MCP server scanning
 * Connects, performs handshake, calls tools/list, logs events to SQLite
 */

import type { Connector, StdioTransport } from '../types/index.js';
import { StdioConnection, JsonRpcMessage, JsonRpcResponse } from '../transports/stdio.js';
import { EventsStore } from '../db/events-store.js';
import type { ExitReason, EventDirection, EventKind } from '../db/types.js';

export interface ScanResult {
  success: boolean;
  connectorId: string;
  sessionId: string;
  tools?: unknown[];
  error?: string;
  eventCount: number;
}

export interface ScanOptions {
  timeout?: number; // seconds
  dryRun?: boolean; // Phase 2.1: run without saving to DB
}

export class Scanner {
  private eventsStore: EventsStore;
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.eventsStore = new EventsStore(configDir);
  }

  async scan(connector: Connector, options: ScanOptions = {}): Promise<ScanResult> {
    const timeout = (options.timeout || 30) * 1000;
    const dryRun = options.dryRun || false;
    let eventCount = 0;

    // Helper functions for dry-run mode
    const saveEvent = dryRun
      ? () => { eventCount++; }
      : (sessionId: string, direction: EventDirection, kind: EventKind, opts: { rpcId?: string; rawJson?: string }) => {
          this.eventsStore.saveEvent(sessionId, direction, kind, opts);
          eventCount++;
        };

    if (connector.transport.type !== 'stdio') {
      if (!dryRun) {
        // Create a session even for unsupported transport to record the failure
        const session = this.eventsStore.createSession(connector.id);
        this.eventsStore.saveEvent(session.session_id, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({ type: 'error', message: `Unsupported transport type: ${connector.transport.type}` }),
        });
        this.eventsStore.endSession(session.session_id, 'error');

        return {
          success: false,
          connectorId: connector.id,
          sessionId: session.session_id,
          error: `Unsupported transport type: ${connector.transport.type}`,
          eventCount: 1,
        };
      }

      return {
        success: false,
        connectorId: connector.id,
        sessionId: 'dry-run',
        error: `Unsupported transport type: ${connector.transport.type}`,
        eventCount: 0,
      };
    }

    const transport = connector.transport as StdioTransport;
    const connection = new StdioConnection(transport);

    // Create new session (or use dummy for dry-run)
    const session = dryRun
      ? { session_id: `dry-run-${Date.now()}` }
      : this.eventsStore.createSession(connector.id);
    const sessionId = session.session_id;

    // Track RPC calls
    const rpcIdMap = new Map<string | number, string>(); // Maps JSON-RPC id to our rpc_id

    try {
      // Log connection attempt
      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({
            type: 'connect_attempt',
            command: transport.command,
            args: transport.args,
          }),
        });
      }
      eventCount++;

      // Set up message logging
      connection.on('message', (msg: JsonRpcMessage, raw: string) => {
        const isRequest = 'method' in msg && 'id' in msg && msg.id !== null;
        const isNotification = 'method' in msg && !('id' in msg);
        const isResponse = 'id' in msg && !('method' in msg);

        // Determine direction based on message type
        const direction: EventDirection = isResponse ? 'server_to_client' :
                          (isRequest || isNotification) && !('id' in msg && 'result' in msg) ? 'client_to_server' : 'server_to_client';

        let kind: EventKind;
        if (isRequest) kind = 'request';
        else if (isNotification) kind = 'notification';
        else if (isResponse) kind = 'response';
        else kind = 'transport_event';

        let rpcId: string | undefined;

        if (!dryRun) {
          // Handle RPC tracking
          if (isRequest && 'id' in msg && msg.id !== null && 'method' in msg) {
            // New request - create RPC call record
            const rpcCall = this.eventsStore.saveRpcCall(sessionId, String(msg.id), msg.method);
            rpcIdMap.set(msg.id, rpcCall.rpc_id);
            rpcId = rpcCall.rpc_id;
          } else if (isResponse && 'id' in msg && msg.id !== null) {
            // Response - complete RPC call
            rpcId = rpcIdMap.get(msg.id);
            if (rpcId) {
              const resp = msg as JsonRpcResponse;
              this.eventsStore.completeRpcCall(
                sessionId,
                String(msg.id),
                !resp.error,
                resp.error?.code
              );
            }
          }

          this.eventsStore.saveEvent(sessionId, direction, kind, {
            rpcId: rpcId || (('id' in msg && msg.id !== null) ? String(msg.id) : undefined),
            rawJson: raw,
          });
        }
        eventCount++;
      });

      connection.on('stderr', (data: string) => {
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
            rawJson: JSON.stringify({ type: 'stderr', data: data.trim() }),
          });
        }
        eventCount++;
      });

      connection.on('error', (error: Error) => {
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
            rawJson: JSON.stringify({ type: 'error', message: error.message }),
          });
        }
        eventCount++;
      });

      // Connect
      await connection.connect();

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
          rawJson: JSON.stringify({ type: 'connected' }),
        });
      }
      eventCount++;

      // MCP handshake: initialize
      let initializeResponse: JsonRpcResponse;
      try {
        initializeResponse = await connection.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'proofscan',
            version: '0.3.0',
          },
        }, timeout);

        // Send initialized notification
        connection.sendNotification('notifications/initialized', {});

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
            rawJson: JSON.stringify({ type: 'initialize_failed', error: errMsg }),
          });
          this.eventsStore.endSession(sessionId, 'error');
        }
        eventCount++;
        connection.close();

        return {
          success: false,
          connectorId: connector.id,
          sessionId,
          error: `Initialize failed: ${errMsg}`,
          eventCount,
        };
      }

      // Call tools/list
      let toolsListResponse: JsonRpcResponse;
      try {
        toolsListResponse = await connection.sendRequest('tools/list', {}, timeout);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
            rawJson: JSON.stringify({ type: 'tools_list_failed', error: errMsg }),
          });
          this.eventsStore.endSession(sessionId, 'error');
        }
        eventCount++;
        connection.close();

        return {
          success: false,
          connectorId: connector.id,
          sessionId,
          error: `tools/list failed: ${errMsg}`,
          eventCount,
        };
      }

      // Extract tools from response
      const tools = toolsListResponse.result && typeof toolsListResponse.result === 'object'
        ? (toolsListResponse.result as { tools?: unknown[] }).tools
        : undefined;

      // Close connection gracefully
      connection.close();

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({ type: 'disconnected' }),
        });
        this.eventsStore.endSession(sessionId, 'normal');
      }
      eventCount++;

      return {
        success: true,
        connectorId: connector.id,
        sessionId,
        tools: tools || [],
        eventCount,
      };

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({ type: 'scan_error', error: errMsg }),
        });
        this.eventsStore.endSession(sessionId, 'error');
      }
      eventCount++;
      connection.close();

      return {
        success: false,
        connectorId: connector.id,
        sessionId,
        error: errMsg,
        eventCount,
      };
    }
  }
}
