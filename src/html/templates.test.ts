/**
 * HTML Template Tests
 *
 * Unit tests for HTML generation functions.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  escapeJsonForScript,
  generateRpcHtml,
  generateSessionHtml,
  generateConnectorHtml,
} from './templates.js';
import {
  HTML_REPORT_SCHEMA_VERSION,
  toRpcStatus,
  createPayloadData,
  type HtmlRpcReportV1,
  type HtmlSessionReportV1,
  type HtmlConnectorReportV1,
} from './types.js';

describe('escapeHtml', () => {
  it('should escape < and >', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('should escape &', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape quotes', () => {
    expect(escapeHtml('"hello" \'world\'')).toBe('&quot;hello&quot; &#39;world&#39;');
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle string with no special chars', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('escapeJsonForScript', () => {
  it('should escape </script> sequences', () => {
    const json = '{"html":"</script><script>alert(1)</script>"}';
    const escaped = escapeJsonForScript(json);
    expect(escaped).not.toContain('</script>');
    expect(escaped).toContain('<\\/script>');
  });

  it('should only escape </script> specifically', () => {
    // Other closing tags like </div> should not be escaped
    const json = '{"tag":"</div>"}';
    const escaped = escapeJsonForScript(json);
    expect(escaped).toBe(json); // </div> is not escaped
  });

  it('should handle empty string', () => {
    expect(escapeJsonForScript('')).toBe('');
  });

  it('should handle JSON without special sequences', () => {
    const json = '{"name":"test","value":123}';
    expect(escapeJsonForScript(json)).toBe(json);
  });
});

describe('toRpcStatus', () => {
  it('should return OK for success=1', () => {
    expect(toRpcStatus(1)).toBe('OK');
  });

  it('should return ERR for success=0', () => {
    expect(toRpcStatus(0)).toBe('ERR');
  });

  it('should return PENDING for null', () => {
    expect(toRpcStatus(null)).toBe('PENDING');
  });
});

describe('createPayloadData', () => {
  it('should return null json for null input', () => {
    const result = createPayloadData(null, null, 1024);
    expect(result.json).toBeNull();
    expect(result.size).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('should embed small payloads fully', () => {
    const json = { foo: 'bar' };
    const rawJson = JSON.stringify(json);
    const result = createPayloadData(json, rawJson, 1024);
    expect(result.json).toEqual(json);
    expect(result.size).toBe(rawJson.length);
    expect(result.truncated).toBe(false);
    expect(result.preview).toBeNull();
  });

  it('should truncate large payloads', () => {
    const json = { data: 'x'.repeat(2000) };
    const rawJson = JSON.stringify(json);
    const result = createPayloadData(json, rawJson, 100); // limit of 100 bytes
    expect(result.json).toBeNull();
    expect(result.size).toBe(Buffer.byteLength(rawJson, 'utf8'));
    expect(result.truncated).toBe(true);
    expect(result.preview).toBe(rawJson.slice(0, 4096));
  });

  it('should include spill file path when provided', () => {
    const json = { data: 'x'.repeat(2000) };
    const rawJson = JSON.stringify(json);
    const result = createPayloadData(json, rawJson, 100, 'payload_abc_1_req.json');
    expect(result.spillFile).toBe('payload_abc_1_req.json');
  });
});

describe('generateRpcHtml', () => {
  const baseReport: HtmlRpcReportV1 = {
    meta: {
      schemaVersion: HTML_REPORT_SCHEMA_VERSION,
      generatedAt: '2025-01-12T10:00:00.000Z',
      generatedBy: 'proofscan v0.10.0',
      redacted: false,
    },
    rpc: {
      rpc_id: '1',
      session_id: 'abc12345-1234-1234-1234-123456789012',
      connector_id: 'test-connector',
      method: 'tools/list',
      status: 'OK',
      latency_ms: 42,
      error_code: null,
      request_ts: '2025-01-12T10:00:00.000Z',
      response_ts: '2025-01-12T10:00:00.042Z',
      request: createPayloadData({ jsonrpc: '2.0', method: 'tools/list' }, '{"jsonrpc":"2.0","method":"tools/list"}', 262144),
      response: createPayloadData({ jsonrpc: '2.0', result: [] }, '{"jsonrpc":"2.0","result":[]}', 262144),
    },
  };

  it('should generate valid HTML structure', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('should include method in title', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('<title>');
    expect(html).toContain('tools/list');
  });

  it('should include embedded JSON for programmatic access', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('id="report-data"');
    expect(html).toContain('type="application/json"');
  });

  it('should escape JSON in script tag', () => {
    const report: HtmlRpcReportV1 = {
      ...baseReport,
      rpc: {
        ...baseReport.rpc,
        request: createPayloadData({ html: '</script>' }, '{"html":"</script>"}', 262144),
      },
    };
    const html = generateRpcHtml(report);
    // Ensure </script> is escaped in embedded JSON
    const scriptMatch = html.match(/<script[^>]*id="report-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    if (scriptMatch) {
      expect(scriptMatch[1]).not.toContain('</script>');
    }
  });

  it('should include copy button', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('copy-btn');
  });

  it('should show status with appropriate class', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('status-OK');
  });

  it('should show ERR status for error RPC', () => {
    const errorReport: HtmlRpcReportV1 = {
      ...baseReport,
      rpc: {
        ...baseReport.rpc,
        status: 'ERR',
        error_code: -32600,
      },
    };
    const html = generateRpcHtml(errorReport);
    expect(html).toContain('status-ERR');
  });

  it('should include dark theme CSS variables', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('--bg-primary');
    expect(html).toContain('#0d1117');
  });

  it('should include badge styling', () => {
    const html = generateRpcHtml(baseReport);
    expect(html).toContain('.badge');
    expect(html).toContain('--accent-blue');
  });

  it('should show truncation notice for large payloads', () => {
    const report: HtmlRpcReportV1 = {
      ...baseReport,
      rpc: {
        ...baseReport.rpc,
        response: {
          json: null,
          size: 500000,
          truncated: true,
          preview: '{"data":"' + 'x'.repeat(4000) + '...',
        },
      },
    };
    const html = generateRpcHtml(report);
    expect(html).toContain('truncated');
  });
});

describe('generateSessionHtml', () => {
  const baseSessionReport: HtmlSessionReportV1 = {
    meta: {
      schemaVersion: HTML_REPORT_SCHEMA_VERSION,
      generatedAt: '2025-01-12T10:00:00.000Z',
      generatedBy: 'proofscan v0.10.0',
      redacted: false,
    },
    session: {
      session_id: 'abc12345-1234-1234-1234-123456789012',
      connector_id: 'test-connector',
      started_at: '2025-01-12T09:00:00.000Z',
      ended_at: '2025-01-12T10:00:00.000Z',
      exit_reason: null,
      rpc_count: 2,
      event_count: 4,
      total_latency_ms: 30,
    },
    rpcs: [
      {
        rpc_id: '1',
        method: 'initialize',
        status: 'OK',
        latency_ms: 10,
        request_ts: '2025-01-12T09:00:00.000Z',
        response_ts: '2025-01-12T09:00:00.010Z',
        error_code: null,
        request: createPayloadData({ method: 'initialize' }, '{"method":"initialize"}', 262144),
        response: createPayloadData({ result: {} }, '{"result":{}}', 262144),
      },
      {
        rpc_id: '2',
        method: 'tools/list',
        status: 'OK',
        latency_ms: 20,
        request_ts: '2025-01-12T09:00:01.000Z',
        response_ts: '2025-01-12T09:00:01.020Z',
        error_code: null,
        request: createPayloadData({ method: 'tools/list' }, '{"method":"tools/list"}', 262144),
        response: createPayloadData({ result: { tools: [] } }, '{"result":{"tools":[]}}', 262144),
      },
    ],
  };

  it('should generate valid HTML structure', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('should include session ID in title', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('<title>');
    expect(html).toContain('abc12345');
  });

  it('should include RPC table', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('rpc-table');
    expect(html).toContain('initialize');
    expect(html).toContain('tools/list');
  });

  it('should include 2-pane layout', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('left-pane');
    expect(html).toContain('right-pane');
    expect(html).toContain('resize-handle');
  });

  it('should include embedded JSON data', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('id="report-data"');
    expect(html).toContain('type="application/json"');
  });

  it('should include 2-pane JavaScript', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('rpc-row');
    expect(html).toContain('showRpcDetail');
    expect(html).toContain('addEventListener');
  });

  it('should show total latency in session info', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('Total Latency');
    expect(html).toContain('30ms');
  });

  it('should handle empty RPC list', () => {
    const emptyReport: HtmlSessionReportV1 = {
      ...baseSessionReport,
      session: { ...baseSessionReport.session, rpc_count: 0 },
      rpcs: [],
    };
    const html = generateSessionHtml(emptyReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('rpc-table');
  });

  it('should show RPC count in session info', () => {
    const html = generateSessionHtml(baseSessionReport);
    expect(html).toContain('2'); // rpc_count
  });
});

describe('Embedded JSON parsing', () => {
  it('RPC report JSON should be parseable', () => {
    const report: HtmlRpcReportV1 = {
      meta: {
        schemaVersion: HTML_REPORT_SCHEMA_VERSION,
        generatedAt: '2025-01-12T10:00:00.000Z',
        generatedBy: 'proofscan v0.10.0',
        redacted: false,
      },
      rpc: {
        rpc_id: '1',
        session_id: 'abc12345',
        connector_id: 'test',
        method: 'test',
        status: 'OK',
        latency_ms: 10,
        error_code: null,
        request_ts: '2025-01-12T10:00:00.000Z',
        response_ts: '2025-01-12T10:00:00.010Z',
        request: createPayloadData({}, '{}', 262144),
        response: createPayloadData({}, '{}', 262144),
      },
    };
    const html = generateRpcHtml(report);

    // Extract JSON from script tag
    const match = html.match(/<script[^>]*id="report-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();

    if (match) {
      // Unescape the JSON (reverse escapeJsonForScript)
      const unescaped = match[1].replace(/<\\/g, '</');
      expect(() => JSON.parse(unescaped)).not.toThrow();
      const parsed = JSON.parse(unescaped);
      expect(parsed.meta.schemaVersion).toBe(HTML_REPORT_SCHEMA_VERSION);
      expect(parsed.rpc.rpc_id).toBe('1');
    }
  });

  it('Session report JSON should be parseable', () => {
    const report: HtmlSessionReportV1 = {
      meta: {
        schemaVersion: HTML_REPORT_SCHEMA_VERSION,
        generatedAt: '2025-01-12T10:00:00.000Z',
        generatedBy: 'proofscan v0.10.0',
        redacted: false,
      },
      session: {
        session_id: 'abc12345',
        connector_id: 'test',
        started_at: '2025-01-12T09:00:00.000Z',
        ended_at: null,
        exit_reason: null,
        rpc_count: 0,
        event_count: 0,
        total_latency_ms: null,
      },
      rpcs: [],
    };
    const html = generateSessionHtml(report);

    // Extract JSON from script tag
    const match = html.match(/<script[^>]*id="report-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();

    if (match) {
      const unescaped = match[1].replace(/<\\/g, '</');
      expect(() => JSON.parse(unescaped)).not.toThrow();
      const parsed = JSON.parse(unescaped);
      expect(parsed.meta.schemaVersion).toBe(HTML_REPORT_SCHEMA_VERSION);
      expect(parsed.session.session_id).toBe('abc12345');
    }
  });
});

describe('generateConnectorHtml', () => {
  const baseSessionReport: HtmlSessionReportV1 = {
    meta: {
      schemaVersion: HTML_REPORT_SCHEMA_VERSION,
      generatedAt: '2025-01-12T10:00:00.000Z',
      generatedBy: 'proofscan v0.10.0',
      redacted: false,
    },
    session: {
      session_id: 'abc12345-1234-1234-1234-123456789012',
      connector_id: 'test-connector',
      started_at: '2025-01-12T09:00:00.000Z',
      ended_at: '2025-01-12T10:00:00.000Z',
      exit_reason: null,
      rpc_count: 2,
      event_count: 4,
      total_latency_ms: 30,
    },
    rpcs: [
      {
        rpc_id: '1',
        method: 'initialize',
        status: 'OK',
        latency_ms: 10,
        request_ts: '2025-01-12T09:00:00.000Z',
        response_ts: '2025-01-12T09:00:00.010Z',
        error_code: null,
        request: createPayloadData({ method: 'initialize' }, '{"method":"initialize"}', 262144),
        response: createPayloadData({ result: {} }, '{"result":{}}', 262144),
      },
      {
        rpc_id: '2',
        method: 'tools/list',
        status: 'OK',
        latency_ms: 20,
        request_ts: '2025-01-12T09:00:01.000Z',
        response_ts: '2025-01-12T09:00:01.020Z',
        error_code: null,
        request: createPayloadData({ method: 'tools/list' }, '{"method":"tools/list"}', 262144),
        response: createPayloadData({ result: { tools: [] } }, '{"result":{"tools":[]}}', 262144),
      },
    ],
  };

  const baseConnectorReport: HtmlConnectorReportV1 = {
    meta: {
      schemaVersion: HTML_REPORT_SCHEMA_VERSION,
      generatedAt: '2025-01-12T10:00:00.000Z',
      generatedBy: 'proofscan v0.10.0',
      redacted: false,
    },
    connector: {
      connector_id: 'test-connector',
      enabled: true,
      transport: {
        type: 'stdio',
        command: 'npx -y @anthropic/mcp-server-test',
      },
      server: {
        name: 'Test MCP Server',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: true,
          resources: true,
          prompts: false,
        },
      },
      session_count: 10,
      displayed_sessions: 2,
      offset: 0,
    },
    sessions: [
      {
        session_id: 'abc12345-1234-1234-1234-123456789012',
        short_id: 'abc12345',
        started_at: '2025-01-12T09:00:00.000Z',
        ended_at: '2025-01-12T10:00:00.000Z',
        rpc_count: 2,
        event_count: 4,
        error_count: 0,
        total_latency_ms: 30,
      },
      {
        session_id: 'def67890-5678-5678-5678-567890123456',
        short_id: 'def67890',
        started_at: '2025-01-12T08:00:00.000Z',
        ended_at: '2025-01-12T09:00:00.000Z',
        rpc_count: 3,
        event_count: 6,
        error_count: 1,
        total_latency_ms: 50,
      },
    ],
    session_reports: {
      'abc12345-1234-1234-1234-123456789012': baseSessionReport,
      'def67890-5678-5678-5678-567890123456': {
        ...baseSessionReport,
        session: {
          ...baseSessionReport.session,
          session_id: 'def67890-5678-5678-5678-567890123456',
          started_at: '2025-01-12T08:00:00.000Z',
          ended_at: '2025-01-12T09:00:00.000Z',
        },
      },
    },
    analytics: {
      kpis: {
        rpc_total: 5,
        rpc_ok: 4,
        rpc_err: 1,
        rpc_pending: 0,
        avg_latency_ms: 16,
        p95_latency_ms: null,
        max_latency_ms: 25,
        total_request_bytes: 500,
        total_response_bytes: 1000,
        sessions_total: 10,
        sessions_displayed: 2,
        top_tool_name: 'read_file',
        top_tool_calls: 3,
      },
      heatmap: {
        start_date: '2025-01-12',
        end_date: '2025-01-12',
        cells: [{ date: '2025-01-12', count: 5 }],
        max_count: 5,
      },
      latency: {
        buckets: [
          { label: '0-10', from_ms: 0, to_ms: 10, count: 2 },
          { label: '10-25', from_ms: 10, to_ms: 25, count: 2 },
          { label: '25-50', from_ms: 25, to_ms: 50, count: 1 },
          { label: '50-100', from_ms: 50, to_ms: 100, count: 0 },
          { label: '100-250', from_ms: 100, to_ms: 250, count: 0 },
          { label: '250-500', from_ms: 250, to_ms: 500, count: 0 },
          { label: '500-1000', from_ms: 500, to_ms: 1000, count: 0 },
          { label: '1000+', from_ms: 1000, to_ms: null, count: 0 },
        ],
        sample_size: 5,
        excluded_count: 0,
      },
      top_tools: {
        items: [
          { name: 'read_file', count: 3, pct: 60 },
          { name: 'write_file', count: 2, pct: 40 },
        ],
        total_calls: 5,
      },
      method_distribution: {
        slices: [
          { method: 'tools/call', count: 3, pct: 60 },
          { method: 'tools/list', count: 2, pct: 40 },
        ],
        total_rpcs: 5,
      },
    },
  };

  it('should generate valid HTML structure', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('should include connector ID in title', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('<title>');
    expect(html).toContain('test-connector');
  });

  it('should include connector info section', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('connector-info');
    expect(html).toContain('Transport');
    expect(html).toContain('stdio');
    expect(html).toContain('npx -y @anthropic/mcp-server-test');
  });

  it('should include server info when available', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('Test MCP Server');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('MCP 2024-11-05');
  });

  it('should include capabilities badges', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('cap-enabled');
    expect(html).toContain('tools');
    expect(html).toContain('resources');
    // prompts is false, so should not be shown
  });

  it('should include sessions pane', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('sessions-pane');
    expect(html).toContain('sessions-list');
    expect(html).toContain('session-item');
  });

  it('should show session IDs in list', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('abc12345');
    expect(html).toContain('def67890');
  });

  it('should show OK badge for session with no errors', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('status-OK');
  });

  it('should show ERR badge for session with errors', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('status-ERR');
  });

  it('should include pagination info', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('Showing 1-2 of 10 sessions');
  });

  it('should include 3-pane layout structure', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('main-container');
    expect(html).toContain('sessions-pane');
    expect(html).toContain('session-detail-pane');
    expect(html).toContain('left-pane');
    expect(html).toContain('right-pane');
  });

  it('should include session content sections', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('session-content');
    expect(html).toContain('data-session-id');
  });

  it('should include RPC table in session detail', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('rpc-table');
    expect(html).toContain('initialize');
    expect(html).toContain('tools/list');
  });

  it('should include embedded JSON for programmatic access', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('id="report-data"');
    expect(html).toContain('type="application/json"');
  });

  it('should include JavaScript for session navigation', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('showSession');
    expect(html).toContain('showRpcDetail');
    expect(html).toContain('addEventListener');
  });

  it('should include dark theme CSS variables', () => {
    const html = generateConnectorHtml(baseConnectorReport);
    expect(html).toContain('--bg-primary');
    expect(html).toContain('#0d1117');
    expect(html).toContain('--accent-blue');
    expect(html).toContain('#00d4ff');
  });

  it('should handle empty sessions list', () => {
    const emptyReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        session_count: 0,
        displayed_sessions: 0,
      },
      sessions: [],
      session_reports: {},
    };
    const html = generateConnectorHtml(emptyReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('No sessions');
  });

  it('should handle connector without server info', () => {
    const noServerReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        server: undefined,
      },
    };
    const html = generateConnectorHtml(noServerReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('Server');
    expect(html).not.toContain('Protocol');
  });

  it('should show disabled badge when connector is disabled', () => {
    const disabledReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        enabled: false,
      },
    };
    const html = generateConnectorHtml(disabledReport);
    expect(html).toContain('status-ERR');
    expect(html).toContain('no');
  });

  it('should handle redacted report', () => {
    const redactedReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      meta: {
        ...baseConnectorReport.meta,
        redacted: true,
      },
    };
    const html = generateConnectorHtml(redactedReport);
    expect(html).toContain('(redacted)');
  });

  it('should escape HTML in connector ID', () => {
    const xssReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        connector_id: '<script>alert(1)</script>',
      },
    };
    const html = generateConnectorHtml(xssReport);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape JSON in script tag', () => {
    const reportWithXss: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        connector_id: '</script><script>alert(1)',
      },
    };
    const html = generateConnectorHtml(reportWithXss);
    const scriptMatch = html.match(/<script[^>]*id="report-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    if (scriptMatch) {
      expect(scriptMatch[1]).not.toContain('</script>');
    }
  });

  it('Connector report JSON should be parseable', () => {
    const html = generateConnectorHtml(baseConnectorReport);

    // Extract JSON from script tag
    const match = html.match(/<script[^>]*id="report-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();

    if (match) {
      const unescaped = match[1].replace(/<\\/g, '</');
      expect(() => JSON.parse(unescaped)).not.toThrow();
      const parsed = JSON.parse(unescaped);
      expect(parsed.meta.schemaVersion).toBe(HTML_REPORT_SCHEMA_VERSION);
      expect(parsed.connector.connector_id).toBe('test-connector');
      expect(parsed.sessions).toHaveLength(2);
      expect(parsed.session_reports).toBeDefined();
    }
  });

  it('should show pagination with offset', () => {
    const offsetReport: HtmlConnectorReportV1 = {
      ...baseConnectorReport,
      connector: {
        ...baseConnectorReport.connector,
        session_count: 100,
        displayed_sessions: 50,
        offset: 50,
      },
    };
    const html = generateConnectorHtml(offsetReport);
    expect(html).toContain('Showing 51-100 of 100 sessions');
  });
});
