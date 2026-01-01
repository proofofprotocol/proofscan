import { describe, it, expect } from 'vitest';
import { parseMcpServers, parseMcpServerById } from './import.js';

describe('parseMcpServers', () => {
  describe('Format A: Full mcpServers wrapper', () => {
    it('should parse full mcpServers format', () => {
      const input = JSON.stringify({
        mcpServers: {
          time: { command: 'uvx', args: ['mcp-server-time'] },
          fetch: { command: 'npx', args: ['-y', '@anthropic/mcp-fetch'] },
        },
      });

      const result = parseMcpServers(input);

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(2);
      expect(result.connectors[0]).toEqual({
        id: 'time',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'uvx',
          args: ['mcp-server-time'],
        },
      });
    });

    it('should handle server with env and cwd', () => {
      const input = JSON.stringify({
        mcpServers: {
          custom: {
            command: 'node',
            args: ['server.js'],
            env: { DEBUG: 'true' },
            cwd: '/path/to/server',
          },
        },
      });

      const result = parseMcpServers(input);

      expect(result.errors).toHaveLength(0);
      expect(result.connectors[0].transport).toEqual({
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { DEBUG: 'true' },
        cwd: '/path/to/server',
      });
    });
  });

  describe('Format B: Direct mcpServers object', () => {
    it('should parse object with multiple servers', () => {
      const input = JSON.stringify({
        time: { command: 'uvx', args: ['mcp-server-time'] },
        memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
      });

      const result = parseMcpServers(input);

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(2);
      expect(result.connectors.map(c => c.id)).toContain('time');
      expect(result.connectors.map(c => c.id)).toContain('memory');
    });
  });

  describe('Format C: Single server definition', () => {
    it('should parse single server with --name', () => {
      const input = JSON.stringify({
        command: 'uvx',
        args: ['mcp-server-time'],
      });

      const result = parseMcpServers(input, 'my-time-server');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].id).toBe('my-time-server');
    });

    it('should error if single server without --name', () => {
      const input = JSON.stringify({
        command: 'uvx',
        args: ['mcp-server-time'],
      });

      const result = parseMcpServers(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('--name');
    });

    it('should parse server without args', () => {
      const input = JSON.stringify({
        command: 'my-server',
      });

      const result = parseMcpServers(input, 'simple');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors[0].transport).toEqual({
        type: 'stdio',
        command: 'my-server',
      });
    });
  });

  describe('Error cases', () => {
    it('should error on invalid JSON', () => {
      const result = parseMcpServers('not json');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid JSON');
    });

    it('should error on unrecognized format', () => {
      const result = parseMcpServers(JSON.stringify({ foo: 'bar' }));
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unrecognized format');
    });

    it('should error on empty object', () => {
      const result = parseMcpServers(JSON.stringify({}));
      expect(result.errors).toHaveLength(1);
    });
  });
});

describe('parseMcpServerById', () => {
  describe('Single server definition', () => {
    it('should parse single server with specified ID', () => {
      const input = JSON.stringify({
        command: 'npx',
        args: ['-y', '-p', '@proofofprotocol/inscribe-mcp', 'inscribe-mcp-server'],
      });

      const result = parseMcpServerById(input, 'inscribe');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].id).toBe('inscribe');
      expect(result.connectors[0].transport).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '-p', '@proofofprotocol/inscribe-mcp', 'inscribe-mcp-server'],
      });
    });
  });

  describe('mcpServers wrapper format', () => {
    it('should extract matching server by ID', () => {
      const input = JSON.stringify({
        mcpServers: {
          inscribe: {
            command: 'npx',
            args: ['-y', '-p', '@proofofprotocol/inscribe-mcp', 'inscribe-mcp-server'],
          },
          other: {
            command: 'node',
            args: ['other-server.js'],
          },
        },
      });

      const result = parseMcpServerById(input, 'inscribe');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].id).toBe('inscribe');
    });

    it('should use only server if ID not found but only one exists', () => {
      const input = JSON.stringify({
        mcpServers: {
          'inscribe-mcp': {
            command: 'npx',
            args: ['-y', 'inscribe-mcp'],
          },
        },
      });

      const result = parseMcpServerById(input, 'inscribe');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].id).toBe('inscribe'); // Uses requested ID
    });

    it('should error with available IDs if not found and multiple exist', () => {
      const input = JSON.stringify({
        mcpServers: {
          time: { command: 'uvx', args: ['mcp-server-time'] },
          fetch: { command: 'npx', args: ['-y', '@anthropic/mcp-fetch'] },
        },
      });

      const result = parseMcpServerById(input, 'inscribe');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('inscribe');
      expect(result.errors[0]).toContain('Available');
      expect(result.errors[0]).toContain('time');
      expect(result.errors[0]).toContain('fetch');
    });
  });

  describe('mcpServers object without wrapper', () => {
    it('should extract matching server by ID', () => {
      const input = JSON.stringify({
        inscribe: {
          command: 'npx',
          args: ['-y', 'inscribe-mcp'],
        },
      });

      const result = parseMcpServerById(input, 'inscribe');

      expect(result.errors).toHaveLength(0);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].id).toBe('inscribe');
    });
  });

  describe('Error cases', () => {
    it('should error on invalid JSON', () => {
      const result = parseMcpServerById('not json', 'inscribe');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid JSON');
    });

    it('should error on unrecognized format', () => {
      const result = parseMcpServerById(JSON.stringify({ foo: 'bar' }), 'inscribe');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unrecognized format');
    });
  });
});
