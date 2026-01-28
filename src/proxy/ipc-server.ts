/**
 * IPC Server for Proxy Control
 *
 * Listens on Unix Domain Socket (Unix) or Named Pipe (Windows)
 * for control commands from psh shell.
 */

import * as net from 'net';
import { unlinkSync, existsSync } from 'fs';
import type {
  IpcCommand,
  IpcResponse,
  IpcMessage,
  IpcHandlers,
  ReloadResult,
} from './ipc-types.js';
import { generateRequestId } from './ipc-types.js';

/**
 * IPC Server that listens for control commands
 */
export class IpcServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private handlers: IpcHandlers;
  private connections: Set<net.Socket> = new Set();

  constructor(socketPath: string, handlers: IpcHandlers) {
    this.socketPath = socketPath;
    this.handlers = handlers;
  }

  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    // Clean up stale socket file (Unix only)
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore if file doesn't exist or can't be deleted
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server and close all connections
   */
  stop(): void {
    // Close all active connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    // Close the server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file (Unix only)
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Handle a new client connection
   */
  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Try to parse complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const message: IpcMessage = JSON.parse(line);
          await this.handleMessage(socket, message);
        } catch (err) {
          // Send error response for malformed messages
          this.sendResponse(socket, {
            id: 'unknown',
            kind: 'response',
            response: {
              type: 'error',
              error: `Invalid message format: ${err instanceof Error ? err.message : 'unknown error'}`,
            },
          });
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  /**
   * Handle a parsed IPC message
   */
  private async handleMessage(socket: net.Socket, message: IpcMessage): Promise<void> {
    if (message.kind !== 'request' || !message.command) {
      this.sendResponse(socket, {
        id: message.id,
        kind: 'response',
        response: {
          type: 'error',
          error: 'Expected a request message with command',
        },
      });
      return;
    }

    const { command } = message;
    let response: IpcResponse;

    try {
      switch (command.type) {
        case 'reload': {
          const reloadResult = await this.handlers.onReload();
          response = {
            type: 'ok',
            message: reloadResult.success
              ? `Reloaded ${reloadResult.reloadedConnectors.length} connector(s)`
              : 'Reload completed with errors',
            data: reloadResult,
          };
          break;
        }

        case 'stop':
          // Send response before stopping
          this.sendResponse(socket, {
            id: message.id,
            kind: 'response',
            response: { type: 'ok', message: 'Stopping proxy...' },
          });
          // Give time for response to be sent
          setTimeout(() => {
            this.handlers.onStop();
          }, 100);
          return;

        case 'status': {
          const state = this.handlers.onStatus();
          response = {
            type: 'status',
            data: state,
          };
          break;
        }

        default:
          response = {
            type: 'error',
            error: `Unknown command type: ${(command as { type: string }).type}`,
          };
      }
    } catch (err) {
      response = {
        type: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    this.sendResponse(socket, {
      id: message.id,
      kind: 'response',
      response,
    });
  }

  /**
   * Send a response message to a socket
   */
  private sendResponse(socket: net.Socket, message: IpcMessage): void {
    try {
      socket.write(JSON.stringify(message) + '\n');
    } catch {
      // Ignore write errors (connection may be closed)
    }
  }
}
