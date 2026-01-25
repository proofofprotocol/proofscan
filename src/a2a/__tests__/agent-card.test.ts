/**
 * Agent Card Fetching Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAgentCard, normalizeAgentCardUrl } from '../agent-card.js';
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
