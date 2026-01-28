/**
 * Agent Card Fetching
 *
 * Fetches and parses Agent Cards from A2A agent endpoints.
 */

import { createHash } from 'crypto';
import type { AgentCard } from './types.js';
import { parseAgentCard } from './config.js';

export interface FetchAgentCardOptions {
  timeout?: number; // default: 10000ms
  headers?: Record<string, string>;
  /** Allow private/local URLs (development only) */
  allowLocal?: boolean;
}

export interface FetchAgentCardResult {
  ok: boolean;
  agentCard?: AgentCard;
  hash?: string; // SHA-256 hash of response body
  error?: string;
  statusCode?: number;
}

/**
 * Maximum allowed response body size (1MB)
 */
const MAX_RESPONSE_SIZE = 1024 * 1024;

/**
 * Validates that a URL is not a private/internal URL
 * Blocks localhost, private IP ranges, and non-HTTP/HTTPS protocols
 * @param url - URL string to validate
 * @returns true if URL should be blocked (private/local)
 */
export function isPrivateUrl(url: string): boolean {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  // localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  // IPv6 loopback addresses (any within ::1/128)
  if (hostname.startsWith('[') && hostname.includes('::')) {
    const ipv6 = hostname.slice(1, -1);
    if (ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1') {
      return true;
    }
  }

  // Private IPv4 address ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
    // 127.0.0.0/8 (loopback - extra safety)
    if (a === 127) return true;
  }

  // Private IPv6 address ranges
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const ipv6 = hostname.slice(1, -1);
    // fc00::/7 (unique local)
    if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (ipv6.startsWith('fe8') || ipv6.startsWith('fe9') ||
        ipv6.startsWith('fea') || ipv6.startsWith('feb')) return true;
  }

  // Only allow HTTP and HTTPS protocols
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return true;
  }

  return false;
}

/**
 * Normalizes URL for Agent Card endpoint
 * Appends /.well-known/agent.json if not present
 * Exported for testing
 */
export function normalizeAgentCardUrl(url: string): string {
  const normalizedUrl = url.trim();

  // Check if URL already contains /.well-known/agent.json
  if (normalizedUrl.includes('/.well-known/agent.json')) {
    return normalizedUrl;
  }

  // Parse URL to handle query parameters and hash correctly
  try {
    const urlObj = new URL(normalizedUrl);

    // Build base URL without trailing slash
    const baseUrl = normalizedUrl.split('?')[0].split('#')[0].replace(/\/+$/, '');
    const query = urlObj.search;
    const hash = urlObj.hash;

    // Reconstruct URL with agent.json appended
    let result = `${baseUrl}/.well-known/agent.json`;
    if (query) result += query;
    if (hash) result += hash;

    return result;
  } catch {
    // Fallback: just append to the end if URL parsing fails
    const baseUrl = normalizedUrl.replace(/\/+$/, '');
    return `${baseUrl}/.well-known/agent.json`;
  }
}

/**
 * Computes SHA-256 hash of response body
 */
function computeHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Fetch Agent Card from A2A agent endpoint
 * @param url - Agent base URL or full Agent Card URL
 * @param options - Fetch options (timeout, headers)
 * @returns FetchAgentCardResult with parsed AgentCard or error
 */
export async function fetchAgentCard(
  url: string,
  options: FetchAgentCardOptions = {}
): Promise<FetchAgentCardResult> {
  const { timeout = 10000, headers = {}, allowLocal = false } = options;
  const agentCardUrl = normalizeAgentCardUrl(url);

  // Validate URL format
  try {
    new URL(agentCardUrl);
  } catch {
    return {
      ok: false,
      error: `Invalid URL: ${url}`,
    };
  }

  // SSRF protection: Block private and local URLs
  if (isPrivateUrl(agentCardUrl) && !allowLocal) {
    return {
      ok: false,
      error: 'Private or local URLs are not allowed',
    };
  }

  // Set up abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(agentCardUrl, {
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Response size limit: Check Content-Length header first
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (length > MAX_RESPONSE_SIZE) {
        return {
          ok: false,
          statusCode: response.status,
          error: `Response too large: ${length} bytes (max ${MAX_RESPONSE_SIZE})`,
        };
      }
    }

    // Get response body
    const bodyText = await response.text();

    // Response size limit: Check actual body size
    if (bodyText.length > MAX_RESPONSE_SIZE) {
      return {
        ok: false,
        statusCode: response.status,
        error: `Response body too large: ${bodyText.length} bytes (max ${MAX_RESPONSE_SIZE})`,
      };
    }

    const hash = computeHash(bodyText);

    // Handle non-OK responses
    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
        hash,
      };
    }

    // Parse JSON
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return {
        ok: false,
        statusCode: response.status,
        error: 'Invalid JSON response',
        hash,
      };
    }

    // Validate Agent Card
    const result = parseAgentCard(parsedBody);
    if (!result.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: `Invalid Agent Card: ${result.error}`,
        hash,
      };
    }

    return {
      ok: true,
      agentCard: result.value,
      hash,
      statusCode: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          ok: false,
          error: `Request timeout after ${timeout}ms`,
        };
      }
      return {
        ok: false,
        error: error.message,
      };
    }
    return {
      ok: false,
      error: String(error),
    };
  }
}
