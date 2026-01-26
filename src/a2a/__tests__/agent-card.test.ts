/**
 * Agent Card Fetching Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAgentCard, normalizeAgentCardUrl, isPrivateUrl } from '../agent-card.js';
import type { AgentCard } from '../types.js';

// Mock fetch
global.fetch = vi.fn();

describe('normalizeAgentCardUrl', () => {
  it('should append /.well-known/agent.json to base URL', () => {
    expect(normalizeAgentCardUrl('https://example.com')).toBe('https://example.com/.well-known/agent.json');
  });

  it('should append /.well-known/agent.json to URL with trailing slash', () => {
    expect(normalizeAgentCardUrl('https://example.com/')).toBe('https://example.com/.well-known/agent.json');
  });

  it('should not modify URL that already contains /.well-known/agent.json', () => {
    expect(normalizeAgentCardUrl('https://example.com/.well-known/agent.json')).toBe('https://example.com/.well-known/agent.json');
  });

  it('should handle query parameters in base URL', () => {
    expect(normalizeAgentCardUrl('https://example.com?param=value')).toBe('https://example.com/.well-known/agent.json?param=value');
  });
});

describe('fetchAgentCard', () => {
  const validAgentCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com',
    version: '1.0.0',
    description: 'A test agent',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully fetch and parse valid Agent Card', async () => {
    const responseText = JSON.stringify(validAgentCard);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => responseText,
      json: async () => validAgentCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toEqual(validAgentCard);
    expect(result.hash).toBeDefined();
    expect(result.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/.well-known/agent.json'),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      })
    );
  });

  it('should handle invalid URL', async () => {
    const result = await fetchAgentCard('not-a-valid-url');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('should handle 404 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      text: async () => 'Not Found',
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toContain('404');
  });

  it('should handle timeout', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();

    vi.mocked(fetch).mockImplementationOnce(() => {
      return new Promise<Response>((_, reject) => {
        const timeout = setTimeout(() => {
          controller.abort();
          reject(new DOMException('Aborted', 'AbortError'));
        }, 500);
        return timeout as any;
      });
    });

    vi.spyOn(global, 'AbortController').mockImplementation(() => controller);

    const fetchPromise = fetchAgentCard('https://example.com', { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(600);
    const result = await fetchPromise;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');

    vi.useRealTimers();
  });

  it('should handle invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => 'not valid json',
      json: async () => { throw new Error('Invalid JSON'); },
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  it('should handle invalid Agent Card schema', async () => {
    const invalidCard = { invalid: 'card' }; // Missing required fields
    const responseText = JSON.stringify(invalidCard);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => responseText,
      json: async () => invalidCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid Agent Card');
    expect(result.hash).toBeDefined();
  });

  it('should include custom headers', async () => {
    const customHeaders = { Authorization: 'Bearer token' };
    const responseText = JSON.stringify(validAgentCard);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => responseText,
      json: async () => validAgentCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    await fetchAgentCard('https://example.com', { headers: customHeaders });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token',
        }),
      })
    );
  });

  it('should generate consistent hash for same response', async () => {
    const responseText = JSON.stringify(validAgentCard);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => responseText,
      json: async () => validAgentCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result1 = await fetchAgentCard('https://example.com');
    const result2 = await fetchAgentCard('https://example.com');

    expect(result1.hash).toBe(result2.hash);
  });
});

describe('isPrivateUrl - SSRF protection', () => {
  it('should reject localhost', () => {
    expect(isPrivateUrl('http://localhost:8080')).toBe(true);
    expect(isPrivateUrl('https://localhost')).toBe(true);
    expect(isPrivateUrl('http://localhost/.well-known/agent.json')).toBe(true);
  });

  it('should reject 127.0.0.1', () => {
    expect(isPrivateUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isPrivateUrl('https://127.0.0.1')).toBe(true);
    expect(isPrivateUrl('http://127.0.0.1/.well-known/agent.json')).toBe(true);
  });

  it('should reject IPv6 loopback', () => {
    expect(isPrivateUrl('http://[::1]:8080')).toBe(true);
    expect(isPrivateUrl('http://[0:0:0:0:0:0:0:1]')).toBe(true);
  });

  it('should reject private IPv4 ranges', () => {
    // 10.0.0.0/8
    expect(isPrivateUrl('http://10.0.0.1/agent')).toBe(true);
    expect(isPrivateUrl('http://10.255.255.255')).toBe(true);

    // 172.16.0.0/12
    expect(isPrivateUrl('http://172.16.0.1/agent')).toBe(true);
    expect(isPrivateUrl('http://172.31.255.255')).toBe(true);
    expect(isPrivateUrl('http://172.15.0.1/agent')).toBe(false); // Just outside range
    expect(isPrivateUrl('http://172.32.0.1/agent')).toBe(false); // Just outside range

    // 192.168.0.0/16
    expect(isPrivateUrl('http://192.168.0.1/agent')).toBe(true);
    expect(isPrivateUrl('http://192.168.255.255')).toBe(true);
    expect(isPrivateUrl('http://192.167.0.1/agent')).toBe(false); // Just outside range

    // 169.254.0.0/16 (link-local)
    expect(isPrivateUrl('http://169.254.1.1/agent')).toBe(true);

    // 127.0.0.0/8 (loopback)
    expect(isPrivateUrl('http://127.1.1.1/agent')).toBe(true);
  });

  it('should reject private IPv6 ranges', () => {
    // fc00::/7 (unique local)
    expect(isPrivateUrl('http://[fc00::1]/agent')).toBe(true);
    expect(isPrivateUrl('http://[fd00::1]/agent')).toBe(true);

    // fe80::/10 (link-local)
    expect(isPrivateUrl('http://[fe80::1]/agent')).toBe(true);
    expect(isPrivateUrl('http://[febf::1]/agent')).toBe(true);
  });

  it('should reject non-HTTP protocols', () => {
    expect(isPrivateUrl('file:///etc/passwd')).toBe(true);
    expect(isPrivateUrl('ftp://example.com')).toBe(true);
    expect(isPrivateUrl('data:text/plain,hello')).toBe(true);
  });

  it('should allow public HTTP/HTTPS URLs', () => {
    expect(isPrivateUrl('https://example.com')).toBe(false);
    expect(isPrivateUrl('http://api.example.com')).toBe(false);
    expect(isPrivateUrl('https://8.8.8.8/agent')).toBe(false); // Public IP
    expect(isPrivateUrl('https://1.1.1.1/.well-known/agent.json')).toBe(false); // Public IP
  });
});

describe('fetchAgentCard - SSRF protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject localhost URLs', async () => {
    const result = await fetchAgentCard('http://localhost:8080');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Private');
  });

  it('should reject private IP ranges', async () => {
    const privateUrls = [
      'http://10.0.0.1/agent',
      'http://172.16.0.1/agent',
      'http://192.168.1.1/agent',
      'http://169.254.1.1/agent',
      'http://127.0.0.1/agent',
    ];
    for (const url of privateUrls) {
      const result = await fetchAgentCard(url);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Private');
    }
  });

  it('should reject non-HTTP protocols', async () => {
    const result = await fetchAgentCard('file:///etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Private');
  });
});

describe('fetchAgentCard - Response size limits', () => {
  const validAgentCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com',
    version: '1.0.0',
    description: 'A test agent',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject responses larger than 1MB via Content-Length header', async () => {
    const largeSize = 1024 * 1024 + 1; // 1MB + 1 byte

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': largeSize.toString() }),
      text: async () => '{}',
      json: async () => ({}),
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('too large');
    expect(result.error).toContain('max');
  });

  it('should reject responses larger than 1MB via actual body size', async () => {
    // Create a response larger than 1MB
    const largeBody = JSON.stringify({
      ...validAgentCard,
      data: 'x'.repeat(1024 * 1024 + 100), // 1MB + 100 bytes
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(), // No Content-Length header
      text: async () => largeBody,
      json: async () => JSON.parse(largeBody),
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('too large');
    expect(result.error).toContain('max');
  });

  it('should accept responses within size limit', async () => {
    const responseText = JSON.stringify(validAgentCard);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': responseText.length.toString() }),
      text: async () => responseText,
      json: async () => validAgentCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toEqual(validAgentCard);
  });

  it('should accept large but still within limit response (900KB)', async () => {
    const nearLimitData = 'x'.repeat(900 * 1024); // 900KB
    const largeButValidCard = {
      ...validAgentCard,
      data: nearLimitData,
    };
    const responseText = JSON.stringify(largeButValidCard);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': responseText.length.toString() }),
      text: async () => responseText,
      json: async () => largeButValidCard,
      url: 'https://example.com/.well-known/agent.json',
    } as Response);

    const result = await fetchAgentCard('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.agentCard).toBeDefined();
    expect(result.agentCard?.name).toBe(validAgentCard.name);
    expect(result.agentCard?.version).toBe(validAgentCard.version);
  });
});
