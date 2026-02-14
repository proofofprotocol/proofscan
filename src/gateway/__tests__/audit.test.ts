/**
 * Audit logging tests
 * Phase 8.5: Audit logging with EventLineDB integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditLogger, createAuditLogger } from '../audit.js';
import { EventsStore } from '../../db/events-store.js';
import { getEventsDb, closeAllDbs } from '../../db/connection.js';

describe('AuditLogger', () => {
  let tempDir: string;
  let auditLogger: AuditLogger;
  let eventsStore: EventsStore;

  beforeEach(() => {
    // Create temp directory for test databases
    tempDir = mkdtempSync(join(tmpdir(), 'pfscan-audit-test-'));
    
    // Initialize database (creates gateway_events table via migration)
    getEventsDb(tempDir);
    
    // Create audit logger and events store
    auditLogger = createAuditLogger(tempDir);
    eventsStore = new EventsStore(tempDir);
  });

  afterEach(() => {
    closeAllDbs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('logAuthSuccess', () => {
    it('should log authentication success events', () => {
      const eventId = auditLogger.logAuthSuccess({
        requestId: 'req-123',
        clientId: 'test-client',
        traceId: 'trace-abc',
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-123');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_auth_success');
      expect(events[0].client_id).toBe('test-client');
      expect(events[0].trace_id).toBe('trace-abc');
      expect(events[0].decision).toBe('allow');
    });

    it('should handle missing trace_id', () => {
      const eventId = auditLogger.logAuthSuccess({
        requestId: 'req-456',
        clientId: 'test-client',
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-456');
      expect(events).toHaveLength(1);
      expect(events[0].trace_id).toBeNull();
    });
  });

  describe('logAuthFailure', () => {
    it('should log authentication failure events', () => {
      const eventId = auditLogger.logAuthFailure({
        requestId: 'req-789',
        clientId: 'unknown',
        denyReason: 'invalid_token',
        statusCode: 401,
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-789');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_auth_failure');
      expect(events[0].client_id).toBe('unknown');
      expect(events[0].decision).toBe('deny');
      expect(events[0].deny_reason).toBe('invalid_token');
      expect(events[0].status_code).toBe(401);
    });
  });

  describe('logMcpRequest', () => {
    it('should log MCP request events', () => {
      const eventId = auditLogger.logMcpRequest({
        requestId: 'req-mcp-1',
        traceId: 'trace-mcp',
        clientId: 'claude-desktop',
        target: 'yfinance',
        method: 'tools/call',
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-mcp-1');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_mcp_request');
      expect(events[0].client_id).toBe('claude-desktop');
      expect(events[0].target_id).toBe('yfinance');
      expect(events[0].method).toBe('tools/call');
    });
  });

  describe('logMcpResponse', () => {
    it('should log MCP response events with latency', () => {
      const eventId = auditLogger.logMcpResponse({
        requestId: 'req-mcp-2',
        clientId: 'claude-desktop',
        target: 'yfinance',
        method: 'tools/call',
        latencyMs: 150,
        upstreamLatencyMs: 120,
        statusCode: 200,
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-mcp-2');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_mcp_response');
      expect(events[0].latency_ms).toBe(150);
      expect(events[0].upstream_latency_ms).toBe(120);
      expect(events[0].status_code).toBe(200);
      expect(events[0].decision).toBe('allow');
    });

    it('should log MCP response errors', () => {
      const eventId = auditLogger.logMcpResponse({
        requestId: 'req-mcp-3',
        clientId: 'claude-desktop',
        target: 'yfinance',
        method: 'tools/call',
        latencyMs: 50,
        statusCode: 502,
        error: 'Bad Gateway',
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-mcp-3');
      expect(events).toHaveLength(1);
      expect(events[0].status_code).toBe(502);
      expect(events[0].error).toBe('Bad Gateway');
      expect(events[0].decision).toBeNull(); // No allow decision for errors
    });
  });

  describe('logA2aRequest', () => {
    it('should log A2A request events', () => {
      const eventId = auditLogger.logA2aRequest({
        requestId: 'req-a2a-1',
        traceId: 'trace-a2a',
        clientId: 'remote-agent',
        target: 'echo-agent',
        method: 'message/send',
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-a2a-1');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_a2a_request');
      expect(events[0].target_id).toBe('echo-agent');
      expect(events[0].method).toBe('message/send');
    });
  });

  describe('logA2aResponse', () => {
    it('should log A2A response events', () => {
      const eventId = auditLogger.logA2aResponse({
        requestId: 'req-a2a-2',
        clientId: 'remote-agent',
        target: 'echo-agent',
        method: 'message/send',
        latencyMs: 200,
        upstreamLatencyMs: 180,
        statusCode: 200,
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-a2a-2');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_a2a_response');
      expect(events[0].latency_ms).toBe(200);
      expect(events[0].upstream_latency_ms).toBe(180);
    });
  });

  describe('logError', () => {
    it('should log gateway error events', () => {
      const eventId = auditLogger.logError({
        requestId: 'req-err-1',
        clientId: 'test-client',
        target: 'yfinance',
        method: 'tools/call',
        error: 'Internal server error',
        statusCode: 500,
        latencyMs: 10,
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-err-1');
      expect(events).toHaveLength(1);
      expect(events[0].event_kind).toBe('gateway_error');
      expect(events[0].error).toBe('Internal server error');
      expect(events[0].status_code).toBe(500);
    });
  });

  describe('logEvent with metadata', () => {
    it('should store metadata as JSON', () => {
      const eventId = auditLogger.logEvent({
        requestId: 'req-meta-1',
        clientId: 'test-client',
        event: 'gateway_mcp_request',
        metadata: {
          tool_name: 'get_info',
          ticker: 'AAPL',
          custom_field: 123,
        },
      });

      expect(eventId).toBeDefined();

      const events = eventsStore.getGatewayEventsByRequestId('req-meta-1');
      expect(events).toHaveLength(1);
      expect(events[0].metadata_json).not.toBeNull();
      
      const metadata = JSON.parse(events[0].metadata_json!);
      expect(metadata.tool_name).toBe('get_info');
      expect(metadata.ticker).toBe('AAPL');
      expect(metadata.custom_field).toBe(123);
    });
  });

  describe('EventsStore gateway methods', () => {
    beforeEach(() => {
      // Create some test events
      auditLogger.logAuthSuccess({
        requestId: 'req-1',
        clientId: 'client-a',
        traceId: 'trace-1',
      });
      auditLogger.logMcpRequest({
        requestId: 'req-2',
        clientId: 'client-a',
        traceId: 'trace-1',
        target: 'yfinance',
        method: 'tools/call',
      });
      auditLogger.logMcpResponse({
        requestId: 'req-2',
        clientId: 'client-a',
        traceId: 'trace-1',
        target: 'yfinance',
        method: 'tools/call',
        latencyMs: 100,
        statusCode: 200,
      });
      auditLogger.logAuthFailure({
        requestId: 'req-3',
        clientId: 'unknown',
        denyReason: 'invalid_token',
        statusCode: 401,
      });
      auditLogger.logError({
        requestId: 'req-4',
        clientId: 'client-b',
        target: 'broken',
        error: 'Connection refused',
        statusCode: 502,
      });
    });

    it('should get events by client ID', () => {
      const events = eventsStore.getGatewayEventsByClientId('client-a');
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.every(e => e.client_id === 'client-a')).toBe(true);
    });

    it('should get events by target ID', () => {
      const events = eventsStore.getGatewayEventsByTargetId('yfinance');
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.every(e => e.target_id === 'yfinance')).toBe(true);
    });

    it('should get events by trace ID', () => {
      const events = eventsStore.getGatewayEventsByTraceId('trace-1');
      expect(events.length).toBe(3);
      expect(events.every(e => e.trace_id === 'trace-1')).toBe(true);
    });

    it('should get recent events', () => {
      const events = eventsStore.getRecentGatewayEvents(10);
      expect(events.length).toBe(5);
    });

    it('should get recent events filtered by kind', () => {
      const events = eventsStore.getRecentGatewayEvents(10, 'gateway_mcp_request');
      expect(events.length).toBe(1);
      expect(events[0].event_kind).toBe('gateway_mcp_request');
    });

    it('should get auth failures', () => {
      const events = eventsStore.getGatewayAuthFailures(10);
      expect(events.length).toBe(1);
      expect(events[0].deny_reason).toBe('invalid_token');
    });

    it('should get errors', () => {
      const events = eventsStore.getGatewayErrors(10);
      expect(events.length).toBe(1);
      expect(events[0].error).toBe('Connection refused');
    });
  });

  describe('createAuditLogger factory', () => {
    it('should create an AuditLogger instance', () => {
      const logger = createAuditLogger(tempDir);
      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });
});
