/**
 * Tests for A2A config validation
 */

import { describe, it, expect } from 'vitest';
import {
  parseConnectorConfig,
  parseAgentConfig,
  parseTargetConfig,
  parseAgentCard,
  type ParseResult,
} from '../config.js';
import type { TargetType, TargetProtocol } from '../../db/types.js';

describe('parseConnectorConfig', () => {
  describe('valid configs', () => {
    it('should parse a minimal stdio connector config', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-time'],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.schema_version).toBe(1);
      expect(result.value.transport).toBe('stdio');
      expect(result.value.command).toBe('npx');
      expect(result.value.args).toEqual(['-y', '@modelcontextprotocol/server-time']);
    });

    it('should parse a minimal http connector config', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.schema_version).toBe(1);
      expect(result.value.transport).toBe('http');
      expect(result.value.url).toBe('https://example.com/mcp');
      expect(result.value.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('should parse an sse connector config', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'sse',
        url: 'https://example.com/sse',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.schema_version).toBe(1);
      expect(result.value.transport).toBe('sse');
      expect(result.value.url).toBe('https://example.com/sse');
    });

    it('should parse a connector config with env variables', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: {
          API_KEY: 'secret123',
          DEBUG: 'true',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.env).toEqual({
        API_KEY: 'secret123',
        DEBUG: 'true',
      });
    });

    it('should parse a connector config with all optional fields', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer token',
          'X-Custom-Header': 'value',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.schema_version).toBe(1);
      expect(result.value.transport).toBe('http');
      expect(result.value.url).toBe('https://example.com/mcp');
      expect(result.value.headers).toEqual({
        Authorization: 'Bearer token',
        'X-Custom-Header': 'value',
      });
    });
  });

  describe('invalid configs', () => {
    it('should reject null', () => {
      const result = parseConnectorConfig(null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject array', () => {
      const result = parseConnectorConfig([]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject missing schema_version', () => {
      const result = parseConnectorConfig({
        transport: 'stdio',
        command: 'npx',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('schema_version');
    });

    it('should reject unsupported schema_version', () => {
      const result = parseConnectorConfig({
        schema_version: 2,
        transport: 'stdio',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Unsupported schema_version');
    });

    it('should reject missing transport', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('transport');
    });

    it('should reject invalid transport value', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'websocket' as 'stdio',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Invalid transport');
    });

    it('should reject non-string command', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        command: 123 as unknown as string,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('command');
    });

    it('should reject non-array args', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        args: 'not-an-array' as unknown as string[],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('args');
    });

    it('should reject array with non-string elements', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        args: ['valid', 123 as unknown as string],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('args[1]');
    });

    it('should reject non-object env', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        env: 'not-an-object' as unknown as Record<string, string>,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('env');
    });

    it('should reject env with non-string values', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'stdio',
        env: { KEY: 123 as unknown as string },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('env[KEY]');
    });

    it('should reject non-string url', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'http',
        url: 123 as unknown as string,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('url');
    });

    it('should reject non-object headers', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'http',
        headers: 'not-an-object' as unknown as Record<string, string>,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('headers');
    });

    it('should reject headers with non-string values', () => {
      const result = parseConnectorConfig({
        schema_version: 1,
        transport: 'http',
        headers: { Authorization: 123 as unknown as string },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('headers[Authorization]');
    });
  });
});

describe('parseAgentConfig', () => {
  describe('valid configs', () => {
    it('should parse a minimal agent config', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.schema_version).toBe(1);
      expect(result.value.url).toBe('https://example.com/agent');
    });

    it('should parse an agent config with ttl_seconds', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        ttl_seconds: 3600,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.ttl_seconds).toBe(3600);
    });

    it('should parse an agent config with bearer auth', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        auth: {
          type: 'bearer',
          token_ref: 'dpapi:proofscan/agents/myagent',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.auth).toEqual({
        type: 'bearer',
        token_ref: 'dpapi:proofscan/agents/myagent',
      });
    });

    it('should parse an agent config with api_key auth', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        auth: {
          type: 'api_key',
          header_name: 'X-API-Key',
          token_ref: 'dpapi:proofscan/agents/myagent',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.auth).toEqual({
        type: 'api_key',
        header_name: 'X-API-Key',
        token_ref: 'dpapi:proofscan/agents/myagent',
      });
    });

    it('should parse an agent config with oauth2 auth', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        auth: {
          type: 'oauth2',
          token_ref: 'dpapi:proofscan/agents/myagent',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.auth).toEqual({
        type: 'oauth2',
        token_ref: 'dpapi:proofscan/agents/myagent',
      });
    });
  });

  describe('invalid configs', () => {
    it('should reject null', () => {
      const result = parseAgentConfig(null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject array', () => {
      const result = parseAgentConfig([]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject missing schema_version', () => {
      const result = parseAgentConfig({
        url: 'https://example.com/agent',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('schema_version');
    });

    it('should reject unsupported schema_version', () => {
      const result = parseAgentConfig({
        schema_version: 2,
        url: 'https://example.com/agent',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Unsupported schema_version');
    });

    it('should reject missing url', () => {
      const result = parseAgentConfig({
        schema_version: 1,
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('url');
    });

    it('should reject non-string url', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 123 as unknown as string,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('url');
    });

    it('should reject negative ttl_seconds', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        ttl_seconds: -1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('ttl_seconds');
    });

    it('should reject NaN ttl_seconds', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        ttl_seconds: NaN,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('ttl_seconds');
    });

    it('should reject invalid auth type', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        auth: {
          type: 'basic' as 'bearer',
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Invalid auth type');
    });

    it('should reject non-object auth', () => {
      const result = parseAgentConfig({
        schema_version: 1,
        url: 'https://example.com/agent',
        auth: 'not-an-object' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Auth config');
    });
  });
});

describe('parseTargetConfig', () => {
  describe('valid type/protocol combinations', () => {
    it('should parse a connector config with type=connector, protocol=mcp', () => {
      const configJson = JSON.stringify({
        schema_version: 1,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-time'],
      });

      const result = parseTargetConfig('connector', 'mcp', configJson);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.type).toBe('connector');
      expect(result.value.protocol).toBe('mcp');
      expect(result.value.config.transport).toBe('stdio');
      expect(result.value.config.command).toBe('npx');
    });

    it('should parse an agent config with type=agent, protocol=a2a', () => {
      const configJson = JSON.stringify({
        schema_version: 1,
        url: 'https://example.com/agent',
      });

      const result = parseTargetConfig('agent', 'a2a', configJson);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.type).toBe('agent');
      expect(result.value.protocol).toBe('a2a');
      expect(result.value.config.url).toBe('https://example.com/agent');
    });
  });

  describe('invalid type/protocol combinations', () => {
    it('should reject type=connector with protocol=a2a', () => {
      const configJson = JSON.stringify({
        schema_version: 1,
        transport: 'stdio',
        command: 'npx',
      });

      const result = parseTargetConfig('connector', 'a2a', configJson);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("type='connector' requires protocol='mcp'");
      }
    });

    it('should reject type=agent with protocol=mcp', () => {
      const configJson = JSON.stringify({
        schema_version: 1,
        url: 'https://example.com/agent',
      });

      const result = parseTargetConfig('agent', 'mcp', configJson);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("type='agent' requires protocol='a2a'");
      }
    });
  });

  describe('invalid JSON', () => {
    it('should reject malformed JSON', () => {
      const result = parseTargetConfig('connector', 'mcp', '{invalid json}');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Invalid JSON');
    });

    it('should reject JSON with schema_version mismatch', () => {
      const configJson = JSON.stringify({
        schema_version: 999,
        url: 'https://example.com/agent',
      });

      const result = parseTargetConfig('agent', 'a2a', configJson);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Unsupported schema_version');
    });
  });
});

describe('parseAgentCard', () => {
  describe('valid agent cards', () => {
    it('should parse a minimal agent card', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.name).toBe('Test Agent');
      expect(result.value.url).toBe('https://example.com/agent');
      expect(result.value.version).toBe('1.0.0');
    });

    it('should parse a complete agent card', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        description: 'A test agent for unit testing',
        url: 'https://example.com/agent',
        provider: {
          organization: 'Test Org',
          url: 'https://test.org',
        },
        version: '1.0.0',
        documentationUrl: 'https://example.com/docs',
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true,
        },
        authentication: {
          schemes: ['bearer', 'oauth2'],
          credentials: 'optional',
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['application/json'],
        skills: [
          {
            id: 'skill1',
            name: 'Test Skill',
            description: 'A test skill',
            tags: ['test'],
            examples: ['example1', 'example2'],
            inputModes: ['text/plain'],
            outputModes: ['application/json'],
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.name).toBe('Test Agent');
      expect(result.value.description).toBe('A test agent for unit testing');
      expect(result.value.url).toBe('https://example.com/agent');
      expect(result.value.version).toBe('1.0.0');
      expect(result.value.documentationUrl).toBe('https://example.com/docs');
      expect(result.value.provider?.organization).toBe('Test Org');
      expect(result.value.provider?.url).toBe('https://test.org');
      expect(result.value.capabilities?.streaming).toBe(true);
      expect(result.value.capabilities?.pushNotifications).toBe(false);
      expect(result.value.capabilities?.stateTransitionHistory).toBe(true);
      expect(result.value.authentication?.schemes).toEqual(['bearer', 'oauth2']);
      expect(result.value.authentication?.credentials).toBe('optional');
      expect(result.value.defaultInputModes).toEqual(['text/plain']);
      expect(result.value.defaultOutputModes).toEqual(['application/json']);
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills?.[0].id).toBe('skill1');
      expect(result.value.skills?.[0].name).toBe('Test Skill');
    });

    it('should parse an agent card with partial provider', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        provider: {
          organization: 'Test Org',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.provider?.organization).toBe('Test Org');
      expect(result.value.provider?.url).toBeUndefined();
    });

    it('should parse an agent card with partial capabilities', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        capabilities: {
          streaming: true,
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Should be ok');

      expect(result.value.capabilities?.streaming).toBe(true);
      expect(result.value.capabilities?.pushNotifications).toBeUndefined();
    });
  });

  describe('invalid agent cards', () => {
    it('should reject null', () => {
      const result = parseAgentCard(null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject array', () => {
      const result = parseAgentCard([]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('object');
    });

    it('should reject missing name', () => {
      const result = parseAgentCard({
        url: 'https://example.com/agent',
        version: '1.0.0',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('name');
    });

    it('should reject missing url', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        version: '1.0.0',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('url');
    });

    it('should reject missing version', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
      } as unknown);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('version');
    });

    it('should reject non-string name', () => {
      const result = parseAgentCard({
        name: 123 as unknown as string,
        url: 'https://example.com/agent',
        version: '1.0.0',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('name');
    });

    it('should reject non-string url', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 123 as unknown as string,
        version: '1.0.0',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('url');
    });

    it('should reject non-string version', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: 1 as unknown as string,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('version');
    });

    it('should reject non-object provider', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        provider: 'not-an-object' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('provider');
    });

    it('should reject non-object capabilities', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        capabilities: 'not-an-object' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('capabilities');
    });

    it('should reject non-boolean capability values', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        capabilities: {
          streaming: 'true' as unknown as boolean,
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('streaming');
    });

    it('should reject non-object authentication', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        authentication: 'not-an-object' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('authentication');
    });

    it('should reject non-array authentication.schemes', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        authentication: {
          schemes: 'not-an-array' as unknown,
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('schemes');
    });

    it('should reject non-array skills', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        skills: 'not-an-array' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('skills');
    });

    it('should reject invalid skill', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        skills: [
          {
            id: 123 as unknown as string,
            name: 'Test Skill',
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('skills[0]');
    });

    it('should reject non-array defaultInputModes', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        defaultInputModes: 'not-an-array' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('defaultInputModes');
    });

    it('should reject non-array defaultOutputModes', () => {
      const result = parseAgentCard({
        name: 'Test Agent',
        url: 'https://example.com/agent',
        version: '1.0.0',
        defaultOutputModes: 'not-an-array' as unknown,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('defaultOutputModes');
    });
  });
});
