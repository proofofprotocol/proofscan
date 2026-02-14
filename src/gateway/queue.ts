/**
 * Connector queue management for serial execution model
 * Phase 8.3: MCP Proxy
 *
 * Design:
 * - Complete serial model (max_inflight_per_connector = 1)
 * - Queue per connector to prevent starvation
 * - Timeout handling with 504 Gateway Timeout
 * - FIFO order guarantee
 */

import { GatewayLimits } from './config.js';

/**
 * Queue result with timing metrics
 */
export interface QueueResult<R> {
  /** The result from the execute function */
  result: R;
  /** Pure queue wait time (ms) - time spent waiting in queue before execution started */
  queueWaitMs: number;
  /** Upstream latency (ms) - time spent executing the request */
  upstreamLatencyMs: number;
}

/**
 * Queued request item
 */
interface QueuedRequest<T, R> {
  /** Request data */
  request: T;
  /** Execute function to run when dequeued */
  execute: (request: T, signal: AbortSignal) => Promise<R>;
  /** Resolve promise */
  resolve: (result: R, queueWaitMs: number, upstreamLatencyMs: number) => void;
  /** Reject promise */
  reject: (error: Error) => void;
  /** Abort controller for timeout/cancellation */
  abortController: AbortController;
  /** Timeout handle */
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Queue entry time for latency tracking */
  queuedAt: number;
  /** Flag to prevent race condition with timeout handler */
  dequeued: boolean;
}

/**
 * Queue error types
 */
export class QueueFullError extends Error {
  constructor(connector: string) {
    super(`Queue full for connector: ${connector}`);
    this.name = 'QueueFullError';
  }
}

export class QueueTimeoutError extends Error {
  constructor() {
    super('Request timeout');
    this.name = 'QueueTimeoutError';
  }
}

/**
 * Single connector queue
 */
class SingleConnectorQueue<T, R> {
  private queue: QueuedRequest<T, R>[] = [];
  private inflight = 0;
  private maxInflight: number;
  private maxQueue: number;
  private timeoutMs: number;
  /** Track inflight request abort controllers for shutdown */
  private inflightAbortControllers: Set<AbortController> = new Set();

  constructor(
    private connectorId: string,
    limits: GatewayLimits
  ) {
    this.maxInflight = limits.max_inflight_per_connector;
    this.maxQueue = limits.max_queue_per_connector;
    this.timeoutMs = limits.timeout_ms;
  }

  /**
   * Get current queue length
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Get current inflight count
   */
  get inflightCount(): number {
    return this.inflight;
  }

  /**
   * Enqueue a request and wait for execution
   */
  async enqueue(
    request: T,
    execute: (request: T, signal: AbortSignal) => Promise<R>
  ): Promise<QueueResult<R>> {
    // Check queue capacity
    if (this.queue.length >= this.maxQueue) {
      throw new QueueFullError(this.connectorId);
    }

    const queuedAt = Date.now();
    const abortController = new AbortController();

    return new Promise<QueueResult<R>>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
        // Remove from queue if still pending (check dequeued flag to avoid race)
        const idx = this.queue.findIndex(
          (q) => q.abortController === abortController && !q.dequeued
        );
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new QueueTimeoutError());
      }, this.timeoutMs);

      const item: QueuedRequest<T, R> = {
        request,
        execute,
        resolve: (result: R, queueWaitMs: number, upstreamLatencyMs: number) => {
          clearTimeout(timeoutHandle);
          resolve({ result, queueWaitMs, upstreamLatencyMs });
        },
        reject: (error: Error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
        abortController,
        timeoutHandle,
        queuedAt,
        dequeued: false,
      };

      // Check if we can execute immediately
      if (this.inflight < this.maxInflight) {
        item.dequeued = true;
        this.executeItem(item);
      } else {
        this.queue.push(item);
      }
    });
  }

  /**
   * Execute a queued item
   */
  private async executeItem(item: QueuedRequest<T, R>): Promise<void> {
    this.inflight++;
    this.inflightAbortControllers.add(item.abortController);

    const executionStartedAt = Date.now();
    const queueWaitMs = executionStartedAt - item.queuedAt;

    try {
      const result = await item.execute(item.request, item.abortController.signal);
      const upstreamLatencyMs = Date.now() - executionStartedAt;
      item.resolve(result, queueWaitMs, upstreamLatencyMs);
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.inflightAbortControllers.delete(item.abortController);
      this.inflight--;
      this.processNext();
    }
  }

  /**
   * Process next item in queue
   */
  private processNext(): void {
    if (this.queue.length > 0 && this.inflight < this.maxInflight) {
      const next = this.queue.shift();
      if (next && !next.dequeued) {
        next.dequeued = true;
        this.executeItem(next);
      }
    }
  }

  /**
   * Cancel all pending and inflight requests (for shutdown)
   */
  cancelAll(): void {
    // Cancel queued requests
    for (const item of this.queue) {
      clearTimeout(item.timeoutHandle);
      item.abortController.abort();
      item.reject(new Error('Queue shutdown'));
    }
    this.queue = [];

    // Cancel inflight requests
    for (const abortController of this.inflightAbortControllers) {
      abortController.abort();
    }
    this.inflightAbortControllers.clear();
  }
}

/**
 * Connector queue manager
 * Manages per-connector queues for serial execution model
 */
export class ConnectorQueueManager<T, R> {
  private queues = new Map<string, SingleConnectorQueue<T, R>>();
  private limits: GatewayLimits;

  constructor(limits: GatewayLimits) {
    this.limits = limits;
  }

  /**
   * Enqueue a request for a specific connector
   * @param connector Connector ID
   * @param request Request data
   * @param execute Function to execute the request
   * @returns Result with timing metrics (queueWaitMs, upstreamLatencyMs)
   */
  async enqueue(
    connector: string,
    request: T,
    execute: (request: T, signal: AbortSignal) => Promise<R>
  ): Promise<QueueResult<R>> {
    let queue = this.queues.get(connector);
    if (!queue) {
      queue = new SingleConnectorQueue<T, R>(connector, this.limits);
      this.queues.set(connector, queue);
    }

    return queue.enqueue(request, execute);
  }

  /**
   * Get queue stats for a connector
   */
  getStats(connector: string): { queueLength: number; inflight: number } | null {
    const queue = this.queues.get(connector);
    if (!queue) {
      return null;
    }
    return {
      queueLength: queue.queueLength,
      inflight: queue.inflightCount,
    };
  }

  /**
   * Shutdown all queues
   */
  shutdown(): void {
    for (const queue of this.queues.values()) {
      queue.cancelAll();
    }
    this.queues.clear();
  }
}
