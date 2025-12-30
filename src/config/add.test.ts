/**
 * Tests for config add - JSON parsing and normalization
 */

import { describe, it, expect } from 'vitest';
import {
  parseConnectorJson,
  toConnector,
  findDuplicates,
  findInternalDuplicates,
} from './add.js';
import type { Connector } from '../types/index.js';

// ============================================================
// parseConnectorJson - Claude Desktop format
// ============================================================

describe('parseConnectorJson - Claude Desktop format', () => {
  it('parses Claude Desktop format with single server', () => {
    const json = JSON.stringify({
      mcpServers: {
        time: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-time'],
        },
      },
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors).toHaveLength(1);
    expect(result.connectors[0]).toEqual({
      id: 'time',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time'],
    });
  });

  it('parses Claude Desktop format with multiple servers', () => {
    const json = JSON.stringify({
      mcpServers: {
        time: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-time'],
        },
        filesystem: {
          command: 'node',
          args: ['server.js'],
          env: { HOME: '/home/user' },
        },
      },
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors).toHaveLength(2);
    expect(result.connectors.map(c => c.id).sort()).toEqual(['filesystem', 'time']);
  });

  it('parses Claude Desktop format with env variables', () => {
    const json = JSON.stringify({
      mcpServers: {
        myserver: {
          command: 'python',
          args: ['server.py'],
          env: {
            API_KEY: 'secret123',
            DEBUG: 'true',
          },
        },
      },
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors[0].env).toEqual({
      API_KEY: 'secret123',
      DEBUG: 'true',
    });
  });
});

// ============================================================
// parseConnectorJson - Single object format
// ============================================================

describe('parseConnectorJson - Single object format', () => {
  it('parses single object with id and command', () => {
    const json = JSON.stringify({
      id: 'my-server',
      command: 'node',
      args: ['index.js'],
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors).toHaveLength(1);
    expect(result.connectors[0]).toEqual({
      id: 'my-server',
      command: 'node',
      args: ['index.js'],
    });
  });

  it('parses single object without optional fields', () => {
    const json = JSON.stringify({
      id: 'minimal',
      command: 'python',
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors[0].id).toBe('minimal');
    expect(result.connectors[0].command).toBe('python');
    expect(result.connectors[0].args).toBeUndefined();
    expect(result.connectors[0].env).toBeUndefined();
  });
});

// ============================================================
// parseConnectorJson - Array format
// ============================================================

describe('parseConnectorJson - Array format', () => {
  it('parses array with multiple connectors', () => {
    const json = JSON.stringify([
      { id: 'server1', command: 'node', args: ['s1.js'] },
      { id: 'server2', command: 'python', args: ['s2.py'] },
    ]);

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors).toHaveLength(2);
    expect(result.connectors[0].id).toBe('server1');
    expect(result.connectors[1].id).toBe('server2');
  });

  it('fails on empty array', () => {
    const result = parseConnectorJson('[]');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Empty array');
  });
});

// ============================================================
// parseConnectorJson - Error handling
// ============================================================

describe('parseConnectorJson - Error handling', () => {
  it('fails on invalid JSON', () => {
    const result = parseConnectorJson('{ invalid json }');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON');
  });

  it('fails on missing command in Claude Desktop format', () => {
    const json = JSON.stringify({
      mcpServers: {
        test: {
          // missing command
          args: ['server.js'],
        },
      },
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('command');
  });

  it('fails on missing id in single object', () => {
    const json = JSON.stringify({
      command: 'node',
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('id');
  });

  it('fails on invalid args type', () => {
    const json = JSON.stringify({
      id: 'test',
      command: 'node',
      args: 'not-an-array',
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('args');
  });

  it('fails on invalid env type', () => {
    const json = JSON.stringify({
      id: 'test',
      command: 'node',
      env: ['not', 'an', 'object'],
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('env');
  });

  it('fails on unrecognized format', () => {
    const json = JSON.stringify({
      unknown: 'format',
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Unrecognized');
  });
});

// ============================================================
// toConnector - Conversion
// ============================================================

describe('toConnector', () => {
  it('converts parsed connector to Connector type', () => {
    const parsed = {
      id: 'test',
      command: 'node',
      args: ['server.js'],
      env: { KEY: 'value' },
    };

    const { connector, secretRefCount } = toConnector(parsed);

    expect(connector.id).toBe('test');
    expect(connector.enabled).toBe(true);
    expect(connector.transport.type).toBe('stdio');
    expect((connector.transport as { command: string }).command).toBe('node');
    expect((connector.transport as { args?: string[] }).args).toEqual(['server.js']);
    expect((connector.transport as { env?: Record<string, string> }).env).toEqual({ KEY: 'value' });
    expect(secretRefCount).toBe(0);
  });

  it('omits empty args and env', () => {
    const parsed = {
      id: 'minimal',
      command: 'python',
    };

    const { connector } = toConnector(parsed);

    expect((connector.transport as { args?: string[] }).args).toBeUndefined();
    expect((connector.transport as { env?: Record<string, string> }).env).toBeUndefined();
  });

  it('sanitizes secret references in env', () => {
    const parsed = {
      id: 'with-secrets',
      command: 'node',
      env: {
        API_KEY: 'secret://local/vault/API_KEY',
        NORMAL: 'value',
      },
    };

    const { connector, secretRefCount } = toConnector(parsed);

    expect((connector.transport as { env?: Record<string, string> }).env).toEqual({
      API_KEY: 'secret://***',
      NORMAL: 'value',
    });
    expect(secretRefCount).toBe(1);
  });
});

// ============================================================
// findDuplicates - Duplicate detection
// ============================================================

describe('findDuplicates', () => {
  const existingConnectors: Connector[] = [
    { id: 'time', enabled: true, transport: { type: 'stdio', command: 'npx' } },
    { id: 'fs', enabled: true, transport: { type: 'stdio', command: 'node' } },
  ];

  it('finds no duplicates when all IDs are new', () => {
    const parsed = [
      { id: 'new1', command: 'node' },
      { id: 'new2', command: 'python' },
    ];

    const dups = findDuplicates(parsed, existingConnectors);

    expect(dups).toHaveLength(0);
  });

  it('finds duplicates when IDs match existing', () => {
    const parsed = [
      { id: 'time', command: 'node' },
      { id: 'new', command: 'python' },
    ];

    const dups = findDuplicates(parsed, existingConnectors);

    expect(dups).toEqual(['time']);
  });

  it('finds multiple duplicates', () => {
    const parsed = [
      { id: 'time', command: 'node' },
      { id: 'fs', command: 'python' },
    ];

    const dups = findDuplicates(parsed, existingConnectors);

    expect(dups.sort()).toEqual(['fs', 'time']);
  });
});

// ============================================================
// findInternalDuplicates
// ============================================================

describe('findInternalDuplicates', () => {
  it('finds no duplicates when all IDs are unique', () => {
    const parsed = [
      { id: 'a', command: 'node' },
      { id: 'b', command: 'python' },
    ];

    const dups = findInternalDuplicates(parsed);

    expect(dups).toHaveLength(0);
  });

  it('finds internal duplicates', () => {
    const parsed = [
      { id: 'a', command: 'node' },
      { id: 'a', command: 'python' },
    ];

    const dups = findInternalDuplicates(parsed);

    expect(dups).toEqual(['a']);
  });
});

// ============================================================
// Integration tests
// ============================================================

describe('Integration tests', () => {
  it('parses real mcp.so example', () => {
    const json = JSON.stringify({
      id: 'mcp-server-time',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time'],
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors[0].id).toBe('mcp-server-time');
  });

  it('parses real Claude Desktop config excerpt', () => {
    const json = JSON.stringify({
      mcpServers: {
        'mcp-server-time': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-time'],
        },
        filesystem: {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/Users/username/Desktop',
          ],
        },
      },
    });

    const result = parseConnectorJson(json);

    expect(result.success).toBe(true);
    expect(result.connectors).toHaveLength(2);

    const { connector } = toConnector(result.connectors[0]);
    expect(connector.transport.type).toBe('stdio');
  });
});
