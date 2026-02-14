/**
 * Tests for ConnectorQueueManager
 * Phase 8.3: MCP Proxy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectorQueueManager,
  QueueFullError,
  QueueTimeoutError,
  QueueResult,
} from '../queue.js';
import { GatewayLimits } from '../config.js';

describe('ConnectorQueueManager', () => {
  let manager: ConnectorQueueManager<string, string>;
  const defaultLimits: GatewayLimits = {
    timeout_ms: 1000,
    max_body_size: '1mb',
    max_inflight_per_connector: 1,
    max_queue_per_connector: 3,
    rate_limit_per_token: null,
  };

  beforeEach(() => {
    manager = new ConnectorQueueManager<string, string>(defaultLimits);
  });

  describe('serial execution', () => {
    it('should execute requests serially (one at a time)', async () => {
      const executionOrder: number[] = [];
      const results: Promise<QueueResult<string>>[] = [];

      // Queue 3 requests that complete in order
      for (let i = 0; i < 3; i++) {
        const idx = i;
        results.push(
          manager.enqueue('connector-1', `request-${idx}`, async (req) => {
            executionOrder.push(idx);
            await sleep(50);
            return `result-${idx}`;
          })
        );
      }

      await Promise.all(results);

      // Should execute in FIFO order
      expect(executionOrder).toEqual([0, 1, 2]);
    });

    it('should track queue wait time and upstream latency separately', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Queue 2 requests - first takes 100ms
      results.push(
        manager.enqueue('connector-1', 'req-1', async () => {
          await sleep(100);
          return 'res-1';
        })
      );

      results.push(
        manager.enqueue('connector-1', 'req-2', async () => {
          await sleep(50);
          return 'res-2';
        })
      );

      const [first, second] = await Promise.all(results);

      // First request: no queue wait (executed immediately), ~100ms upstream latency
      expect(first.queueWaitMs).toBeLessThan(20);
      expect(first.upstreamLatencyMs).toBeGreaterThanOrEqual(90);

      // Second request: waited ~100ms in queue (while first executed), ~50ms upstream latency
      expect(second.queueWaitMs).toBeGreaterThanOrEqual(90);
      expect(second.upstreamLatencyMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe('queue limits', () => {
    it('should reject when queue is full', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Fill queue (1 inflight + 3 queued = 4 total)
      for (let i = 0; i < 4; i++) {
        results.push(
          manager.enqueue('connector-1', `req-${i}`, async () => {
            await sleep(200);
            return `res-${i}`;
          })
        );
      }

      // Fifth request should be rejected
      await expect(
        manager.enqueue('connector-1', 'overflow', async () => 'overflow-res')
      ).rejects.toThrow(QueueFullError);

      // Clean up
      await Promise.all(results);
    });

    it('should manage separate queues per connector', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Fill connector-1 queue
      for (let i = 0; i < 4; i++) {
        results.push(
          manager.enqueue('connector-1', `req-${i}`, async () => {
            await sleep(50);
            return `res-${i}`;
          })
        );
      }

      // connector-2 should still accept requests
      const connector2Result = manager.enqueue(
        'connector-2',
        'req',
        async () => {
          await sleep(10);
          return 'connector-2-res';
        }
      );

      // Should not throw
      expect((await connector2Result).result).toBe('connector-2-res');

      // Clean up
      await Promise.all(results);
    });
  });

  describe('timeout handling', () => {
    it('should reject with timeout error when request exceeds timeout', async () => {
      const shortTimeoutLimits: GatewayLimits = {
        ...defaultLimits,
        timeout_ms: 100,
      };
      const timeoutManager = new ConnectorQueueManager<string, string>(
        shortTimeoutLimits
      );

      await expect(
        timeoutManager.enqueue('connector-1', 'slow-req', async () => {
          await sleep(500);
          return 'never-returned';
        })
      ).rejects.toThrow(QueueTimeoutError);
    });

    it('should timeout queued requests waiting too long', async () => {
      const shortTimeoutLimits: GatewayLimits = {
        ...defaultLimits,
        timeout_ms: 100,
      };
      const timeoutManager = new ConnectorQueueManager<string, string>(
        shortTimeoutLimits
      );

      // First request takes 200ms (will timeout)
      const firstPromise = timeoutManager.enqueue(
        'connector-1',
        'first',
        async () => {
          await sleep(200);
          return 'first-res';
        }
      );

      // Wait a bit for first to start executing
      await sleep(10);

      // Second request will timeout waiting in queue
      const secondPromise = timeoutManager.enqueue(
        'connector-1',
        'second',
        async () => {
          return 'second-res';
        }
      );

      // Both should timeout - catch them to avoid unhandled rejections
      const results = await Promise.allSettled([firstPromise, secondPromise]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');

      if (results[0].status === 'rejected') {
        expect(results[0].reason).toBeInstanceOf(QueueTimeoutError);
      }
      if (results[1].status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(QueueTimeoutError);
      }
    });
  });

  describe('abort signal', () => {
    it('should pass abort signal to execute function', async () => {
      let receivedSignal: AbortSignal | undefined;

      await manager.enqueue('connector-1', 'req', async (_, signal) => {
        receivedSignal = signal;
        return 'res';
      });

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(false);
    });
  });

  describe('stats', () => {
    it('should return queue stats for connector', async () => {
      // No stats for unknown connector
      expect(manager.getStats('unknown')).toBeNull();

      // Start a request
      const promise = manager.enqueue('connector-1', 'req', async () => {
        await sleep(100);
        return 'res';
      });

      // Give time for request to start
      await sleep(10);

      const stats = manager.getStats('connector-1');
      expect(stats).toEqual({
        queueLength: 0,
        inflight: 1,
      });

      await promise;

      // After completion
      const afterStats = manager.getStats('connector-1');
      expect(afterStats).toEqual({
        queueLength: 0,
        inflight: 0,
      });
    });
  });

  describe('shutdown', () => {
    it('should cancel all pending requests on shutdown', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Queue requests
      for (let i = 0; i < 3; i++) {
        results.push(
          manager.enqueue('connector-1', `req-${i}`, async () => {
            await sleep(1000);
            return `res-${i}`;
          })
        );
      }

      // Give time for first request to start
      await sleep(10);

      // Shutdown
      manager.shutdown();

      // Use Promise.allSettled to avoid unhandled rejections
      const settled = await Promise.allSettled(results);

      // All promises should be rejected
      for (const result of settled) {
        expect(result.status).toBe('rejected');
      }
    });

    it('should abort inflight requests on shutdown', async () => {
      let signalAborted = false;

      // Start a request that respects abort signal
      const promise = manager.enqueue('connector-1', 'req', async (_, signal) => {
        // Setup abort listener
        return new Promise<string>((resolve, reject) => {
          const abortHandler = () => {
            signalAborted = true;
            reject(new Error('Aborted'));
          };

          if (signal.aborted) {
            abortHandler();
            return;
          }

          signal.addEventListener('abort', abortHandler);

          // Simulate long-running work
          const timeout = setTimeout(() => {
            signal.removeEventListener('abort', abortHandler);
            resolve('result');
          }, 500);

          signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
        });
      });

      // Wait for request to start
      await sleep(10);

      // Shutdown should abort the inflight request
      manager.shutdown();

      // Wait for promise to settle
      const result = await Promise.allSettled([promise]);
      expect(result[0].status).toBe('rejected');

      // The signal should have been aborted
      expect(signalAborted).toBe(true);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
