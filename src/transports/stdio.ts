/**
 * Stdio transport for MCP servers
 * Spawns child process and communicates via stdin/stdout JSON-RPC
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { StdioTransport } from '../types/index.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

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

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface StdioConnectionEvents {
  message: (msg: JsonRpcMessage, raw: string) => void;
  error: (error: Error) => void;
  close: (code: number | null, signal: string | null) => void;
  stderr: (data: string) => void;
}

export class StdioConnection extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private transport: StdioTransport;
  private requestId: number = 1;
  private pendingRequests: Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(transport: StdioTransport) {
    super();
    this.transport = transport;
  }

  async connect(): Promise<void> {
    const { command, args = [], env, cwd } = this.transport;

    this.process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      cwd,
      shell: false,
    });

    this.process.stdout?.setEncoding('utf8');
    this.process.stderr?.setEncoding('utf8');

    this.process.stdout?.on('data', (data: string) => {
      this.handleData(data);
    });

    this.process.stderr?.on('data', (data: string) => {
      this.emit('stderr', data);
    });

    this.process.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.process.on('close', (code, signal) => {
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Process exited with code ${code}`));
      }
      this.pendingRequests.clear();
      this.emit('close', code, signal);
    });

    // Wait a brief moment for process to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 100);

      this.process?.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // Check if process exited immediately
      if (this.process && this.process.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`Process exited immediately with code ${this.process.exitCode}`));
      }
    });
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines (JSON-RPC messages are newline-delimited)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        this.processLine(line);
      }
    }
  }

  private processLine(line: string): void {
    try {
      const msg = JSON.parse(line) as JsonRpcMessage;
      this.emit('message', msg, line);

      // Handle responses to pending requests
      if ('id' in msg && msg.id !== null && !('method' in msg)) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg as JsonRpcResponse);
        }
      }
    } catch {
      this.emit('error', new Error(`Failed to parse JSON-RPC message: ${line}`));
    }
  }

  async sendRequest(method: string, params?: unknown, timeoutMs: number = 30000): Promise<JsonRpcResponse> {
    if (!this.process || this.process.killed) {
      throw new Error('Connection not open');
    }

    const id = this.requestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    const raw = JSON.stringify(request) + '\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for method: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.process!.stdin?.write(raw, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });

      // Emit event for the sent request
      this.emit('message', request, raw.trim());
    });
  }

  sendNotification(method: string, params?: unknown): void {
    if (!this.process || this.process.killed) {
      throw new Error('Connection not open');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined && { params }),
    };

    const raw = JSON.stringify(notification) + '\n';
    this.process.stdin?.write(raw);
    this.emit('message', notification, raw.trim());
  }

  close(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }

  isConnected(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
