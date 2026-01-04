/**
 * Runtime State Manager (Phase 5.0+)
 *
 * Manages persistent runtime state for IPC between proxy and CLI.
 * State is written to a JSON file in configDir.
 */

import { writeFile, readFile, mkdir, rename, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

/** Client connection state */
export type ClientState = 'active' | 'idle' | 'gone';

/** Individual client tracking info */
export interface ClientInfo {
  /** Client name from initialize params */
  name: string;
  /** Protocol version */
  protocolVersion: string;
  /** Current state */
  state: ClientState;
  /** When client was first seen (ISO timestamp) */
  connectedAt: string;
  /** When client was last active (ISO timestamp) */
  lastSeen: string;
  /** Number of sessions (reinitializations) */
  sessions: number;
  /** Total tool calls made */
  toolCalls: number;
}

/** Connector summary for status display */
export interface ConnectorSummary {
  /** Connector ID */
  id: string;
  /** Number of tools published */
  toolCount: number;
  /** Whether tools were successfully loaded */
  healthy: boolean;
  /** Error message if unhealthy */
  error?: string;
}

/** Proxy runtime state persisted to JSON file */
export interface ProxyRuntimeState {
  /** Schema version for forward compatibility */
  version: 1;

  /** Proxy state */
  proxy: {
    /** Current state */
    state: 'RUNNING' | 'STOPPED';
    /** Communication mode */
    mode: 'stdio';
    /** When proxy started (ISO timestamp) */
    startedAt: string;
    /** Process ID for staleness detection */
    pid: number;
    /** Last heartbeat (ISO timestamp) */
    heartbeat: string;
  };

  /** Published connectors */
  connectors: ConnectorSummary[];

  /** Connected clients (for stdio mode, typically 1) */
  clients: Record<string, ClientInfo>;

  /** Logging configuration */
  logging: {
    /** Current log level */
    level: 'INFO' | 'WARN' | 'ERROR';
    /** Number of lines in ring buffer */
    bufferedLines: number;
    /** Max lines before rotation */
    maxLines: number;
  };
}

/** Default state when proxy is not running */
export const DEFAULT_RUNTIME_STATE: ProxyRuntimeState = {
  version: 1,
  proxy: {
    state: 'STOPPED',
    mode: 'stdio',
    startedAt: '',
    pid: 0,
    heartbeat: '',
  },
  connectors: [],
  clients: {},
  logging: {
    level: 'WARN',
    bufferedLines: 0,
    maxLines: 1000,
  },
};

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 5000;

/** Heartbeat staleness threshold in milliseconds */
const HEARTBEAT_STALE_THRESHOLD_MS = 30000;

/** Idle threshold for client state determination */
const IDLE_THRESHOLD_MS = 30000;

/**
 * Manages proxy runtime state with file-based persistence.
 *
 * Used by the proxy process to track state and by CLI commands to read it.
 */
export class RuntimeStateManager {
  private readonly statePath: string;
  private state: ProxyRuntimeState;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(configDir: string) {
    this.statePath = join(configDir, 'proxy-runtime-state.json');
    this.state = { ...DEFAULT_RUNTIME_STATE };
  }

  /**
   * Initialize state when proxy starts
   */
  async initialize(
    connectors: ConnectorSummary[],
    logLevel: 'INFO' | 'WARN' | 'ERROR'
  ): Promise<void> {
    const now = new Date().toISOString();

    this.state = {
      version: 1,
      proxy: {
        state: 'RUNNING',
        mode: 'stdio',
        startedAt: now,
        pid: process.pid,
        heartbeat: now,
      },
      connectors,
      clients: {},
      logging: {
        level: logLevel,
        bufferedLines: 0,
        maxLines: 1000,
      },
    };

    await this.persist();
  }

  /**
   * Start heartbeat updates
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(async () => {
      this.state.proxy.heartbeat = new Date().toISOString();
      await this.persist().catch(() => {
        // Silently ignore heartbeat write errors
      });
    }, HEARTBEAT_INTERVAL_MS);

    // Don't prevent process exit
    this.heartbeatTimer.unref();
  }

  /**
   * Stop heartbeat on shutdown
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Update client state (called on each RPC)
   */
  async updateClient(
    clientName: string,
    update: Partial<ClientInfo>
  ): Promise<void> {
    const existing = this.state.clients[clientName];
    const now = new Date().toISOString();

    if (existing) {
      // Update existing client
      this.state.clients[clientName] = {
        ...existing,
        ...update,
        lastSeen: now,
      };

      // Increment sessions on re-initialize (when state becomes 'active' but
      // sessions field is not explicitly provided in update, indicating this
      // is a new initialize call rather than a regular activity update)
      if (update.state === 'active' && !('sessions' in update)) {
        this.state.clients[clientName].sessions += 1;
      }
    } else {
      // New client
      this.state.clients[clientName] = {
        name: clientName,
        protocolVersion: update.protocolVersion || 'unknown',
        state: update.state || 'active',
        connectedAt: now,
        lastSeen: now,
        sessions: 1,
        toolCalls: 0,
        ...update,
      };
    }

    await this.persist();
  }

  /**
   * Record tool call
   */
  async recordToolCall(clientName: string): Promise<void> {
    const client = this.state.clients[clientName];
    if (client) {
      client.toolCalls += 1;
      client.lastSeen = new Date().toISOString();
      client.state = 'active';
      await this.persist();
    }
  }

  /**
   * Mark proxy as stopped
   */
  async markStopped(): Promise<void> {
    this.state.proxy.state = 'STOPPED';

    // Mark all clients as gone
    for (const clientName of Object.keys(this.state.clients)) {
      this.state.clients[clientName].state = 'gone';
    }

    await this.persist();
  }

  /**
   * Update log buffer count
   */
  async updateLogCount(count: number): Promise<void> {
    this.state.logging.bufferedLines = count;
    // Don't persist on every log - let heartbeat handle it
  }

  /**
   * Get current state (for internal use)
   */
  getState(): ProxyRuntimeState {
    return this.state;
  }

  /**
   * Persist state to file (atomic write using rename)
   */
  private async persist(): Promise<void> {
    const json = JSON.stringify(this.state, null, 2);
    const tempPath = this.statePath + '.tmp';

    // Ensure directory exists
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename (atomic on POSIX)
    await writeFile(tempPath, json, 'utf-8');
    await rename(tempPath, this.statePath);
  }

  /**
   * Read current state (for CLI)
   *
   * Static method that can be called without a proxy running.
   */
  static async read(configDir: string): Promise<ProxyRuntimeState | null> {
    const statePath = join(configDir, 'proxy-runtime-state.json');

    try {
      const content = await readFile(statePath, 'utf-8');
      const state = JSON.parse(content) as ProxyRuntimeState;

      // Validate version
      if (state.version !== 1) {
        return null;
      }

      return state;
    } catch {
      return null;
    }
  }

  /**
   * Check if proxy is likely still running (heartbeat within threshold + PID check)
   */
  static isProxyAlive(state: ProxyRuntimeState): boolean {
    if (state.proxy.state !== 'RUNNING') {
      return false;
    }

    if (!state.proxy.heartbeat) {
      return false;
    }

    // Check if PID is still running (process.kill with signal 0 checks existence)
    if (state.proxy.pid > 0) {
      try {
        process.kill(state.proxy.pid, 0);
      } catch {
        // Process doesn't exist - proxy is dead
        return false;
      }
    }

    const heartbeatTime = new Date(state.proxy.heartbeat).getTime();
    const now = Date.now();
    const elapsed = now - heartbeatTime;

    return elapsed < HEARTBEAT_STALE_THRESHOLD_MS;
  }

  /**
   * Determine effective client state based on lastSeen timestamp
   */
  static determineClientState(
    client: ClientInfo,
    idleThresholdMs: number = IDLE_THRESHOLD_MS
  ): ClientState {
    // If explicitly marked as gone, keep it
    if (client.state === 'gone') {
      return 'gone';
    }

    const lastSeenTime = new Date(client.lastSeen).getTime();
    const now = Date.now();
    const elapsed = now - lastSeenTime;

    return elapsed < idleThresholdMs ? 'active' : 'idle';
  }
}
