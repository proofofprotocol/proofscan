/**
 * IPC Client for Proxy Control
 *
 * Connects to the proxy server via Unix Domain Socket (Unix) or Named Pipe (Windows)
 * to send control commands.
 */

import * as net from 'net';
import type {
  IpcCommand,
  IpcResponse,
  IpcMessage,
  ReloadResult,
} from './ipc-types.js';
import { IPC_TIMEOUT_MS, generateRequestId, getSocketPath } from './ipc-types.js';
import type { ProxyRuntimeState } from './runtime-state.js';

/**
 * Result type for IPC operations
 */
export interface IpcResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * IPC Client for sending commands to the proxy server
 */
export class IpcClient {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /**
   * Send a reload command to the proxy
   */
  async reload(): Promise<IpcResult<ReloadResult>> {
    const response = await this.sendCommand({ type: 'reload' });

    if (response.type === 'ok') {
      return {
        success: true,
        data: response.data as ReloadResult | undefined,
      };
    }

    return {
      success: false,
      error: response.type === 'error' ? response.error : 'Unexpected response',
    };
  }

  /**
   * Send a stop command to the proxy
   */
  async stop(): Promise<IpcResult> {
    try {
      const response = await this.sendCommand({ type: 'stop' });

      if (response.type === 'ok') {
        return { success: true };
      }

      return {
        success: false,
        error: response.type === 'error' ? response.error : 'Unexpected response',
      };
    } catch (err) {
      // Stop command may cause connection to close before response
      // This is expected behavior
      if (err instanceof Error && err.message.includes('closed')) {
        return { success: true };
      }
      throw err;
    }
  }

  /**
   * Get the current proxy status
   */
  async status(): Promise<IpcResult<ProxyRuntimeState>> {
    try {
      const response = await this.sendCommand({ type: 'status' });

      if (response.type === 'status') {
        return {
          success: true,
          data: response.data,
        };
      }

      return {
        success: false,
        error: response.type === 'error' ? response.error : 'Unexpected response',
      };
    } catch (err) {
      // Connection errors mean proxy is not running
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /**
   * Check if the proxy is running by attempting to connect
   */
  async isRunning(): Promise<boolean> {
    try {
      const result = await this.status();
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Send a command to the proxy and wait for response
   */
  private async sendCommand(command: IpcCommand): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const requestId = generateRequestId();
      let responseReceived = false;
      let buffer = '';

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          socket.destroy();
          reject(new Error('IPC request timed out'));
        }
      }, IPC_TIMEOUT_MS);

      socket.on('connect', () => {
        // Send the command
        const message: IpcMessage = {
          id: requestId,
          kind: 'request',
          command,
        };
        socket.write(JSON.stringify(message) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        // Try to parse complete messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message: IpcMessage = JSON.parse(line);

            if (message.kind === 'response' && message.id === requestId) {
              responseReceived = true;
              clearTimeout(timeout);
              socket.end();

              if (message.response) {
                resolve(message.response);
              } else {
                reject(new Error('Empty response'));
              }
              return;
            }
          } catch (err) {
            // Ignore parse errors, wait for more data
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!responseReceived) {
          reject(new Error(`Connection error: ${err.message}`));
        }
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        if (!responseReceived) {
          reject(new Error('Connection closed before response'));
        }
      });
    });
  }
}

/**
 * Create an IPC client for the given config directory
 */
export function createIpcClient(configDir: string): IpcClient {
  return new IpcClient(getSocketPath(configDir));
}
