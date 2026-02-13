/**
 * Gateway server tests
 * Phase 8.1: HTTP server foundation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGatewayServer, GatewayServer } from '../server.js';
import { generateRequestId, getRequestTimestamp } from '../requestId.js';
import { createLogger, Logger, LogEntry } from '../logger.js';

describe('Gateway Server', () => {
  let server: GatewayServer;
  let logs: LogEntry[];
  let logger: Logger;

  beforeEach(() => {
    logs = [];
    logger = createLogger((line) => {
      logs.push(JSON.parse(line) as LogEntry);
    });
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      server = createGatewayServer({ port: 0, host: '127.0.0.1' }, logger);
      const address = await server.start();

      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      await server.stop();

      // Check logs
      const startLog = logs.find((l) => l.event === 'server_started');
      const stopLog = logs.find((l) => l.event === 'server_stopped');

      expect(startLog).toBeDefined();
      expect(stopLog).toBeDefined();
    });

    it('should use custom port and host', async () => {
      server = createGatewayServer({ port: 0, host: '127.0.0.1' }, logger);
      const address = await server.start();

      expect(address).toContain('127.0.0.1');
    });
  });

  describe('/health endpoint', () => {
    it('should return status ok', async () => {
      server = createGatewayServer({ port: 0, host: '127.0.0.1' }, logger);
      const address = await server.start();

      const response = await fetch(`${address}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should log request with request_id', async () => {
      server = createGatewayServer({ port: 0, host: '127.0.0.1' }, logger);
      const address = await server.start();

      await fetch(`${address}/health`);

      // Wait for log to be written
      await new Promise((r) => setTimeout(r, 50));

      const requestLog = logs.find(
        (l) => l.event === 'http_request' && l.url === '/health'
      );

      expect(requestLog).toBeDefined();
      expect(requestLog?.request_id).toBeDefined();
      expect(requestLog?.request_id?.length).toBe(26); // ULID length
      expect(requestLog?.status).toBe(200);
      expect(requestLog?.method).toBe('GET');
    });
  });
});

describe('Request ID', () => {
  it('should generate valid ULID', () => {
    const id = generateRequestId();

    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }

    expect(ids.size).toBe(1000);
  });

  it('should extract timestamp from request ID', () => {
    const before = Date.now();
    const id = generateRequestId();
    const after = Date.now();

    const timestamp = getRequestTimestamp(id);

    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp!.getTime()).toBeGreaterThanOrEqual(before);
    expect(timestamp!.getTime()).toBeLessThanOrEqual(after);
  });

  it('should return null for invalid request ID', () => {
    expect(getRequestTimestamp('invalid')).toBeNull();
    expect(getRequestTimestamp('')).toBeNull();
    expect(getRequestTimestamp('!!invalid!!')).toBeNull();
  });
});

describe('Logger', () => {
  it('should output JSON logs', () => {
    const logs: string[] = [];
    const logger = createLogger((line) => logs.push(line));

    logger.info({ event: 'test_event', request_id: 'abc123' });

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('test_event');
    expect(parsed.request_id).toBe('abc123');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should respect minimum log level', () => {
    const logs: string[] = [];
    const logger = createLogger((line) => logs.push(line), 'warn');

    logger.debug({ event: 'debug_event' });
    logger.info({ event: 'info_event' });
    logger.warn({ event: 'warn_event' });
    logger.error({ event: 'error_event' });

    expect(logs.length).toBe(2);

    const events = logs.map((l) => JSON.parse(l).event);
    expect(events).toEqual(['warn_event', 'error_event']);
  });

  it('should include all fields in log entry', () => {
    const logs: string[] = [];
    const logger = createLogger((line) => logs.push(line));

    logger.info({
      event: 'mcp_request',
      request_id: '01JKXYZ',
      trace_id: 'abc123',
      client_id: 'client-001',
      target_id: 'yfinance',
      method: 'tools/call',
      decision: 'allow',
      latency_ms: 120,
      queue_wait_ms: 15,
      upstream_latency_ms: 105,
      status: 200,
    });

    const parsed = JSON.parse(logs[0]);
    expect(parsed.request_id).toBe('01JKXYZ');
    expect(parsed.trace_id).toBe('abc123');
    expect(parsed.client_id).toBe('client-001');
    expect(parsed.target_id).toBe('yfinance');
    expect(parsed.method).toBe('tools/call');
    expect(parsed.decision).toBe('allow');
    expect(parsed.latency_ms).toBe(120);
    expect(parsed.queue_wait_ms).toBe(15);
    expect(parsed.upstream_latency_ms).toBe(105);
    expect(parsed.status).toBe(200);
  });
});
