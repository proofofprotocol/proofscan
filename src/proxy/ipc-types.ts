/**
 * IPC Types for Proxy Control
 *
 * Defines message types for communication between psh shell and proxy server.
 * Uses Unix Domain Socket on Unix systems and Named Pipe on Windows.
 */

import { join } from 'path';
import type { ProxyRuntimeState } from './runtime-state.js';

/**
 * IPC commands that can be sent to the proxy server
 */
export type IpcCommand =
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'status' };

/**
 * Reload result details
 */
export interface ReloadResult {
  success: boolean;
  reloadedConnectors: string[];
  failedConnectors: string[];
  message?: string;
}

/**
 * IPC responses from the proxy server
 */
export type IpcResponse =
  | { type: 'ok'; message?: string; data?: ReloadResult }
  | { type: 'error'; error: string }
  | { type: 'status'; data: ProxyRuntimeState };

/**
 * IPC message envelope (used for both request and response)
 */
export interface IpcMessage {
  /** Unique request ID for correlation */
  id: string;
  /** Message type */
  kind: 'request' | 'response';
  /** Command (for requests) */
  command?: IpcCommand;
  /** Response (for responses) */
  response?: IpcResponse;
}

/**
 * IPC server handler interface
 */
export interface IpcHandlers {
  onReload: () => Promise<ReloadResult>;
  onStop: () => void;
  onStatus: () => ProxyRuntimeState;
}

/**
 * Default IPC timeout in milliseconds
 */
export const IPC_TIMEOUT_MS = 5000;

/**
 * Get the IPC socket path for the given config directory
 *
 * @param configDir - The config directory (e.g., ~/.proofscan)
 * @returns Socket path (Unix) or pipe name (Windows)
 */
export function getSocketPath(configDir: string): string {
  if (process.platform === 'win32') {
    // Windows: Use Named Pipe
    // Named pipes are in the \\.\pipe\ namespace
    return '\\\\.\\pipe\\proofscan-proxy';
  }

  // Unix: Use Unix Domain Socket in config directory
  return join(configDir, 'proxy.sock');
}

/**
 * Check if the current platform supports Unix Domain Sockets
 */
export function supportsUnixSocket(): boolean {
  return process.platform !== 'win32';
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
