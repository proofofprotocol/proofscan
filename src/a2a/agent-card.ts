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
}

export interface FetchAgentCardResult {
  ok: boolean;
  agentCard?: AgentCard;
  hash?: string; // SHA-256 hash of response body
  error?: string;
  statusCode?: number;
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
  const { timeout = 10000, headers = {} } = options;
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

    // Get response body
    const bodyText = await response.text();
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
