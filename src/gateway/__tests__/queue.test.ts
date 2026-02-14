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

  describe('multiple connectors with different queue states', () => {
    it('should handle multiple connectors with varying queue lengths and states', async () => {
      const results: Promise<QueueResult<string>>[] = [];
      const executionLog: { connector: string; request: string; timestamp: number }[] = [];
      const startTime = Date.now();

      // Connector 1: Fill queue with slow requests
      for (let i = 0; i < 3; i++) {
        results.push(
          manager.enqueue('connector-1', `c1-req-${i}`, async (req) => {
            executionLog.push({ connector: 'connector-1', request: req, timestamp: Date.now() - startTime });
            await sleep(50);
            return `c1-res-${i}`;
          })
        );
      }

      // Connector 2: Add a few requests
      for (let i = 0; i < 2; i++) {
        results.push(
          manager.enqueue('connector-2', `c2-req-${i}`, async (req) => {
            executionLog.push({ connector: 'connector-2', request: req, timestamp: Date.now() - startTime });
            await sleep(30);
            return `c2-res-${i}`;
          })
        );
      }

      // Connector 3: Single fast request
      results.push(
        manager.enqueue('connector-3', 'c3-req-0', async (req) => {
          executionLog.push({ connector: 'connector-3', request: req, timestamp: Date.now() - startTime });
          await sleep(10);
          return 'c3-res-0';
        })
      );

      // Wait for all to complete
      await Promise.all(results);

      // Verify each connector executed independently
      const c1Executions = executionLog.filter((e) => e.connector === 'connector-1');
      const c2Executions = executionLog.filter((e) => e.connector === 'connector-2');
      const c3Executions = executionLog.filter((e) => e.connector === 'connector-3');

      expect(c1Executions).toHaveLength(3);
      expect(c2Executions).toHaveLength(2);
      expect(c3Executions).toHaveLength(1);

      // Verify serial execution within each connector (FIFO order)
      expect(c1Executions[0].request).toBe('c1-req-0');
      expect(c1Executions[1].request).toBe('c1-req-1');
      expect(c1Executions[2].request).toBe('c1-req-2');

      expect(c2Executions[0].request).toBe('c2-req-0');
      expect(c2Executions[1].request).toBe('c2-req-1');

      // Verify connector-3's single request completed (fast track)
      expect(c3Executions[0].request).toBe('c3-req-0');
    });

    it('should allow one connector queue to be full while others accept requests', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Fill connector-1 to capacity (1 inflight + 3 queued = 4 total)
      for (let i = 0; i < 4; i++) {
        results.push(
          manager.enqueue('connector-1', `c1-req-${i}`, async () => {
            await sleep(100);
            return `c1-res-${i}`;
          })
        );
      }

      // connector-1 should now be full
      await expect(
        manager.enqueue('connector-1', 'c1-overflow', async () => 'overflow')
      ).rejects.toThrow(QueueFullError);

      // But connector-2 should still accept requests
      const c2Promise = manager.enqueue('connector-2', 'c2-req', async () => {
        await sleep(10);
        return 'c2-res';
      });

      // And connector-3 too
      const c3Promise = manager.enqueue('connector-3', 'c3-req', async () => {
        await sleep(10);
        return 'c3-res';
      });

      // connector-2 and connector-3 should complete quickly
      const [c2Result, c3Result] = await Promise.all([c2Promise, c3Promise]);
      expect(c2Result.result).toBe('c2-res');
      expect(c3Result.result).toBe('c3-res');

      // Clean up connector-1 requests
      await Promise.all(results);
    });

    it('should track stats independently per connector', async () => {
      const results: Promise<QueueResult<string>>[] = [];

      // Start requests on multiple connectors
      results.push(
        manager.enqueue('connector-a', 'req-a', async () => {
          await sleep(100);
          return 'res-a';
        })
      );
      results.push(
        manager.enqueue('connector-a', 'req-a2', async () => {
          await sleep(50);
          return 'res-a2';
        })
      );
      results.push(
        manager.enqueue('connector-b', 'req-b', async () => {
          await sleep(80);
          return 'res-b';
        })
      );

      // Wait for requests to start
      await sleep(10);

      // Check stats
      const statsA = manager.getStats('connector-a');
      const statsB = manager.getStats('connector-b');
      const statsC = manager.getStats('connector-c');

      expect(statsA).toEqual({ queueLength: 1, inflight: 1 }); // 1 running, 1 queued
      expect(statsB).toEqual({ queueLength: 0, inflight: 1 }); // 1 running
      expect(statsC).toBeNull(); // Never used

      // Clean up
      await Promise.all(results);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
