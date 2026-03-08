/**
 * ProofGuild - Registration tests
 * Phase 5: ProofGuild
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateGuildToken,
  validateApiKey,
  isApiKeyConfigured,
  getGuildTokenCount,
  cleanupGuildTokens,
  isExternalUrl,
  registerGuildAgent,
} from '../register.js';

// Mock fetchAgentCard
vi.mock('../../../a2a/agent-card.js', () => ({
  fetchAgentCard: vi.fn(),
}));

import { fetchAgentCard } from '../../../a2a/agent-card.js';

describe('ProofGuild Registration', () => {
  describe('validateGuildToken', () => {
    it('should return null for invalid token', () => {
      const result = validateGuildToken('invalid-token-123');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = validateGuildToken('');
      expect(result).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return false for missing auth header', () => {
      expect(validateApiKey(undefined)).toBe(false);
    });

    it('should return false for empty auth header', () => {
      expect(validateApiKey('')).toBe(false);
    });

    it('should return false for non-Bearer auth', () => {
      expect(validateApiKey('Basic abc123')).toBe(false);
    });

    it('should return false for invalid Bearer format', () => {
      expect(validateApiKey('Bearer')).toBe(false);
    });

    it('should return true for valid API key', () => {
      vi.stubEnv('GUILD_API_KEY', 'my-secret-key');
      expect(validateApiKey('Bearer my-secret-key')).toBe(true);
    });

    it('should return false for wrong API key', () => {
      vi.stubEnv('GUILD_API_KEY', 'my-secret-key');
      expect(validateApiKey('Bearer wrong-key')).toBe(false);
    });

    it('should return false for different length API key', () => {
      vi.stubEnv('GUILD_API_KEY', 'short');
      expect(validateApiKey('Bearer much-longer-key')).toBe(false);
    });

    it('should return false when no API key is configured', () => {
      vi.stubEnv('GUILD_API_KEY', '');
      expect(validateApiKey('Bearer any-key')).toBe(false);
    });
  });

  describe('isApiKeyConfigured', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return true when API key is set', () => {
      vi.stubEnv('GUILD_API_KEY', 'my-secret-key');
      expect(isApiKeyConfigured()).toBe(true);
    });

    it('should return false when API key is not set', () => {
      vi.stubEnv('GUILD_API_KEY', '');
      expect(isApiKeyConfigured()).toBe(false);
    });
  });

  describe('getGuildTokenCount', () => {
    it('should return number of registered tokens', () => {
      const count = getGuildTokenCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanupGuildTokens', () => {
    it('should not throw when called', () => {
      expect(() => cleanupGuildTokens()).not.toThrow();
    });

    it('should remove expired tokens', async () => {
      // Use fake timers to control time
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // Setup mocks for registration
      const mockTargetsStore = {
        add: vi.fn().mockReturnValue({ id: 'cleanup-test-agent' }),
        list: vi.fn().mockReturnValue([]),
      };
      const mockAuditLogger = { logEvent: vi.fn() };

      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'Cleanup Test Agent', url: 'https://cleanup-test.example.com', version: '1.0' },
      });

      const initialCount = getGuildTokenCount();

      // Register an agent (creates a token with 30-day TTL)
      const result = await registerGuildAgent(
        { url: 'https://cleanup-test.example.com' },
        {
          targetsStore: mockTargetsStore as any,
          auditLogger: mockAuditLogger as any,
          clientIp: '198.51.100.200', // Unique IP to avoid rate limit
          baseOptions: { requestId: 'cleanup-test', clientId: 'cleanup-client' },
          allowLocal: false,
        }
      );

      expect(result.ok).toBe(true);
      expect(getGuildTokenCount()).toBe(initialCount + 1);

      // Advance time past token expiry (30 days + 1 second)
      const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
      vi.advanceTimersByTime(TOKEN_TTL_MS + 1000);

      // Cleanup should remove expired token
      cleanupGuildTokens();

      expect(getGuildTokenCount()).toBe(initialCount);

      vi.useRealTimers();
    });
  });

  describe('isExternalUrl (SSRF protection)', () => {
    it('should return true for external URLs', () => {
      expect(isExternalUrl('https://example.com')).toBe(true);
      expect(isExternalUrl('https://api.openai.com/v1')).toBe(true);
      expect(isExternalUrl('http://github.com')).toBe(true);
    });

    it('should return false for localhost', () => {
      expect(isExternalUrl('http://localhost:8080')).toBe(false);
      expect(isExternalUrl('http://localhost')).toBe(false);
      expect(isExternalUrl('https://localhost.localdomain')).toBe(false);
    });

    it('should return false for localhost subdomains (*.localhost)', () => {
      // RFC 6761: .localhost is reserved for loopback
      expect(isExternalUrl('http://foo.localhost')).toBe(false);
      expect(isExternalUrl('http://bar.localhost:8080')).toBe(false);
      expect(isExternalUrl('http://sub.domain.localhost')).toBe(false);
    });

    it('should return false for loopback IP (127.x.x.x)', () => {
      expect(isExternalUrl('http://127.0.0.1:8080')).toBe(false);
      expect(isExternalUrl('http://127.1.2.3')).toBe(false);
    });

    it('should return false for private Class A (10.x.x.x)', () => {
      expect(isExternalUrl('http://10.0.0.1')).toBe(false);
      expect(isExternalUrl('http://10.255.255.255')).toBe(false);
    });

    it('should return false for private Class B (172.16-31.x.x)', () => {
      expect(isExternalUrl('http://172.16.0.1')).toBe(false);
      expect(isExternalUrl('http://172.31.255.255')).toBe(false);
    });

    it('should return false for private Class C (192.168.x.x)', () => {
      expect(isExternalUrl('http://192.168.0.1')).toBe(false);
      expect(isExternalUrl('http://192.168.1.1')).toBe(false);
    });

    it('should return false for link-local (169.254.x.x)', () => {
      expect(isExternalUrl('http://169.254.0.1')).toBe(false);
      expect(isExternalUrl('http://169.254.169.254')).toBe(false);
    });

    it('should return false for IPv6 loopback', () => {
      expect(isExternalUrl('http://[::1]:8080')).toBe(false);
    });

    it('should return false for IPv6 unique local (fc00::/7)', () => {
      // fc00::/7 includes both fc and fd prefixes
      expect(isExternalUrl('http://[fc00::1]')).toBe(false);
      expect(isExternalUrl('http://[fd00::1]')).toBe(false);
      expect(isExternalUrl('http://[fd12:3456:789a::1]')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isExternalUrl('not-a-url')).toBe(false);
      expect(isExternalUrl('')).toBe(false);
    });

    it('should return false for non-http/https schemes (defense-in-depth)', () => {
      // Block dangerous schemes even if they pass hostname checks
      expect(isExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isExternalUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('registerGuildAgent', () => {
    const mockTargetsStore = {
      add: vi.fn(),
      list: vi.fn(),
    };

    const mockAuditLogger = {
      logEvent: vi.fn(),
    };

    const baseOptions = {
      targetsStore: mockTargetsStore as any,
      auditLogger: mockAuditLogger as any,
      clientIp: '203.0.113.1',
      baseOptions: {
        requestId: 'test-req-id',
        clientId: 'test-client',
      },
      allowLocal: false,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockTargetsStore.list.mockReturnValue([]);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should reject missing URL', async () => {
      const result = await registerGuildAgent({ url: '' }, baseOptions);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('Missing required field');
    });

    it('should reject invalid URL scheme', async () => {
      const result = await registerGuildAgent({ url: 'ftp://example.com' }, baseOptions);

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('must start with http');
    });

    it('should reject private IP addresses (SSRF protection)', async () => {
      const result = await registerGuildAgent(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        baseOptions
      );

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('internal/private');
    });

    it('should reject duplicate URL registration', async () => {
      const existingUrl = 'https://example.com/agent';
      mockTargetsStore.list.mockReturnValue([
        { type: 'agent', config: { url: existingUrl } },
      ]);

      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'Test Agent', url: existingUrl, version: '1.0' },
      });

      const result = await registerGuildAgent(
        { url: existingUrl },
        baseOptions
      );

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('already registered');
    });

    it('should reject when AgentCard fetch fails', async () => {
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: false,
        error: 'Connection refused',
      });

      const result = await registerGuildAgent(
        { url: 'https://example.com/agent' },
        baseOptions
      );

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(422);
      expect(result.error).toContain('Connection refused');
    });

    it('should successfully register agent and return token', async () => {
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'Test Agent', url: 'https://example.com/agent', version: '1.0' },
      });
      mockTargetsStore.add.mockReturnValue({ id: 'test-agent-id' });

      const result = await registerGuildAgent(
        { url: 'https://example.com/agent' },
        baseOptions
      );

      expect(result.ok).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response?.agent_id).toBeDefined();
      expect(result.response?.token).toBeDefined();
      expect(result.response?.name).toBe('Test Agent');
      expect(result.response?.expires_at).toBeDefined();
      expect(mockTargetsStore.add).toHaveBeenCalledOnce();
    });

    it('should use custom name when provided', async () => {
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'Default Name', url: 'https://example.com/agent', version: '1.0' },
      });
      mockTargetsStore.add.mockReturnValue({ id: 'test-agent-id' });

      const result = await registerGuildAgent(
        { url: 'https://example.com/agent', name: 'Custom Name' },
        baseOptions
      );

      expect(result.ok).toBe(true);
      expect(result.response?.name).toBe('Custom Name');
    });

    it('should allow local URLs when allowLocal is true', async () => {
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'Local Agent', url: 'http://localhost:8080', version: '1.0' },
      });
      mockTargetsStore.add.mockReturnValue({ id: 'local-agent-id' });

      const result = await registerGuildAgent(
        { url: 'http://localhost:8080' },
        { ...baseOptions, allowLocal: true }
      );

      expect(result.ok).toBe(true);
      expect(result.response?.name).toBe('Local Agent');
    });

    it('should return 429 when rate limit exceeded', async () => {
      // Use a unique IP for this test to avoid conflicts
      const rateLimitOptions = {
        ...baseOptions,
        clientIp: '198.51.100.99', // TEST-NET-2 IP for isolation
      };

      // Make 10 requests (within limit)
      for (let i = 0; i < 10; i++) {
        await registerGuildAgent({ url: '' }, rateLimitOptions);
      }

      // 11th request should hit rate limit
      const result = await registerGuildAgent(
        { url: 'https://example.com/agent' },
        rateLimitOptions
      );

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(429);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('should pass correct arguments to targetsStore.add', async () => {
      const testUrl = 'https://example.com/new-agent';
      vi.mocked(fetchAgentCard).mockResolvedValue({
        ok: true,
        agentCard: { name: 'New Agent', url: testUrl, version: '2.0' },
      });
      mockTargetsStore.add.mockReturnValue({ id: 'new-agent-id' });

      // Use unique IP to avoid rate limit from previous tests
      const options = { ...baseOptions, clientIp: '198.51.100.100' };
      await registerGuildAgent({ url: testUrl }, options);

      expect(mockTargetsStore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent',
          protocol: 'a2a',
          name: 'New Agent',
          enabled: true,
          config: expect.objectContaining({
            schema_version: 1,
            url: testUrl,
            source: 'guild_register',
          }),
        }),
        expect.objectContaining({
          id: expect.any(String),
        })
      );
    });
  });
});
