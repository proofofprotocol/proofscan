/**
 * Authentication tests
 * Phase 8.2: Bearer Token Authentication
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashToken, validateToken, createAuthConfig, AuthConfig, TokenConfig } from '../auth.js';
import { hasPermission, buildMCPPermission, buildA2APermission } from '../permissions.js';
import { createGatewayServer, GatewayServer } from '../server.js';
import { createLogger, LogEntry } from '../logger.js';

describe('Token Hashing', () => {
  it('should hash token with SHA-256', () => {
    const hash = hashToken('test-token');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('should produce consistent hashes', () => {
    const hash1 = hashToken('my-secret-token');
    const hash2 = hashToken('my-secret-token');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different tokens', () => {
    const hash1 = hashToken('token-1');
    const hash2 = hashToken('token-2');
    expect(hash1).not.toBe(hash2);
  });

  it('should hash empty string', () => {
    const hash = hashToken('');
    // SHA-256 of empty string
    expect(hash).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('Token Validation', () => {
  const testToken = 'pfs_test_token_123';
  const testTokenHash = hashToken(testToken);

  const config: AuthConfig = {
    mode: 'bearer',
    tokens: [
      {
        name: 'test-client',
        token_hash: testTokenHash,
        permissions: ['mcp:*', 'registry:read'],
      },
      {
        name: 'limited-client',
        token_hash: hashToken('limited-token'),
        permissions: ['mcp:call:yfinance'],
      },
    ],
  };

  it('should validate correct token', () => {
    const result = validateToken(testToken, config);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('test-client');
    expect(result?.permissions).toEqual(['mcp:*', 'registry:read']);
  });

  it('should reject invalid token', () => {
    const result = validateToken('wrong-token', config);
    expect(result).toBeNull();
  });

  it('should return null when mode is none', () => {
    const noneConfig: AuthConfig = { mode: 'none', tokens: [] };
    const result = validateToken(testToken, noneConfig);
    expect(result).toBeNull();
  });

  it('should match correct token among multiple tokens', () => {
    const result = validateToken('limited-token', config);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('limited-client');
    expect(result?.permissions).toEqual(['mcp:call:yfinance']);
  });
});

describe('Permission Checking', () => {
  describe('hasPermission', () => {
    it('should allow exact match', () => {
      expect(hasPermission(['mcp:call:yfinance'], 'mcp:call:yfinance')).toBe(true);
    });

    it('should allow wildcard at end', () => {
      expect(hasPermission(['mcp:*'], 'mcp:call:yfinance')).toBe(true);
      expect(hasPermission(['mcp:call:*'], 'mcp:call:yfinance')).toBe(true);
    });

    it('should deny when no matching permission', () => {
      expect(hasPermission(['mcp:call:yfinance'], 'mcp:call:github')).toBe(false);
      expect(hasPermission(['mcp:call:yfinance'], 'a2a:task:agent')).toBe(false);
    });

    it('should deny empty permissions (default deny)', () => {
      expect(hasPermission([], 'mcp:call:yfinance')).toBe(false);
    });

    it('should handle root wildcard', () => {
      expect(hasPermission(['*'], 'mcp:call:yfinance')).toBe(true);
      expect(hasPermission(['*'], 'a2a:task:agent')).toBe(true);
      expect(hasPermission(['*'], 'registry:read')).toBe(true);
    });

    it('should handle multiple permissions', () => {
      const permissions = ['mcp:call:yfinance', 'registry:read'];
      expect(hasPermission(permissions, 'mcp:call:yfinance')).toBe(true);
      expect(hasPermission(permissions, 'registry:read')).toBe(true);
      expect(hasPermission(permissions, 'mcp:call:github')).toBe(false);
      expect(hasPermission(permissions, 'registry:write')).toBe(false);
    });

    it('should not allow partial matches', () => {
      expect(hasPermission(['mcp'], 'mcp:call:yfinance')).toBe(false);
      expect(hasPermission(['mcp:call'], 'mcp:call:yfinance')).toBe(false);
    });

    it('should handle nested wildcards correctly', () => {
      // mcp:* should match mcp:call, mcp:call:yfinance, etc.
      expect(hasPermission(['mcp:*'], 'mcp')).toBe(true);
      expect(hasPermission(['mcp:*'], 'mcp:call')).toBe(true);
      expect(hasPermission(['mcp:*'], 'mcp:call:yfinance')).toBe(true);
      
      // mcp:call:* should match mcp:call:yfinance but not mcp:resources:xxx
      expect(hasPermission(['mcp:call:*'], 'mcp:call:yfinance')).toBe(true);
      expect(hasPermission(['mcp:call:*'], 'mcp:resources:file')).toBe(false);
    });
  });

  describe('buildMCPPermission', () => {
    it('should build permission for tools/call', () => {
      expect(buildMCPPermission('tools/call', 'yfinance')).toBe('mcp:tools:call:yfinance');
    });

    it('should build permission without connector', () => {
      expect(buildMCPPermission('tools/list')).toBe('mcp:tools:list');
    });

    it('should build permission for resources/read', () => {
      expect(buildMCPPermission('resources/read', 'github')).toBe('mcp:resources:read:github');
    });
  });

  describe('buildA2APermission', () => {
    it('should build permission with agent', () => {
      expect(buildA2APermission('task', 'glm-dice')).toBe('a2a:task:glm-dice');
    });

    it('should build permission without agent', () => {
      expect(buildA2APermission('message')).toBe('a2a:message');
    });
  });
});

describe('Auth Middleware Integration', () => {
  let server: GatewayServer;
  let logs: LogEntry[];

  const testToken = 'pfs_integration_test_token';
  const testTokenHash = hashToken(testToken);

  beforeEach(() => {
    logs = [];
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('should allow requests without auth when mode is none', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: { mode: 'none', tokens: [] },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/test`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.client_id).toBe('anonymous');
  });

  it('should return 401 without Authorization header when mode is bearer', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'test', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/test`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 with invalid token', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'test', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/test`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('should return 200 with valid token', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'my-client', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/test`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.client_id).toBe('my-client');
  });

  it('should allow /health without auth even when mode is bearer', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'test', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('should allow /health with query params without auth', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'test', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/health?foo=bar`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('should allow /health/ (trailing slash) without auth', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'test', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    const response = await fetch(`${address}/health/`);
    // Fastify may return 404 for /health/ due to strict routing, or 200 if routed
    // The important thing is it should NOT return 401 (unauthorized)
    expect(response.status).not.toBe(401);
  });

  it('should log client_id in request logs', async () => {
    const logger = createLogger((line) => logs.push(JSON.parse(line) as LogEntry));
    server = createGatewayServer(
      {
        port: 0,
        host: '127.0.0.1',
        auth: {
          mode: 'bearer',
          tokens: [{ name: 'logged-client', token_hash: testTokenHash, permissions: ['*'] }],
        },
      },
      logger
    );
    const address = await server.start();

    await fetch(`${address}/test`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });

    // Wait for log to be written
    await new Promise((r) => setTimeout(r, 50));

    const requestLog = logs.find(
      (l) => l.event === 'http_request' && l.url === '/test'
    );

    expect(requestLog).toBeDefined();
    expect(requestLog?.client_id).toBe('logged-client');
  });
});

describe('Auth Config', () => {
  it('should create default auth config', () => {
    const config = createAuthConfig();
    expect(config.mode).toBe('none');
    expect(config.tokens).toEqual([]);
  });

  it('should override mode', () => {
    const config = createAuthConfig({ mode: 'bearer' });
    expect(config.mode).toBe('bearer');
  });

  it('should override tokens', () => {
    const tokens: TokenConfig[] = [
      { name: 'test', token_hash: 'sha256:abc', permissions: ['*'] },
    ];
    const config = createAuthConfig({ mode: 'bearer', tokens });
    expect(config.tokens).toEqual(tokens);
  });
});
